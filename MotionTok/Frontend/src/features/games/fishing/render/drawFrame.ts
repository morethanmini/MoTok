/**
 * 한 프레임을 그린다 — 그리는 순서를 소유하는 유일한 자리 (S15P11A706-10).
 *
 * 스킨은 "무엇을 어떻게" 그릴지만 알고, "언제 어느 순서로"는 여기가 정한다. 순서가 스킨마다
 * 갈리면 스킨을 바꿨을 때 물고기가 배경에 덮이는 식의 버그가 스킨별로 따로 생긴다.
 */
import type { LoopConfig } from '../loop'
import type { FishingSkin, FishingView } from './types'

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  skin: FishingSkin,
  cfg: LoopConfig,
  view: FishingView,
): void {
  const s = view.state

  // 배경이 매 프레임 캔버스를 덮는다 — clearRect가 따로 없는 이유다
  skin.drawBackground(ctx, cfg, view)

  /*
   * 흔들림은 **무대만** 흔든다 — 배경과 HUD는 가만히 있는다.
   *
   * 배경까지 옮기면 이동한 만큼 캔버스 가장자리에 이전 프레임이 남고, HUD까지 흔들면 정작
   * 타격이 온 순간에 문구를 못 읽는다. 게임 화면에서 UI는 고정, 월드가 흔들리는 쪽이 맞다.
   *
   * 난수가 아니라 시각 기반이다. Math.random은 프레임률에 따라 체감이 달라지고 재현이 안 된다.
   * 주파수가 다른 두 sin을 겹쳐 규칙적으로 보이지 않게 했다.
   */
  const shake = view.shake ?? 0
  const shaken = shake > 0.001
  if (shaken) {
    const a = shake * 9
    ctx.save()
    ctx.translate(Math.sin(view.tMs / 17) * a, Math.sin(view.tMs / 11 + 1.7) * a * 0.7)
  }

  for (const f of s.fishes) skin.drawFish(ctx, f, f === s.active, s.phase, view.tMs)
  skin.drawSplashes(ctx, view.splashes)

  if (s.bobber.visible) skin.drawBobber(ctx, s, cfg, view.tMs)
  // 조준선은 백스윙 중에만 — 던지고 나면 조준이 확정되므로 남겨두면 거짓 정보다
  if (s.phase === 'idle' && view.aim.locked) skin.drawAim(ctx, view.aim.x, cfg, view.tMs)
  if (view.marker) skin.drawMarker?.(ctx, view.marker, s)

  if (shaken) ctx.restore()

  // UI는 흔들리지 않는다
  skin.drawGauges(ctx, s, cfg)
  skin.drawHud?.(ctx, view.hud, s, cfg)
}
