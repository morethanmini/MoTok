package ssafy.a706.backend.liveroom.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 방(-24) 전용 Redis 접근 계층. 모톡 Redis 키맵 v0.2를 그대로 따른다.
 * room:{roomId}(Hash, TTL 24h) · room:{roomId}:members(Hash, TTL 24h) ·
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
    private static final int INVITE_CODE_LENGTH = 8;
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

    public Optional<Map<Object, Object>> findRoomFields(String roomId) {
        Map<Object, Object> fields = redisTemplate.opsForHash().entries(roomKey(roomId));
        return fields.isEmpty() ? Optional.empty() : Optional.of(fields);
    }

    public List<LiveRoomMemberValue> findMembers(String roomId) {
        return redisTemplate.opsForHash().entries(membersKey(roomId)).values().stream()
                .map(v -> decodeMember((String) v))
                .toList();
    }

    /** rooms:index ZSET에서 최신순(score 내림차순) roomId 목록(공개방·비공개방 모두 포함). */
    public Set<String> listRoomIdsNewestFirst(int limit) {
        Set<String> ids = redisTemplate.opsForZSet().reverseRange(ROOM_INDEX_KEY, 0, limit - 1);
        return ids == null ? new LinkedHashSet<>() : ids;
    }

    public boolean hasMember(String roomId, String playerKey) {
        return Boolean.TRUE.equals(redisTemplate.opsForHash().hasKey(membersKey(roomId), playerKey));
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
}
