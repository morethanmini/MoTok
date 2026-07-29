/**
 * 디버그 스킨 — 미니멀. 두 가지 목적으로 존재한다.
 * 1) 스킨이 정말 갈아끼워지는지 증명 (문자열 하나로 전환)
 * 2) 판정 튜닝 — 판정 반경·접근 진행도·노트 종류·크로스 여부를 눈으로 본다
 */

import { HAND_BONES, type CatchSkin, type NoteView } from './types'
import type { Hand, NoteHand } from '../../core/types'

const COLOR: Record<NoteHand, string> = {
  left: '#6aa9ff',
  right: '#ff7a7a',
  any: '#b79bff',
}
const HAND_COLOR: Record<Hand, string> = { left: '#6aa9ff', right: '#ff7a7a' }
const FX_MS = 300

function rings(ctx: CanvasRenderingContext2D, note: NoteView) {
  const c = COLOR[note.hand]
  ctx.save()
  // 판정 링(고정)
  ctx.strokeStyle = c
  ctx.globalAlpha = 0.9
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.arc(note.x, note.y, note.judgeRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  // 판정창 신호 — 창 안이면 흰 링
  if (note.readiness > 0) {
    ctx.globalAlpha = note.readiness
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(note.x, note.y, note.judgeRadius * 1.3, 0, Math.PI * 2)
    ctx.stroke()
  }
  // 접근 링
  if (note.progress < 1) {
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(note.x, note.y, note.judgeRadius * (1 + 2.4 * (1 - note.progress)), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

export const debugSkin: CatchSkin = {
  id: 'debug',
  label: '디버그',

  drawBackground(ctx, w, h) {
    ctx.fillStyle = '#101418'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w / 2, h)
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
  },

  drawNote(ctx, note) {
    if (note.path && note.path.length >= 2) {
      ctx.save()
      ctx.strokeStyle = COLOR[note.hand]
      ctx.globalAlpha = note.tracing ? 0.9 : 0.4
      ctx.lineWidth = note.judgeRadius * 0.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(note.path[0]!.x, note.path[0]!.y)
      for (let i = 1; i < note.path.length; i++) ctx.lineTo(note.path[i]!.x, note.path[i]!.y)
      ctx.stroke()
      if (note.head) {
        ctx.globalAlpha = 1
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(note.head.x, note.head.y, note.judgeRadius * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    if (note.tracing) return

    rings(ctx, note)
    ctx.save()
    ctx.fillStyle = COLOR[note.hand]
    ctx.globalAlpha = 0.25 + 0.55 * Math.min(1, note.scale)
    ctx.beginPath()
    ctx.arc(note.x, note.y, note.radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 1
    ctx.strokeStyle = COLOR[note.hand]
    ctx.lineWidth = 2
    const d = note.radius * 0.5
    if (note.kind === 'swipe') {
      // 스와이프 = 화살표
      ctx.beginPath()
      ctx.moveTo(note.x - d, note.y)
      ctx.lineTo(note.x + d, note.y)
      ctx.moveTo(note.x + d * 0.3, note.y - d * 0.5)
      ctx.lineTo(note.x + d, note.y)
      ctx.lineTo(note.x + d * 0.3, note.y + d * 0.5)
      ctx.stroke()
    }
    if (note.hand !== 'any') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.round(note.radius * 0.9)}px "DNF Bit Bit", monospace`
      ctx.fillText(note.hand === 'left' ? 'L' : 'R', note.x, note.y)
    }
    if (note.cross) {
      // 크로스 = X
      ctx.beginPath()
      ctx.moveTo(note.x - d, note.y - d)
      ctx.lineTo(note.x + d, note.y + d)
      ctx.moveTo(note.x + d, note.y - d)
      ctx.lineTo(note.x - d, note.y + d)
      ctx.stroke()
    }
    ctx.restore()
  },

  drawHitFx(ctx, fx) {
    const t = fx.elapsedMs / fx.lifeMs
    if (t >= 1) return false
    const color =
      fx.judgement === 'perfect' ? '#7dff9b' : fx.judgement === 'good' ? '#ffe066' : '#ff5c5c'
    ctx.save()
    ctx.globalAlpha = 1 - t
    ctx.strokeStyle = color
    ctx.lineWidth = 3 * (1 - t)
    ctx.beginPath()
    ctx.arc(fx.x, fx.y, fx.radius * (0.8 + t * 2.4), 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.font = `${Math.round(fx.radius * 0.78)}px "DNF Bit Bit", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(fx.judgement.toUpperCase(), fx.x, fx.y - t * fx.radius * 2)
    ctx.restore()
    return true
  },

  drawCursor(ctx, hand) {
    const color = HAND_COLOR[hand.side]
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color

    if (hand.landmarks.length >= 21) {
      ctx.lineWidth = 2
      ctx.beginPath()
      for (const [a, b] of HAND_BONES) {
        const p = hand.landmarks[a]
        const q = hand.landmarks[b]
        if (!p || !q) continue
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
      }
      ctx.stroke()
      for (const p of hand.landmarks) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 판정 반경 — 튜닝의 핵심 정보라 항상 그린다
    ctx.lineWidth = 2
    ctx.globalAlpha = hand.isFist ? 1 : 0.45
    ctx.beginPath()
    ctx.arc(hand.x, hand.y, hand.radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  },

  sfx: {
    perfect: { type: 'square', freq: 1200, durationMs: 60, gain: 0.18 },
    good: { type: 'square', freq: 700, durationMs: 60, gain: 0.14 },
    miss: { type: 'sawtooth', freq: 160, durationMs: 90, gain: 0.12 },
  },
}
