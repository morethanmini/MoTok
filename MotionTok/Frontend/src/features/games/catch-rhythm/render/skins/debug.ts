/**
 * 디버그 스킨 — 미니멀. 두 가지 목적으로 존재한다.
 * 1) 스킨이 정말 갈아끼워지는지 증명 (문자열 하나로 전환)
 * 2) 판정 튜닝 — 판정 반경·크로스 여부·접근 진행도를 눈으로 본다
 */

import type { CatchSkin } from './types'
import type { Hand } from '../../core/types'

const COLOR: Record<Hand, string> = { left: '#4aa3ff', right: '#ff6b6b' }
const FX_MS = 300

export const debugSkin: CatchSkin = {
  id: 'debug',
  label: '디버그',

  drawBackground(ctx, w, h) {
    ctx.fillStyle = '#101418'
    ctx.fillRect(0, 0, w, h)
    // 중심선 — 좌표계 확인용
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
    ctx.save()
    ctx.strokeStyle = COLOR[note.hand]
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, note.scale)
    ctx.beginPath()
    ctx.arc(note.x, note.y, note.radius, 0, Math.PI * 2)
    ctx.stroke()

    // 크로스 노트는 X 표시 — 디버그에서만 구분한다
    if (note.cross) {
      const d = note.radius * 0.5
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
    const t = fx.elapsedMs / FX_MS
    if (t >= 1) return false
    ctx.save()
    ctx.globalAlpha = 1 - t
    ctx.fillStyle =
      fx.judgement === 'perfect' ? '#7dff9b' : fx.judgement === 'good' ? '#ffe066' : '#ff5c5c'
    ctx.font = `bold ${Math.round(fx.radius * 0.9)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(fx.judgement.toUpperCase(), fx.x, fx.y - t * fx.radius)
    ctx.restore()
    return true
  },

  drawCursor(ctx, hand) {
    ctx.save()
    ctx.strokeStyle = COLOR[hand.side]
    ctx.fillStyle = COLOR[hand.side]
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(hand.x, hand.y, hand.radius, 0, Math.PI * 2)
    if (hand.isFist) ctx.fill()
    else ctx.stroke()
    ctx.restore()
  },

  sfx: {
    perfect: { type: 'square', freq: 1200, durationMs: 60, gain: 0.18 },
    good: { type: 'square', freq: 700, durationMs: 60, gain: 0.14 },
    miss: { type: 'sawtooth', freq: 160, durationMs: 90, gain: 0.12 },
  },
}
