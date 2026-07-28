package ssafy.a706.backend.whisper.dto;

import ssafy.a706.backend.whisper.WhisperLogEntry;

import java.time.Instant;

/**
 * {@code /user/queue/whisper}로 배달되는 귓속말 한 건(-150), 그리고 대화 이력 조회의 응답 원소.
 *
 * <p>발신자에게도 <b>같은 메시지를 되돌려준다</b>(에코). 대기실 채팅이 자기 말도 토픽으로 돌려받는
 * 것과 같은 규칙이다 — 보낼 때 화면에 먼저 그려 두면 서버가 거절했을 때 유령 말풍선이 남는다.
 *
 * @param conversationWith 이 메시지가 속한 대화의 상대. 받는 쪽에서는 발신자, 보낸 쪽 에코에서는
 *                         수신자가 들어간다. 여러 친구와의 대화창을 구분해 넣으려면 이 값이 필요하다.
 * @param mine             수신자 기준으로 내가 보낸 것인지. 에코면 true
 */
public record WhisperMessageResponse(
        String whisperId,
        Long conversationWith,
        Long senderId,
        String senderNickname,
        String text,
        Instant sentAt,
        boolean mine
) {

    public static WhisperMessageResponse forViewer(WhisperLogEntry entry, Long viewerId, Long counterpartId) {
        return new WhisperMessageResponse(
                entry.whisperId(),
                counterpartId,
                entry.senderId(),
                entry.senderNickname(),
                entry.text(),
                entry.sentAt(),
                entry.senderId().equals(viewerId));
    }
}
