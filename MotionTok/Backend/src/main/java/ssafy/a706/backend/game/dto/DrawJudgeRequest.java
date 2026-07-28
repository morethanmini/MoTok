package ssafy.a706.backend.game.dto;

/**
 * POST /api/games/draw/judge — 완성 그림 AI 채점 요청 (그림으로 말해요, 명세 v0.2.22).
 *
 * <p>채점은 서버가 수행한다 — 배포 환경에서 GMS 키를 프론트에 둘 수 없기 때문이고,
 * 덕분에 점수도 서버 권위가 된다(클라이언트는 점수를 보내지 않는다).</p>
 *
 * @param roomId 세션이 진행 중인 방 ID
 * @param image  도화지 PNG data URL (data:image/png;base64,...)
 */
public record DrawJudgeRequest(String roomId, String image) {
}
