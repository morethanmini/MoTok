package ssafy.a706.backend.presence.controller.dto;

/**
 * 다음 하트비트까지 기다릴 초. <b>서버가 간격을 정해 내려주는</b> 이유는 TTL과의 어긋남을 막기 위해서다 —
 * 프론트가 자기 상수로 간격을 들고 있으면 서버 TTL만 바뀌었을 때 친구가 오프라인으로 깜빡인다.
 *
 * @param intervalSeconds 다음 호출까지의 권장 대기 시간
 */
public record HeartbeatResponse(long intervalSeconds) {
}
