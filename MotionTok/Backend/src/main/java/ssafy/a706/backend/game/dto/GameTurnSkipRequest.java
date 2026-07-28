package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/turn-skip — 현재 화가의 조기 차례 넘기기 (명세 v0.2.20).
 * remainingMs는 발신 시점 남은 그리기 시간 — 서버가 클램프 후 TURN_SKIPPED로 재방송하면
 * 전 클라이언트가 같은 값만큼 턴 스케줄을 앞당긴다(차례 강제는 클라이언트 몫).
 */
public record GameTurnSkipRequest(Integer turnIndex, Long remainingMs) {
}
