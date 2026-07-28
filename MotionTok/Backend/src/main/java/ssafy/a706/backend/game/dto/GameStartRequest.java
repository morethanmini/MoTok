package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/start (방장 전용).
 * constellationKey는 게임① 선택 과제 — null/미지정이면 서버가 무작위 선택한다(전원 동일 과제 보장).
 * difficulty는 게임④ 난이도(easy/normal/hard, S15P11A706-86) — 벽 접근 시간을 정한다. null이면 easy.
 */
public record GameStartRequest(Long gameId, String constellationKey, String difficulty) {
}
