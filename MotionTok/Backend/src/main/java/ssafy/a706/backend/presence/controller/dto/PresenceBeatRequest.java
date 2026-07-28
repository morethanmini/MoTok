package ssafy.a706.backend.presence.controller.dto;

/**
 * 전역 STOMP 연결로 올라오는 주기 하트비트(-143). 종전 {@code POST /presence/heartbeat}의 대체다.
 *
 * @param roomId          지금 있는 방. 로비·마이페이지처럼 방 밖이면 null
 * @param intervalSeconds 클라이언트가 <b>현재 쓰고 있는</b> 간격.
 *                        서버가 아는 값과 다를 때만 정정 프레임을 돌려주기 위한 것이라,
 *                        정상 상태에서는 응답이 아예 나가지 않는다(첫 비트만 null로 보내 값을 받아 간다).
 */
public record PresenceBeatRequest(String roomId, Long intervalSeconds) {

    public boolean knows(long serverIntervalSeconds) {
        return intervalSeconds != null && intervalSeconds == serverIntervalSeconds;
    }
}
