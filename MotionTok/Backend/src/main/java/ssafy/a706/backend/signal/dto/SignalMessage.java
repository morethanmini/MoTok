package ssafy.a706.backend.signal.dto;

/**
 * WebRTC 시그널 메시지 (AsyncAPI v0.2 SignalMessage).
 * fromUserId/toUserId는 participantId(회원: userId, 게스트: guest-xxxx) 문자열이다.
 * 명세의 int64와 다름 — 실코드 식별자 체계에 맞춰 String으로 확정(프론트 합의 필요, MR 참고).
 */
public record SignalMessage(
        SignalType type,
        String fromUserId,
        String toUserId,
        String sdp,          // OFFER/ANSWER
        Object candidate     // ICE candidate(구조는 브라우저 RTCIceCandidate 그대로 통과)
) {

    public enum SignalType { OFFER, ANSWER, CANDIDATE }

    /** fromUserId는 클라 입력을 무시하고 서버가 인증 Principal로 덮어쓴다(발신자 위조 방지). */
    public SignalMessage withFrom(String senderId) {
        return new SignalMessage(type, senderId, toUserId, sdp, candidate);
    }
}
