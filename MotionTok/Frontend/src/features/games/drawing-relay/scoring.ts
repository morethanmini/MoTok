/**
 * 그림으로 말해요 — 완성 그림 AI 채점 요청.
 *
 * 채점은 <b>서버가</b> 한다 — 배포 환경에서 GMS 키를 프론트 번들에 둘 수 없기 때문이고,
 * 그 덕분에 점수 계산도 서버 권위가 된다(클라이언트는 점수를 보내지 않는다).
 * 여기서는 도화지 이미지만 올리고, 결과는 응답이 아니라 방 토픽의 DRAW_RESULT로 받는다
 * (관전자도 같은 화면을 보므로 발신자만 결과를 받을 이유가 없다).
 */
import { gamesApi } from '@/api'

/**
 * @param roomId 세션이 진행 중인 방 ID
 * @param imageDataUrl 완성 그림 PNG data URL
 */
export async function requestJudge(roomId: string, imageDataUrl: string): Promise<void> {
  await gamesApi.judgeDrawing(roomId, imageDataUrl)
}
