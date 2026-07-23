package ssafy.a706.backend.chat.dto;

import java.time.Instant;

/**
 * 대기실 채팅 브로드캐스트 페이로드 (AsyncAPI ChatMessage).
 * userId는 participantId(회원: userId, 게스트: guest-xxxx) 문자열 —
 * 명세의 int64와 다르며, SignalMessage와 같은 이유로 String 확정(프론트 합의 필요).
 * sentAt은 서버 시각(ISO-8601 직렬화).
 */
public record ChatMessageResponse(
        String userId,
        String nickname,
        String text,
        Instant sentAt
) {
}
