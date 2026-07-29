package ssafy.a706.backend.whisper;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Range;
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

/**
 * 오프라인 수신자의 미배달 귓속말 수신함(-160). 키맵: {@code whisper:pending:{userId}} (Stream, TTL 7d).
 *
 * <p>대화 로그({@link WhisperLogRepository})와의 역할 차이 — 로그는 <b>대화 내용의 원장</b>이고,
 * 이 수신함은 "접속하지 않은 동안 도착한 게 있다"는 <b>배달 대기열</b>이다. 로그만으로는 수신자가
 * 로그인했을 때 어느 친구 대화에 새 메시지가 있는지 전부 뒤져봐야 알 수 있어서,
 * 수신자 기준 키 하나에 밀린 메시지를 복사해 둔다.</p>
 *
 * <p>엔트리에는 대화 Stream이 발급한 <b>원본 whisperId를 그대로 싣는다</b> — FE가 이력 조회와
 * 수신함 회수를 whisperId로 중복 제거하므로, 여기서 새 ID를 만들면 같은 메시지가 두 번 그려진다.</p>
 *
 * <p>회수(drain)는 읽은 엔트리만 XDEL로 지운다 — 키 전체 DEL은 읽는 사이에 도착한 메시지까지
 * 지워버린다(접속 직후 프레즌스 전환과 회수가 겹치는 창이 있다).</p>
 */
@Repository
@RequiredArgsConstructor
public class WhisperPendingRepository {

    /** 대화 로그와 같은 보관 기간 — 로그가 사라진 메시지를 수신함만 더 오래 들고 있을 이유가 없다. */
    private static final Duration PENDING_TTL = Duration.ofDays(7);

    /** 수신자당 보관 상한. 초과분은 오래된 것부터 밀려난다(대화 로그 200과 같은 선). */
    private static final long MAX_PENDING = 200;

    private static final String FIELD_WHISPER_ID = "whisperId";
    private static final String FIELD_SENDER_ID = "senderId";
    private static final String FIELD_SENDER_NICKNAME = "senderNickname";
    private static final String FIELD_TEXT = "text";
    private static final String FIELD_SENT_AT = "sentAt";

    private final StringRedisTemplate redisTemplate;

    /** 오프라인 수신자 앞으로 한 건 적재한다. whisperId는 대화 Stream이 발급한 원본 ID. */
    public void push(Long receiverId, WhisperLogEntry entry) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put(FIELD_WHISPER_ID, entry.whisperId());
        fields.put(FIELD_SENDER_ID, String.valueOf(entry.senderId()));
        fields.put(FIELD_SENDER_NICKNAME, entry.senderNickname());
        fields.put(FIELD_TEXT, entry.text());
        fields.put(FIELD_SENT_AT, entry.sentAt().toString());

        String key = pendingKey(receiverId);
        redisTemplate.opsForStream().add(StreamRecords.newRecord().in(key).ofStrings(fields));
        redisTemplate.opsForStream().trim(key, MAX_PENDING, true);
        redisTemplate.expire(key, PENDING_TTL);
    }

    /** 수신함을 비우면서 전부 꺼낸다(시간순). 읽은 엔트리만 지우므로 회수 중 도착분은 남는다. */
    public List<WhisperLogEntry> drain(Long receiverId) {
        String key = pendingKey(receiverId);
        List<MapRecord<String, Object, Object>> records =
                redisTemplate.opsForStream().range(key, Range.unbounded());
        List<WhisperLogEntry> entries = new ArrayList<>();
        if (records == null || records.isEmpty()) {
            return entries;
        }
        List<RecordId> readIds = new ArrayList<>();
        for (MapRecord<String, Object, Object> record : records) {
            Map<Object, Object> value = record.getValue();
            entries.add(new WhisperLogEntry(
                    (String) value.get(FIELD_WHISPER_ID),
                    Long.parseLong((String) value.get(FIELD_SENDER_ID)),
                    (String) value.get(FIELD_SENDER_NICKNAME),
                    (String) value.get(FIELD_TEXT),
                    Instant.parse((String) value.get(FIELD_SENT_AT))
            ));
            readIds.add(record.getId());
        }
        redisTemplate.opsForStream().delete(key, readIds.toArray(new RecordId[0]));
        return entries;
    }

    private String pendingKey(Long receiverId) {
        return "whisper:pending:" + receiverId;
    }
}
