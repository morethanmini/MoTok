package ssafy.a706.backend.liveroom.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 방(-24) 전용 Redis 접근 계층. 모톡 Redis 키맵 v0.2를 그대로 따른다.
 * room:{roomId}(Hash, TTL 24h) · room:{roomId}:members(Hash, TTL 24h) ·
 * room:{roomId}:kicked(Set, TTL 24h, 강퇴자 재입장 차단 목록) ·
 * rooms:index(ZSET, TTL 없음, 공개방·비공개방 모두 포함) · room:invite:{code}(String, TTL 24h)
 *
 * <p>members 필드 값은 원래 JSON 문자열로 설계됐지만, 이 프로젝트 build.gradle에
 * jackson-databind가 컴파일 클래스패스에 없어(webmvc/webflux 스타터만 있고
 * spring-boot-starter-json 계열 미포함) 의존성 추가 없이 URL-encoded key=value 포맷으로
 * 대체했다. jackson-databind가 추가되면 JSON으로 교체 권장.</p>
 */
@Repository
@RequiredArgsConstructor
public class LiveRoomRepository {

    private static final String CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int ROOM_ID_LENGTH = 6;
    private static final int INVITE_CODE_LENGTH = 6;
    private static final Duration ROOM_TTL = Duration.ofHours(24);
    private static final String ROOM_INDEX_KEY = "rooms:index";

    private final StringRedisTemplate redisTemplate;
    private final SecureRandom random = new SecureRandom();

    public String generateUniqueRoomId() {
        String roomId;
        do {
            roomId = randomCode(ROOM_ID_LENGTH);
        } while (Boolean.TRUE.equals(redisTemplate.hasKey(roomKey(roomId))));
        return roomId;
    }

    public String generateUniqueInviteCode() {
        String code;
        do {
            code = randomCode(INVITE_CODE_LENGTH);
        } while (Boolean.TRUE.equals(redisTemplate.hasKey(inviteKey(code))));
        return code;
    }

    public void saveRoom(String roomId, Map<String, String> fields) {
        String key = roomKey(roomId);
        redisTemplate.<String, String>opsForHash().putAll(key, fields);
        redisTemplate.expire(key, ROOM_TTL);
    }

    public void addMember(String roomId, String playerKey, String userId, String displayName,
                           boolean guest, long joinedAt) {
        String key = membersKey(roomId);
        String value = encodeMember(new LiveRoomMemberValue(userId, displayName, guest, joinedAt));
        redisTemplate.<String, String>opsForHash().put(key, playerKey, value);
        redisTemplate.expire(key, ROOM_TTL);
    }

    public void saveInviteCode(String code, String roomId) {
        redisTemplate.opsForValue().set(inviteKey(code), roomId, ROOM_TTL);
    }

    public Optional<String> findRoomIdByInviteCode(String code) {
        return Optional.ofNullable(redisTemplate.opsForValue().get(inviteKey(code)));
    }

    public void indexRoom(String roomId, long createdAt) {
        redisTemplate.opsForZSet().add(ROOM_INDEX_KEY, roomId, createdAt);
    }

    public void removeFromIndex(String roomId) {
        redisTemplate.opsForZSet().remove(ROOM_INDEX_KEY, roomId);
    }

    /** 로비 목록에 노출되는 방인가 — 게스트 1인방은 인덱스에 없어 false다(-148 알림 대상 판정). */
    public boolean isIndexed(String roomId) {
        return redisTemplate.opsForZSet().score(ROOM_INDEX_KEY, roomId) != null;
    }

    public Optional<Map<Object, Object>> findRoomFields(String roomId) {
        Map<Object, Object> fields = redisTemplate.opsForHash().entries(roomKey(roomId));
        return fields.isEmpty() ? Optional.empty() : Optional.of(fields);
    }

    public List<LiveRoomMemberValue> findMembers(String roomId) {
        return redisTemplate.opsForHash().entries(membersKey(roomId)).values().stream()
                .map(v -> decodeMember((String) v))
                .toList();
    }

    /**
     * 여러 방을 <b>한 번의 왕복</b>으로 읽는다(방 정보 + 참가자).
     *
     * <p>방 목록은 인덱스에서 최대 50개를 훑는데, 방마다 {@code findRoomFields} +
     * {@code findMembers}를 따로 부르면 왕복이 101번이다(ZREVRANGE 1 + 방당 2). 응답의
     * 거의 전부가 "직전과 같음"인 목록 조회에 그 비용을 매번 치르고 있었다. 파이프라인으로 묶으면
     * 명령 수는 같지만 네트워크 왕복이 1번으로 줄어 목록 지연이 왕복 수에 비례하지 않게 된다.</p>
     *
     * @return 살아 있는 방만. TTL로 사라진 방은 결과에 없다(호출부가 인덱스를 정리할 근거)
     */
    public Map<String, RawRoom> findRoomsInBulk(Collection<String> roomIds) {
        List<String> ids = roomIds.stream().distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }

        List<Object> results = redisTemplate.executePipelined(new SessionCallback<Object>() {
            @Override
            public Object execute(RedisOperations operations) {
                for (String roomId : ids) {
                    operations.opsForHash().entries(roomKey(roomId));
                    operations.opsForHash().entries(membersKey(roomId));
                }
                return null; // 파이프라인에서는 개별 반환값을 쓰지 않는다
            }
        });

