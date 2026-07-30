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

  for (const f of s.fishes) skin.drawFish(ctx, f, f === s.active, s.phase, view.tMs)
  skin.drawSplashes(ctx, view.splashes)

  if (s.bobber.visible) skin.drawBobber(ctx, s, cfg, view.tMs)
  // 조준선은 백스윙 중에만 — 던지고 나면 조준이 확정되므로 남겨두면 거짓 정보다
  if (s.phase === 'idle' && view.aim.locked) skin.drawAim(ctx, view.aim.x, cfg, view.tMs)

  // 아래 둘은 스킨이 구현하지 않으면 그냥 안 그려진다 (계측/정식이 갈리는 지점)
  if (view.marker) skin.drawMarker?.(ctx, view.marker, s)
  skin.drawGauges(ctx, s, cfg)
  skin.drawHud?.(ctx, view.hud, s, cfg)
}
