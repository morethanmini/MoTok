package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/start (방장 전용).
 * constellationKey는 선택 — null/미지정이면 서버가 무작위 선택한다(전원 동일 과제 보장).
 */
public record GameStartRequest(Long gameId, String constellationKey) {
}
