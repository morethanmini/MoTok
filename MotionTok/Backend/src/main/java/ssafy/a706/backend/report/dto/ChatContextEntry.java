package ssafy.a706.backend.report.dto;

import ssafy.a706.backend.chat.ChatLogEntry;

import java.time.Instant;

/**
 * 신고 스냅샷(context_json)의 원소 — 채팅 한 건.
 * 시간순 배열로 저장·반환되며, chatId가 신고 대상과 일치하는 원소를 관리자 UI가 하이라이트한다.
 */
public record ChatContextEntry(
        String chatId,
        String type,
        String userId,
        String nickname,
        String text,
        Instant sentAt
) {

    public static ChatContextEntry from(ChatLogEntry entry) {
        return new ChatContextEntry(entry.chatId(), entry.type(), entry.userId(),
                entry.nickname(), entry.text(), entry.sentAt());
    }
}
