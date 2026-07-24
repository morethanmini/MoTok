package ssafy.a706.backend.chat;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.Limit;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 대기실 채팅 로그(-131) Redis 접근 계층. 키맵 v0.4: room:{roomId}:chat (Stream, TTL 24h).
 * Stream을 쓰는 이유: XADD가 발급하는 엔트리 ID를 그대로 chatId(신고 대상 식별자)로 쓰고,
 * XRANGE/XREVRANGE로 특정 chatId 기준 전후 맥락(-132 스냅샷)을 바로 조회할 수 있어서다.
 * 방 폭파 시 삭제는 LiveRoomRepository.deleteRoom()이 담당한다(정책: 즉시 삭제, 유예 없음).
 */
@Repository
@RequiredArgsConstructor
public class ChatLogRepository {

    /** 방 키들과 동일한 TTL — 크래시 등으로 deleteRoom을 타지 못한 고아 키의 방어선. */
    private static final Duration CHAT_TTL = Duration.ofHours(24);

    /** 방당 보관 상한(메시지 개수). 신고 맥락(±10) 용도로 충분하며 도배 시 메모리 상한 역할. */
    private static final long MAX_MESSAGES = 500;

    private static final String FIELD_TYPE = "type";
    private static final String FIELD_USER_ID = "userId";
    private static final String FIELD_NICKNAME = "nickname";
    private static final String FIELD_TEXT = "text";
    private static final String FIELD_SENT_AT = "sentAt";
    private static final String FIELD_GAME_ID = "gameId";
    private static final String FIELD_GAME_NAME = "gameName";

    private final StringRedisTemplate redisTemplate;

    /** TALK 저장 후 발급된 chatId 반환. */
    public String appendTalk(String roomId, String userId, String nickname, String text, Instant sentAt) {
        return append(roomId, baseFields("TALK", userId, nickname, text, sentAt));
    }

    /** GAME_SUGGEST 저장 후 발급된 chatId 반환 — 채팅창에 보이는 메시지는 전부 신고 맥락이 된다. */
    public String appendGameSuggest(String roomId, String userId, String nickname, String text,
                                    Long gameId, String gameName, Instant sentAt) {
        Map<String, String> fields = baseFields("GAME_SUGGEST", userId, nickname, text, sentAt);
        fields.put(FIELD_GAME_ID, String.valueOf(gameId));
        fields.put(FIELD_GAME_NAME, gameName);
        return append(roomId, fields);
    }

    public Optional<ChatLogEntry> findById(String roomId, String chatId) {
        List<MapRecord<String, Object, Object>> records =
                redisTemplate.opsForStream().range(chatKey(roomId), Range.closed(chatId, chatId));
        if (records == null || records.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(toEntry(records.get(0)));
    }

    /** chatId 이하(대상 포함) 최근 count건을 시간순으로. trim으로 밀려났으면 남은 만큼만. */
    public List<ChatLogEntry> findUpTo(String roomId, String chatId, int count) {
        List<MapRecord<String, Object, Object>> records = redisTemplate.opsForStream().reverseRange(
                chatKey(roomId),
                Range.of(Range.Bound.unbounded(), Range.Bound.inclusive(chatId)),
                Limit.limit().count(count));
        List<ChatLogEntry> entries = toEntries(records);
        java.util.Collections.reverse(entries);
        return entries;
    }

    /** chatId 이상(대상 포함) count건을 시간순으로. */
    public List<ChatLogEntry> findFrom(String roomId, String chatId, int count) {
        List<MapRecord<String, Object, Object>> records = redisTemplate.opsForStream().range(
                chatKey(roomId),
                Range.of(Range.Bound.inclusive(chatId), Range.Bound.unbounded()),
                Limit.limit().count(count));
        return toEntries(records);
    }

    private String append(String roomId, Map<String, String> fields) {
        String key = chatKey(roomId);
        RecordId id = redisTemplate.opsForStream()
                .add(StreamRecords.newRecord().in(key).ofStrings(fields));
        // 근사 trim(~) — 정확히 500이 아니라 노드 단위로 잘라 XADD 비용을 줄인다.
        redisTemplate.opsForStream().trim(key, MAX_MESSAGES, true);
        redisTemplate.expire(key, CHAT_TTL);
        return id.getValue();
    }

    private Map<String, String> baseFields(String type, String userId, String nickname,
                                           String text, Instant sentAt) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put(FIELD_TYPE, type);
        fields.put(FIELD_USER_ID, userId);
        fields.put(FIELD_NICKNAME, nickname);
        fields.put(FIELD_TEXT, text);
        fields.put(FIELD_SENT_AT, sentAt.toString());
        return fields;
    }

    private List<ChatLogEntry> toEntries(List<MapRecord<String, Object, Object>> records) {
        List<ChatLogEntry> entries = new ArrayList<>();
        if (records != null) {
            records.forEach(r -> entries.add(toEntry(r)));
        }
        return entries;
    }

    private ChatLogEntry toEntry(MapRecord<String, Object, Object> record) {
        Map<Object, Object> value = record.getValue();
        return new ChatLogEntry(
                record.getId().getValue(),
                (String) value.get(FIELD_TYPE),
                (String) value.get(FIELD_USER_ID),
                (String) value.get(FIELD_NICKNAME),
                (String) value.get(FIELD_TEXT),
                Instant.parse((String) value.get(FIELD_SENT_AT))
        );
    }

    private String chatKey(String roomId) {
        return "room:" + roomId + ":chat";
    }
}
