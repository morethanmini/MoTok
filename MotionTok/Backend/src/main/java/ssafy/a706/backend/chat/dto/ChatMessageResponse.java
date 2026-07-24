package ssafy.a706.backend.chat.dto;

import java.time.Instant;

/**
 * 대기실 채팅 브로드캐스트 페이로드 (AsyncAPI ChatMessage).
 * chatId는 서버(Redis Stream)가 발급한 메시지 고유 ID — 채팅 신고(-132)의 대상 지목에 쓴다.
 * userId는 participantId(회원: userId, 게스트: guest-xxxx) 문자열(명세 v0.2.13).
 * type으로 일반 채팅(TALK)과 게임 제안(GAME_SUGGEST)을 구분한다 —
 * gameId/gameName은 GAME_SUGGEST일 때만 채워지고, text는 타입 무관 표시용 문구(폴백 겸용).
 * sentAt은 서버 시각(ISO-8601 직렬화).
 */
public record ChatMessageResponse(
        String chatId,
        MessageType type,
        String userId,
        String nickname,
        String text,
        Long gameId,
        String gameName,
        Instant sentAt
) {

    public enum MessageType { TALK, GAME_SUGGEST }

    public static ChatMessageResponse talk(String chatId, String userId, String nickname,
                                           String text, Instant sentAt) {
        return new ChatMessageResponse(chatId, MessageType.TALK, userId, nickname, text, null, null, sentAt);
    }

    public static ChatMessageResponse gameSuggest(String chatId, String userId, String nickname, String text,
                                                  Long gameId, String gameName, Instant sentAt) {
        return new ChatMessageResponse(chatId, MessageType.GAME_SUGGEST, userId, nickname, text,
                gameId, gameName, sentAt);
    }
}
