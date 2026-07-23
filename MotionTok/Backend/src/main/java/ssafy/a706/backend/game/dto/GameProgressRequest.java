package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/progress — 라운드 중 진행 상황(클라이언트 2~5Hz 스로틀 전제).
 * 서버는 저장하지 않고 검증·클램프 후 그대로 방 토픽에 중계한다.
 */
public record GameProgressRequest(Integer starsLit, Double holdProgress) {
}
