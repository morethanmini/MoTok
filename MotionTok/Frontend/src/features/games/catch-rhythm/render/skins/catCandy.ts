/**
 * 기본 스킨 「캣캔디」 — 파스텔 피치 픽셀아트 톤(catchcatchrhythm.png).
 *
 * 1차는 전부 절차 드로잉이다 — 스프라이트·음원 에셋이 나오면 이 파일만 갈아끼우면 된다.
 *
 * 타이밍 가독성(2026-07-27 피드백):
 *  - **판정 링**: 판정 크기 그대로인 고정 점선 원. "여기까지 오면 친다"의 기준선.
 *  - **접근 링**: 바깥에서 판정 링으로 조여든다. 두 원이 겹치는 순간이 PERFECT.
 * 커서는 발바닥 대신 **손 골격 그대로** 그린다 — 내 손이라는 감각이 훨씬 낫다.
 */

import { HAND_BONES, type CatchSkin, type HandView, type HitFxView, type NoteView } from './types'
import type { Hand, NoteHand } from '../../core/types'

const PALETTE: Record<NoteHand, { body: string; edge: string; glow: string }> = {
  left: { body: '#b9a8ff', edge: '#7a63e0', glow: '#e3dcff' }, // 파스텔 퍼플
  right: { body: '#ffb38a', edge: '#e07a4f', glow: '#ffe2cf' }, // 코랄
  any: { body: '#9fe6c8', edge: '#3fa87e', glow: '#dcf7ec' }, // 민트 — 아무 손이나
}
const HAND_COLOR: Record<Hand, string> = { left: '#7a63e0', right: '#e07a4f' }

const FX_MS = 420

/** 판정 링 + 접근 링 — 노트보다 먼저(아래에) 그린다. */
function timingRings(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, judgeRadius, progress } = note
  const c = PALETTE[note.hand]

  ctx.save()
  // 판정 링 — 고정. 접근 중에는 은은하게, 판정 순간에 또렷해진다.
  const near = Math.max(0, 1 - Math.abs(1 - progress) * 3)
  ctx.globalAlpha = 0.3 + 0.55 * near
  ctx.strokeStyle = c.edge
  ctx.lineWidth = Math.max(1.5, judgeRadius * 0.1)
  ctx.setLineDash([judgeRadius * 0.45, judgeRadius * 0.35])
  ctx.beginPath()
  ctx.arc(x, y, judgeRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // 접근 링 — 바깥에서 판정 링으로 수렴. 판정선을 지나면 안 그린다.
  if (progress < 1) {
    const outer = judgeRadius * (1 + 2.4 * (1 - progress))
    ctx.globalAlpha = 0.25 + 0.5 * progress
    ctx.lineWidth = Math.max(1.5, judgeRadius * 0.13)
    ctx.beginPath()
    ctx.arc(x, y, outer, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function bubble(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius } = note
  const c = PALETTE[note.hand]

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

/** catch 노트 속 음표 */
function musicNote(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius } = note
  if (radius < 12) return
  const s = radius * 0.5
  ctx.fillStyle = PALETTE[note.hand].edge
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

/** swipe 노트 — 쥐지 않고 스쳐도 되는 노트라 '통과' 느낌의 이중 갈매기로 구분한다 */
function swipeMark(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius } = note
  if (radius < 10) return
  const s = radius * 0.55
  ctx.save()
  ctx.strokeStyle = PALETTE[note.hand].edge
  ctx.lineWidth = Math.max(2, radius * 0.16)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const off of [-s * 0.45, s * 0.35]) {
    ctx.beginPath()
    ctx.moveTo(x + off - s * 0.3, y - s * 0.55)
    ctx.lineTo(x + off + s * 0.3, y)
    ctx.lineTo(x + off - s * 0.3, y + s * 0.55)
    ctx.stroke()
  }
  ctx.restore()
}

/** 손 골격 — 뼈대 + 관절. 쥐면 색이 진해지고 굵어진다. */
function handSkeleton(ctx: CanvasRenderingContext2D, hand: HandView) {
  const { landmarks, isFist, side, radius } = hand
  const color = HAND_COLOR[side]

  ctx.save()
  if (landmarks.length < 21) {
    // 트래킹이 불완전하면 손바닥 위치만이라도 표시
    ctx.globalAlpha = 0.8
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(hand.x, hand.y, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  const bone = Math.max(2.5, radius * 0.22) * (isFist ? 1.5 : 1)
  ctx.globalAlpha = isFist ? 1 : 0.8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 흰 외곽선을 깔아 배경과 상관없이 손이 보이게 한다
  for (const [width, stroke] of [
    [bone + 4, 'rgba(255,255,255,0.9)'],
    [bone, color],
  ] as const) {
    ctx.lineWidth = width
    ctx.strokeStyle = stroke
    ctx.beginPath()
    for (const [a, b] of HAND_BONES) {
      const p = landmarks[a]
      const q = landmarks[b]
      if (!p || !q) continue
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
    }
    ctx.stroke()
  }

  // 손끝 관절 강조 — 손 방향을 읽기 쉽게
  ctx.fillStyle = color
  for (const i of [4, 8, 12, 16, 20]) {
    const p = landmarks[i]
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x, p.y, bone * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }

  // 쥔 상태 표시 — 판정 반경을 채운 원
  if (isFist) {
    ctx.globalAlpha = 0.22
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(hand.x, hand.y, radius, 0, Math.PI * 2)
    ctx.fill()
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
    timingRings(ctx, note)
    ctx.save()
    ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, note.scale)
    bubble(ctx, note)
    if (note.kind === 'swipe') swipeMark(ctx, note)
    else musicNote(ctx, note)
    ctx.restore()
  },

  drawHitFx(ctx, fx) {
    const t = fx.elapsedMs / FX_MS
    if (t >= 1) return false
    const c = PALETTE[fx.hand]
    ctx.save()

    if (fx.judgement === 'miss') {
      ctx.globalAlpha = (1 - t) * 0.5
      ctx.strokeStyle = '#9b8f88'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(fx.x, fx.y, fx.radius * (1 + t * 0.3), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      return true
    }

    ctx.globalAlpha = 1 - t
    ctx.strokeStyle = c.edge
    ctx.lineWidth = Math.max(1.5, fx.radius * 0.16 * (1 - t))
    ctx.beginPath()
    ctx.arc(fx.x, fx.y, fx.radius * (1 + t * 1.1), 0, Math.PI * 2)
    ctx.stroke()

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
    handSkeleton(ctx, hand)
  },

  sfx: {
    perfect: { type: 'sine', freq: 880, sweepTo: 1620, durationMs: 130, gain: 0.32 },
    good: { type: 'sine', freq: 620, sweepTo: 880, durationMs: 120, gain: 0.24 },
    miss: { type: 'triangle', freq: 220, sweepTo: 110, durationMs: 180, gain: 0.16 },
  },
}
