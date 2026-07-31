/**
 * 계측 스킨 — 판정을 눈으로 재기 위한 화면 (S15P11A706-10).
 *
 * 다크 배경 + 네온은 취향이 아니라 계측 요구다. 손목 마커·게이지 같은 얇은 신호를 배경에서
 * 떼어놓으려면 배경이 어두워야 하고, 채도 높은 색이 판정 상태 전환을 프레임 단위로 보게 해준다.
 * 서비스 톤(크림 + 잉크 테두리)과 정반대인 건 알고 있고, 그래서 정식 화면은 별도 스킨이다.
 *
 * `FishingGameView.vue`에 있던 draw 함수들을 그대로 옮긴 것이다 — 색·수치를 바꾸지 않았다.
 */
import { bandYRange, DEPTH_BANDS, type LoopConfig, type LoopState, type Phase, type SceneFish } from '../../loop'
import type { FishingSkin, FishingView, Splash } from '../types'

function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
) {
  ctx.save()
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillText(text, x, y)
  ctx.restore()
}

export const debugSkin: FishingSkin = {
  id: 'debug',
  label: '계측',

  drawBackground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView) {
    const { width: W, height: H, waterY: WATER_Y } = cfg

    // 하늘·바다
    const sky = ctx.createLinearGradient(0, 0, 0, WATER_Y)
    sky.addColorStop(0, '#1c2a5e')
    sky.addColorStop(1, '#2a3f8c')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, WATER_Y)
    const sea = ctx.createLinearGradient(0, WATER_Y, 0, H)
    sea.addColorStop(0, '#0f2f66')
    sea.addColorStop(1, '#081735')
    ctx.fillStyle = sea
    ctx.fillRect(0, WATER_Y, W, H - WATER_Y)

    // 캠 — 물 위에 반투명으로 겹친다(기획 §게임 화면 구성: 내 캠은 반투명)
    const video = view.video
    if (video && video.readyState >= 2) {
      ctx.save()
      ctx.globalAlpha = 0.18
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, W, H)
      ctx.restore()
    }

    // 수면선
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, WATER_Y)
    ctx.lineTo(W, WATER_Y)
    ctx.stroke()

    // 깊이 층 경계 — 단면도에서 y는 깊이다. 층을 안 그리면 계측 화면이 거짓 정보를 준다
    // (물고기가 왜 그 y에 있는지, 미끼가 지금 몇 층인지 읽을 수 없다)
    ctx.save()
    ctx.strokeStyle = 'rgba(61,220,255,0.22)'
    ctx.fillStyle = 'rgba(61,220,255,0.6)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 6])
    for (let i = 0; i < DEPTH_BANDS; i++) {
      const band = bandYRange(cfg, i)
      ctx.beginPath()
      ctx.moveTo(0, band.top)
      ctx.lineTo(W, band.top)
      ctx.stroke()
      ctx.fillText(`층${i} y=${Math.round(band.top)}~${Math.round(band.bottom)}`, 4, band.top + 11)
    }
    ctx.restore()
  },

  // 계측 스킨은 원근을 쓰지 않는다 — 위치·크기를 있는 그대로 봐야 판정을 검증할 수 있다
  drawFish(
    ctx: CanvasRenderingContext2D,
    f: SceneFish,
    isActive: boolean,
    phase: Phase,
    _tMs: number,
    _cfg: LoopConfig,
  ) {
    const r = 8 + (1 - f.spec.requiredRate) * 14
    ctx.save()
    ctx.translate(f.x, f.y)
    if (f.dir < 0) ctx.scale(-1, 1)
    ctx.fillStyle = isActive ? '#FFD23F' : '#3ddcff'
    ctx.globalAlpha = f.interest === 'none' ? 0.75 : 1
    ctx.beginPath()
    ctx.moveTo(-r * 0.9, 0)
    ctx.lineTo(-r * 1.6, -r * 0.55)
    ctx.lineTo(-r * 1.6, r * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0d1020'
    ctx.beginPath()
    ctx.arc(r * 0.5, -r * 0.12, r * 0.11, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // 관심 단계 표시 — 대기의 긴장감을 눈에 보이게 한다
    if (f.interest === 'curious') drawMark(ctx, f.x, f.y - r - 12, '?', '#FFD23F')
    else if (f.interest === 'approaching' && phase === 'waiting')
      drawMark(ctx, f.x, f.y - r - 12, '!', '#FF9F43')
    else if (isActive && phase === 'bite') drawMark(ctx, f.x, f.y - r - 14, '!!', '#FF5D73')
  },

  drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
    ctx.save()
    ctx.strokeStyle = 'rgba(191,233,255,0.7)'
    ctx.lineWidth = 3
    for (const p of splashes) {
      ctx.globalAlpha = Math.max(0, p.life / 0.6)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  },

  drawBobber(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig, tMs: number) {
    const shake = s.phase === 'bite' ? Math.sin(tMs * 0.03) * 4 : 0
    const bx = s.bobber.x
    const by = s.bobber.y + shake
    // 낚싯줄 — 좌상단 앵글러(loop.ts castFrom)에서 수면을 뚫고 미끼까지
    ctx.strokeStyle = 'rgba(244,240,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cfg.width * 0.27, cfg.waterY * 0.5)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.fillStyle = '#FF5D73'
    ctx.beginPath()
    ctx.arc(bx, by - 4, 7, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = '#F4F0FF'
    ctx.beginPath()
    ctx.arc(bx, by + 2, 7, 0, Math.PI)
    ctx.fill()
  },

  /**
   * 착수 범위 미리보기 — 단면도에서 파워는 **착수 x**를 정한다(왼쪽 약하게 ~ 오른쪽 세게).
   * 거리는 스윙 최고 속도로 정해지므로 미리보기 게이지가 없다(cast.ts 주석 ③) — 대신 "이 선
   * 위 어딘가에 떨어진다"는 범위를 보여줘서 세게/약하게 던지는 감을 잡게 한다.
   */
  drawAim(ctx: CanvasRenderingContext2D, cfg: LoopConfig, tMs: number) {
    const nearX = cfg.landNearXPx
    const farX = cfg.width - cfg.landFarMarginPx
    const y = cfg.waterY + cfg.depthMinMarginPx
    ctx.save()
    // 착수 가능 범위 — 수면 아래 가로 막대
    ctx.strokeStyle = 'rgba(198,255,94,0.35)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(nearX, y)
    ctx.lineTo(farX, y)
    ctx.stroke()
    // 양 끝 표시 — 왼쪽이 약하게, 오른쪽이 세게
    const pulse = 5 + Math.sin(tMs / 160) * 2
    ctx.strokeStyle = '#C6FF5E'
    ctx.lineWidth = 2
    for (const x of [nearX, farX]) {
      ctx.beginPath()
      ctx.arc(x, y, pulse, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(198,255,94,0.8)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('약하게', nearX, y + 20)
    ctx.fillText('세게', farX, y + 20)
    ctx.restore()
  },

  drawMarker(
    ctx: CanvasRenderingContext2D,
    marker: { x: number; y: number },
    s: LoopState,
  ) {
    const color =
      s.phase === 'bite' ? '#FF5D73' : s.phase === 'fighting' && s.reeling ? '#C6FF5E' : '#3ddcff'
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 14
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(marker.x, marker.y, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  },

  drawGauges(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg
    if (s.phase === 'fighting') {
      const w = W - 40
      ctx.fillStyle = 'rgba(11,19,48,0.7)'
      ctx.fillRect(20, H - 34, w, 16)
      ctx.fillStyle = s.reeling ? '#C6FF5E' : '#FF5D73'
      ctx.fillRect(20, H - 34, w * s.progress, 16)
      ctx.strokeStyle = 'rgba(244,240,255,0.3)'
      ctx.lineWidth = 1
      ctx.strokeRect(20, H - 34, w, 16)
    }
    if (s.phase === 'bite') {
      const w = W - 40
      const p = s.biteLeftSec / cfg.biteWindowSec
      ctx.fillStyle = 'rgba(11,19,48,0.7)'
      ctx.fillRect(20, H - 34, w, 10)
      ctx.fillStyle = '#FFD23F'
      ctx.fillRect(20, H - 34, w * p, 10)
    }
  },
}
