package ssafy.a706.backend.chat;

import java.time.Instant;

/**
 * Redis Stream(room:{roomId}:chat)에서 읽은 채팅 한 건.
 * chatId는 Stream 엔트리 ID(예: 1690001234567-0) — 신고(-132)의 대상 식별자다.
 */
public record ChatLogEntry(
        String chatId,
        String type,
        String userId,
        String nickname,
        String text,
        Instant sentAt
) {
}
