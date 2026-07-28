package ssafy.a706.backend.whisper;

import java.time.Instant;

/** 귓속말 Stream 엔트리 한 건(-150). whisperId는 XADD가 발급한 ID다. */
public record WhisperLogEntry(
        String whisperId,
        Long senderId,
        String senderNickname,
        String text,
        Instant sentAt
) {
}
