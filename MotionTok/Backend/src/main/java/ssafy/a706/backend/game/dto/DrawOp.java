package ssafy.a706.backend.game.dto;

/**
 * 그림으로 말해요(게임 10) 획 연산 — DRAW 릴레이 페이로드 원소 (명세 v0.2.20).
 *
 * <ul>
 *   <li>begin — 새 획 시작(tool·x·y 유효)</li>
 *   <li>point — 진행 중인 획에 점 추가(x·y 유효)</li>
 *   <li>end — 획 종료</li>
 *   <li>trim — 직전 획을 x개 점으로 절단(펜을 놓는 순간의 꼬리 삭제를 관전자와 동기화)</li>
 * </ul>
 * x·y는 도화지 960×540 논리 좌표. 서버는 내용을 해석하지 않고 그대로 재방송한다.
 */
public record DrawOp(String type, String tool, Double x, Double y) {
}