        Map<String, RawRoom> rooms = new LinkedHashMap<>();
        for (int i = 0; i < ids.size(); i++) {
            Map<Object, Object> fields = asHash(results, i * 2);
            if (fields.isEmpty()) {
                continue; // 인덱스에는 있는데 해시가 없다 = TTL로 사라진 방
            }
            rooms.put(ids.get(i), new RawRoom(fields, decodeMembers(asHash(results, i * 2 + 1))));
        }
        return rooms;
    }

    /** 파이프라인으로 함께 읽어 온 방 한 채의 원시 형태. */
    public record RawRoom(Map<Object, Object> fields, List<LiveRoomMemberValue> members) {
    }

    @SuppressWarnings("unchecked")
    private Map<Object, Object> asHash(List<Object> results, int index) {
        Object raw = index < results.size() ? results.get(index) : null;
        return raw instanceof Map<?, ?> map ? (Map<Object, Object>) map : Map.of();
    }

    private List<LiveRoomMemberValue> decodeMembers(Map<Object, Object> hash) {
        return hash.values().stream().map(v -> decodeMember((String) v)).toList();
    }

    /** rooms:index ZSET에서 최신순(score 내림차순) roomId 목록(공개방·비공개방 모두 포함). */
    public Set<String> listRoomIdsNewestFirst(int limit) {
        Set<String> ids = redisTemplate.opsForZSet().reverseRange(ROOM_INDEX_KEY, 0, limit - 1);
        return ids == null ? new LinkedHashSet<>() : ids;
    }

    public boolean hasMember(String roomId, String playerKey) {
        return Boolean.TRUE.equals(redisTemplate.opsForHash().hasKey(membersKey(roomId), playerKey));
    }

    public void removeMember(String roomId, String playerKey) {
        redisTemplate.opsForHash().delete(membersKey(roomId), playerKey);
    }

    public void updateHost(String roomId, String hostUserId, String hostDisplayName) {
        redisTemplate.<String, String>opsForHash().putAll(roomKey(roomId),
                Map.of("hostUserId", hostUserId, "hostDisplayName", hostDisplayName));
    }

    /** 방 상태 전환(WAITING ↔ PLAYING). 게임 시작·종료 시 game 도메인이 호출한다 — status ≠ WAITING이면 join이 차단된다. */
    public void updateStatus(String roomId, String status) {
        redisTemplate.<String, String>opsForHash().put(roomKey(roomId), "status", status);
    }

    /**
     * 방 정보 수정(S15P11A706-130). putAll로 덮어쓰되 TTL은 갱신하지 않는다 — 방은 최초 생성 시점부터
     * 24h 카운트다운을 유지하고 수정은 여기에 영향을 주지 않는다(Redis는 기존 키에 필드만 쓸 때 TTL 미변경).
     * clearPassword가 true(공개방 전환)면 password 필드를 HDEL로 제거한다 — putAll만으로는 필드 삭제가
     * 안 돼 stale password가 남으면 hasPassword()가 계속 true가 되기 때문.
     */
    public void updateRoomInfo(String roomId, Map<String, String> fields, boolean clearPassword) {
        String key = roomKey(roomId);
        redisTemplate.<String, String>opsForHash().putAll(key, fields);
        if (clearPassword) {
            redisTemplate.opsForHash().delete(key, "password");
        }
    }

    /** 강퇴자를 재입장 차단 목록에 추가한다(S15P11A706-73). */
    public void addKicked(String roomId, String playerKey) {
        String key = kickedKey(roomId);
        redisTemplate.opsForSet().add(key, playerKey);
        redisTemplate.expire(key, ROOM_TTL);
    }

    public boolean isKicked(String roomId, String playerKey) {
        return Boolean.TRUE.equals(redisTemplate.opsForSet().isMember(kickedKey(roomId), playerKey));
    }

    /**
     * 마지막 참가자 퇴장 시 방 즉시 종료(S15P11A706-72).
     * room 해시 · members 해시 · kicked 목록 · 채팅 로그(-131) · rooms:index 항목을 모두 제거한다.
     * 채팅 로그도 즉시 삭제한다 — 방이 사라지면 신고(-132)도 불가가 정책(키맵 v0.4).
     */
    public void deleteRoom(String roomId) {
        redisTemplate.delete(roomKey(roomId));
        redisTemplate.delete(membersKey(roomId));
        redisTemplate.delete(kickedKey(roomId));
        redisTemplate.delete(chatLogKey(roomId));
        removeFromIndex(roomId);
    }

    private String encodeMember(LiveRoomMemberValue v) {
        return "userId=" + urlEncode(v.userId())
                + "&displayName=" + urlEncode(v.displayName())
                + "&guest=" + v.guest()
                + "&joinedAt=" + v.joinedAt();
    }

    private LiveRoomMemberValue decodeMember(String encoded) {
        Map<String, String> parts = new java.util.HashMap<>();
        for (String pair : encoded.split("&")) {
            int eq = pair.indexOf('=');
            parts.put(pair.substring(0, eq), pair.substring(eq + 1));
        }
        return new LiveRoomMemberValue(
                urlDecode(parts.get("userId")),
                urlDecode(parts.get("displayName")),
                Boolean.parseBoolean(parts.get("guest")),
                Long.parseLong(parts.get("joinedAt"))
        );
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String urlDecode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private String randomCode(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(CODE_CHARS.charAt(random.nextInt(CODE_CHARS.length())));
        }
        return sb.toString();
    }

    private String roomKey(String roomId) {
        return "room:" + roomId;
    }

    private String membersKey(String roomId) {
        return "room:" + roomId + ":members";
    }

    private String inviteKey(String code) {
        return "room:invite:" + code;
    }

    private String kickedKey(String roomId) {
        return "room:" + roomId + ":kicked";
    }

    /** 채팅 로그 키 — 쓰기·조회는 chat.ChatLogRepository 소유, 여기서는 방 폭파 시 삭제만 한다. */
    private String chatLogKey(String roomId) {
        return "room:" + roomId + ":chat";
    }
}
