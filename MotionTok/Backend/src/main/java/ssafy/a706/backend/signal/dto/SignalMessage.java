package ssafy.a706.backend.signal.dto;

/**
 * WebRTC 시그널 메시지 (AsyncAPI v0.2 SignalMessage).
 *
 * <h4>개념: 시그널링이 왜 필요한가</h4>
 * WebRTC는 브라우저끼리 영상/음성을 직접(P2P) 주고받는 기술인데, 연결을 맺으려면
 * 서로의 정보를 먼저 교환해야 한다. 그 교환을 대신 전달해 주는 게 시그널링 서버다.
 * <ul>
 *   <li><b>SDP</b> (OFFER/ANSWER): "나는 이런 코덱·해상도로 통신 가능하다"는 미디어 협상 정보.
 *       A가 OFFER를 보내면 B가 ANSWER로 응답한다.</li>
 *   <li><b>ICE candidate</b> (CANDIDATE): "나에게 도달할 수 있는 네트워크 경로 후보"(IP:포트 조합).
 *       연결 수립 중 여러 개가 발견되는 대로 계속 교환된다.</li>
 * </ul>
 * 교환이 끝나 P2P 연결이 열리면 미디어는 서버를 거치지 않는다 — 서버는 소개만 하고 빠지는 것.
 * 그래서 서버는 sdp/candidate 내용을 해석하지 않고 그대로 전달만 한다(candidate가 Object인 이유 —
 * 브라우저 RTCIceCandidate.toJSON() 구조를 통째로 통과).
 *
 * <h4>필드</h4>
 * fromUserId/toUserId는 participantId(회원: userId, 게스트: guest-xxxx) 문자열.
 * 명세의 int64와 다름 — 실코드 식별자 체계에 맞춰 String으로 확정(프론트 합의 필요, MR 참고).
 * type은 enum이라 명세 외 문자열은 역직렬화 단계에서 거부된다.
 */
public record SignalMessage(
        SignalType type,
        String fromUserId,
        String toUserId,
        String sdp,          // OFFER/ANSWER일 때 사용
        Object candidate     // CANDIDATE일 때 사용
) {

    public enum SignalType { OFFER, ANSWER, CANDIDATE }

    /** fromUserId는 클라 입력을 무시하고 서버가 인증 Principal로 덮어쓴다(발신자 위조 방지). */
    public SignalMessage withFrom(String senderId) {
        return new SignalMessage(type, senderId, toUserId, sdp, candidate);
    }
}
