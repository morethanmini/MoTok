package ssafy.a706.backend.whisper;

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
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 귓속말 로그(-150) Redis 접근 계층. 키맵: {@code whisper:{작은id}:{큰id}} (Stream, TTL 7d).
 *
 * <p><b>왜 대화방 키를 정렬해서 만드나</b> — A→B와 B→A는 같은 대화다. 보낸 사람 기준으로 키를
 * 만들면 같은 대화가 두 갈래로 쪼개져 한쪽에서 보낸 말이 다른 쪽 기록에 없다.
 * 두 id를 오름차순으로 붙여 <b>쌍마다 키 하나</b>를 강제한다.</p>
 *
 * <p><b>왜 대기실 채팅과 같은 Stream인가</b> — 엔트리 ID가 곧 메시지 식별자라, 신고(-132)가
 * "이 메시지"를 지목하는 방식과 전후 맥락 조회 방식을 그대로 재사용할 수 있다.
 * 보관 상한과 TTL만 성격에 맞게 다르다 — 방 채팅은 방과 함께 사라지지만(24h) 귓속말은
 * 방을 나가도 이어지는 대화라 더 길게(7d) 남긴다.</p>
 */
@Repository
@RequiredArgsConstructor
public class WhisperLogRepository {

    /** 대화가 이어지는 감각을 주기 위한 보관 기간. 영구 보관은 RDB로 승격할 때 다룬다. */
    private static final Duration WHISPER_TTL = Duration.ofDays(7);

    /** 대화방당 보관 상한(메시지 개수). 도배 시 메모리 상한 역할도 겸한다. */
    private static final long MAX_MESSAGES = 200;

    private static final String FIELD_SENDER_ID = "senderId";
    private static final String FIELD_SENDER_NICKNAME = "senderNickname";
    private static final String FIELD_TEXT = "text";
    private static final String FIELD_SENT_AT = "sentAt";

    private final StringRedisTemplate redisTemplate;

    /** @return 발급된 whisperId(Stream 엔트리 ID) */
    public String append(Long senderId, Long receiverId, String senderNickname, String text, Instant sentAt) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put(FIELD_SENDER_ID, String.valueOf(senderId));
        fields.put(FIELD_SENDER_NICKNAME, senderNickname);
        fields.put(FIELD_TEXT, text);
        fields.put(FIELD_SENT_AT, sentAt.toString());

        String key = conversationKey(senderId, receiverId);
        RecordId id = redisTemplate.opsForStream()
                .add(StreamRecords.newRecord().in(key).ofStrings(fields));
        // 근사 trim(~) — 정확히 200이 아니라 노드 단위로 잘라 XADD 비용을 줄인다(채팅 로그와 동일).
        redisTemplate.opsForStream().trim(key, MAX_MESSAGES, true);
        redisTemplate.expire(key, WHISPER_TTL);
        return id.getValue();
    }

    /** 최근 count건을 시간순으로. 대화창을 열 때 한 번 읽는다. */
    public List<WhisperLogEntry> findRecent(Long userId, Long counterpartId, int count) {
        List<MapRecord<String, Object, Object>> records = redisTemplate.opsForStream().reverseRange(
                conversationKey(userId, counterpartId),
                Range.unbounded(),
                Limit.limit().count(count));
        List<WhisperLogEntry> entries = new ArrayList<>();
        if (records != null) {
            records.forEach(r -> entries.add(toEntry(r)));
        }
        Collections.reverse(entries);
        return entries;
    }

    private WhisperLogEntry toEntry(MapRecord<String, Object, Object> record) {
        Map<Object, Object> value = record.getValue();
        return new WhisperLogEntry(
                record.getId().getValue(),
                Long.parseLong((String) value.get(FIELD_SENDER_ID)),
                (String) value.get(FIELD_SENDER_NICKNAME),
                (String) value.get(FIELD_TEXT),
                Instant.parse((String) value.get(FIELD_SENT_AT))
        );
    }

    /** 두 사람의 대화는 방향과 무관하게 한 키다 — 작은 id를 앞에 둬 순서를 고정한다. */
    private String conversationKey(Long a, Long b) {
        long low = Math.min(a, b);
        long high = Math.max(a, b);
        return "whisper:" + low + ":" + high;
    }
}
