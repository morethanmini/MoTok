package ssafy.a706.backend.game.dto;

/**
 * 참가자 준비 완료 회신(-162, SEND /app/rooms/{roomId}/game/ready).
 * prepareId는 GAME_PREPARE로 받은 값 그대로 — 지난 준비 라운드의 늦은 신호를 걸러내는 식별자.
 */
public record GameReadyRequest(String prepareId) {
}
