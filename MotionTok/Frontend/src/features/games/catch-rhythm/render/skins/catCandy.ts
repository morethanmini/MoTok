/**
 * 기본 스킨 「캣캔디」 — 파스텔 피치 픽셀아트 톤(catchcatchrhythm.png).
 * 노트 = 캔디색 음표 버블, 커서 = 고양이 발바닥, 히트 = 버블 팝 + 별 파티클.
 *
 * 1차는 전부 절차 드로잉이다 — 스프라이트·음원 에셋이 나오면 이 파일만 갈아끼우면 된다.
 * 크로스 노트는 시각 구분을 하지 않는다("어? 왼손이 오른쪽에!?"가 의도된 재미).
 */

import type { CatchSkin, HandView, HitFxView, NoteView } from './types'
import type { Hand } from '../../core/types'

const PALETTE: Record<Hand, { body: string; edge: string; glow: string }> = {
  left: { body: '#b9a8ff', edge: '#7a63e0', glow: '#e3dcff' }, // 파스텔 퍼플
  right: { body: '#ffb38a', edge: '#e07a4f', glow: '#ffe2cf' }, // 코랄
}

const FX_MS = 420

function bubble(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius, hand } = note
  const c = PALETTE[hand]

  // 본체 — 위쪽이 밝은 캔디 그라데이션
  const grad = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.35,
    radius * 0.1,
    x,
    y,
    radius,
  )
  grad.addColorStop(0, c.glow)
  grad.addColorStop(1, c.body)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()

  ctx.lineWidth = Math.max(1.5, radius * 0.12)
  ctx.strokeStyle = c.edge
  ctx.stroke()

  // 하이라이트
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.ellipse(
    x - radius * 0.32,
    y - radius * 0.38,
    radius * 0.2,
    radius * 0.13,
    -0.6,
    0,
    Math.PI * 2,
  )
  ctx.fill()
}

/** 버블 안 음표 — 반지름이 작을 땐 생략(뭉개짐 방지) */
function musicNote(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius, hand } = note
  if (radius < 12) return
  const s = radius * 0.5
  ctx.fillStyle = PALETTE[hand].edge
  ctx.beginPath()
  ctx.ellipse(x - s * 0.35, y + s * 0.55, s * 0.42, s * 0.32, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(x + s * 0.02, y - s * 0.75, Math.max(1.5, s * 0.14), s * 1.35)
  ctx.beginPath()
  ctx.moveTo(x + s * 0.02, y - s * 0.75)
  ctx.quadraticCurveTo(x + s * 0.85, y - s * 0.6, x + s * 0.6, y - s * 0.05)
  ctx.lineTo(x + s * 0.55, y - s * 0.3)
  ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.5, x + s * 0.16, y - s * 0.5)
  ctx.closePath()
  ctx.fill()
}

/** 고양이 발바닥 — 큰 젤리 하나 + 발가락 4개. 쥐면 오므린다. */
function paw(ctx: CanvasRenderingContext2D, hand: HandView) {
  const { x, y, radius, isFist, side } = hand
  const c = PALETTE[side]
  const squeeze = isFist ? 0.62 : 1
  const spread = isFist ? 0.72 : 1

  ctx.save()
  ctx.globalAlpha = 0.92

  // 발바닥 젤리
  ctx.fillStyle = c.body
  ctx.strokeStyle = c.edge
  ctx.lineWidth = Math.max(1.5, radius * 0.14)
  ctx.beginPath()
  ctx.ellipse(
    x,
    y + radius * 0.18,
    radius * 0.72 * squeeze,
    radius * 0.6 * squeeze,
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  ctx.stroke()

  // 발가락
  const toes: [number, number][] = [
    [-0.62, -0.5],
    [-0.22, -0.78],
    [0.22, -0.78],
    [0.62, -0.5],
  ]
  for (const [tx, ty] of toes) {
    ctx.beginPath()
    ctx.ellipse(
      x + tx * radius * spread,
      y + ty * radius * spread,
      radius * 0.24 * squeeze,
      radius * 0.28 * squeeze,
      tx * 0.5,
      0,
      Math.PI * 2,
    )
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = (Math.PI / 5) * i - Math.PI / 2
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

export const catCandySkin: CatchSkin = {
  id: 'cat-candy',
  label: '캣캔디',

  drawBackground(ctx, w, h, tMs) {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#fff3ea')
    grad.addColorStop(1, '#ffe6d8')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // 천천히 흐르는 구름 — 시간 기반이라 프레임률과 무관
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (let i = 0; i < 3; i++) {
      const speed = 0.008 + i * 0.004
      const cx = ((tMs * speed + i * w * 0.4) % (w + 260)) - 130
      const cy = h * (0.16 + i * 0.26)
      const r = h * (0.07 + i * 0.015)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.arc(cx + r * 0.9, cy + r * 0.15, r * 0.75, 0, Math.PI * 2)
      ctx.arc(cx - r * 0.85, cy + r * 0.2, r * 0.65, 0, Math.PI * 2)
      ctx.fill()
    }
  },

  drawNote(ctx, note) {
    ctx.save()
    // 원경일수록 흐리게 — 접근감
    ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, note.scale)
    bubble(ctx, note)
    musicNote(ctx, note)
    ctx.restore()
  },

  drawHitFx(ctx, fx) {
    const t = fx.elapsedMs / FX_MS
    if (t >= 1) return false
    const c = PALETTE[fx.hand]
    ctx.save()

    if (fx.judgement === 'miss') {
      // 미스는 조용히 스러진다
      ctx.globalAlpha = (1 - t) * 0.5
      ctx.strokeStyle = '#9b8f88'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(fx.x, fx.y, fx.radius * (1 + t * 0.3), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      return true
    }

    // 버블 팝 — 링이 퍼지며 옅어진다
    ctx.globalAlpha = 1 - t
    ctx.strokeStyle = c.edge
    ctx.lineWidth = Math.max(1.5, fx.radius * 0.16 * (1 - t))
    ctx.beginPath()
    ctx.arc(fx.x, fx.y, fx.radius * (1 + t * 1.1), 0, Math.PI * 2)
    ctx.stroke()

    // 별 파티클 — PERFECT만 사방으로 튄다
    const count = fx.judgement === 'perfect' ? 6 : 3
    ctx.fillStyle = fx.judgement === 'perfect' ? '#ffd66b' : c.glow
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + t * 0.8
      const d = fx.radius * (0.6 + t * 1.6)
      star(ctx, fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, fx.radius * 0.22 * (1 - t))
    }
    ctx.restore()
    return true
  },

  drawCursor(ctx, hand) {
    paw(ctx, hand)
  },

  sfx: {
    // 뽁 — 짧고 높게 튀어오른다
    perfect: { type: 'sine', freq: 880, sweepTo: 1620, durationMs: 130, gain: 0.32 },
    good: { type: 'sine', freq: 620, sweepTo: 880, durationMs: 120, gain: 0.24 },
    // 미스는 낮게 떨어지는 힘없는 소리
    miss: { type: 'triangle', freq: 220, sweepTo: 110, durationMs: 180, gain: 0.16 },
  },
}
