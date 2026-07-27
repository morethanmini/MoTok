/**
 * 마이마이(링) 렌더러 — 노트가 중심에서 링으로 밀려 나온다.
 *
 * 캐치 렌더러와 좌표 규칙(게임 1단위 = 화면 높이 절반)은 같지만 노트 배치가 전혀 달라
 * 별도 클래스로 둔다. **커서·히트 이펙트·배경은 스킨 것을 그대로 재사용**하므로
 * 두 모드의 손 모양과 타격감이 어긋나지 않는다.
 */

import { HAND_RADIUS } from '../core/config'
import type { Hand, Judgement, NoteHand } from '../core/types'
import type { CatchSkin, HitFxView } from '../render/skins/types'
import type { RenderHand } from '../render/renderer'
import { LANE_COUNT, RING_RADIUS, HIT_ZONE_ANGLE_DEG, HIT_ZONE_RADIUS_TOL } from './ringConfig'
import {
  laneAngleDeg,
  laneDirection,
  holdBearingDeg,
  ringNoteRadius,
  type TrackedRingNote,
} from './ringLogic'

const FX_LIFE_MS = 560
const FLASH_MS = 180
const SHAKE_MS = 260
const SHAKE_PX = 9

/** 노트 색 — 캐치 모드와 같은 규칙(왼손 파랑 / 오른손 빨강 / 아무손 보라) */
const NOTE_COLOR: Record<NoteHand, { body: string; edge: string }> = {
  left: { body: '#9ec5fe', edge: '#1d4ed8' },
  right: { body: '#ffa8a8', edge: '#c92a2a' },
  any: { body: '#c3aefc', edge: '#6d28d9' },
}

export interface RingRenderFrame {
  tMs: number
  notes: TrackedRingNote[]
  approachTimeMs: number
  hands: Partial<Record<Hand, RenderHand | null>>
}

interface ActiveFx {
  x: number
  y: number
  radius: number
  judgement: Judgement
  hand: Hand
  bornMs: number
  combo: number
}

export class RingRenderer {
  private fx: ActiveFx[] = []
  private flashUntil = -Infinity
  private flashStrength = 0
  private shakeUntil = -Infinity

  constructor(
    private readonly canvas: HTMLCanvasElement,
    public skin: CatchSkin,
  ) {}

  setSkin(skin: CatchSkin): void {
    this.skin = skin
  }

  spawnFx(x: number, y: number, judgement: Judgement, hand: Hand, tMs: number, combo = 0): void {
    const { unit } = this.metrics()
    this.fx.push({
      ...this.toPixels(x, y),
      radius: 0.11 * unit,
      judgement,
      hand,
      bornMs: tMs,
      combo,
    })
    if (judgement === 'miss') {
      this.shakeUntil = tMs + SHAKE_MS
    } else {
      this.flashUntil = tMs + FLASH_MS
      this.flashStrength = (judgement === 'perfect' ? 0.22 : 0.12) * (1 + Math.min(1, combo / 40))
    }
  }

  clearFx(): void {
    this.fx = []
    this.flashUntil = -Infinity
    this.shakeUntil = -Infinity
  }

  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(this.canvas.clientWidth * dpr)
    const h = Math.round(this.canvas.clientHeight * dpr)
    if (w === 0 || h === 0 || (this.canvas.width === w && this.canvas.height === h)) return false
    this.canvas.width = w
    this.canvas.height = h
    return true
  }

  private metrics() {
    const w = this.canvas.width
    const h = this.canvas.height
    return { w, h, unit: h / 2 }
  }

  private toPixels(x: number, y: number) {
    const { w, h, unit } = this.metrics()
    return { x: w / 2 + x * unit, y: h / 2 - y * unit }
  }

  /** 방위각(12시=0, 시계방향) + 반지름 → 캔버스 픽셀 */
  private polarToPixels(deg: number, radius: number) {
    const rad = (deg * Math.PI) / 180
    return this.toPixels(Math.sin(rad) * radius, Math.cos(rad) * radius)
  }

  draw(frame: RingRenderFrame): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const { w, h, unit } = this.metrics()

    ctx.clearRect(0, 0, w, h)

    const shakeLeft = this.shakeUntil - frame.tMs
    ctx.save()
    if (shakeLeft > 0) {
      const k = shakeLeft / SHAKE_MS
      const amp = SHAKE_PX * k * k
      ctx.translate(Math.sin(frame.tMs / 18) * amp, Math.cos(frame.tMs / 13) * amp)
    }

    this.skin.drawBackground?.(ctx, w, h, frame.tMs)
    this.drawRingGuide(ctx, unit)

    // 먼(작은 반지름) 노트부터 그려 가까운 것이 위로 오게
    const visible = frame.notes
      .filter((n) => n.status === 'active' || n.status === 'holding')
      .map((n) => ({ note: n, r: ringNoteRadius(n, frame.tMs, frame.approachTimeMs) }))
      .filter((v) => v.r >= -0.05)
      .sort((a, b) => a.r - b.r)

    for (const { note, r } of visible) {
      if (note.type === 'hold') this.drawHold(ctx, note, frame.tMs, r, unit)
      else this.drawTap(ctx, note, r, unit)
    }

    this.fx = this.fx.filter((f) => {
      const view: HitFxView = {
        x: f.x,
        y: f.y,
        radius: f.radius,
        judgement: f.judgement,
        hand: f.hand,
        elapsedMs: frame.tMs - f.bornMs,
        lifeMs: FX_LIFE_MS,
        combo: f.combo,
      }
      return this.skin.drawHitFx(ctx, view)
    })

    for (const side of ['left', 'right'] as Hand[]) {
      const hand = frame.hands[side]
      if (!hand) continue
      const { x, y } = this.toPixels(hand.x, hand.y)
      this.skin.drawCursor(ctx, {
        x,
        y,
        radius: HAND_RADIUS * unit,
        isFist: hand.isFist,
        side,
        landmarks: hand.landmarks.map((p) => this.toPixels(p.x, p.y)),
      })
    }
    ctx.restore()

    const flashLeft = this.flashUntil - frame.tMs
    if (flashLeft > 0) {
      ctx.save()
      ctx.globalAlpha = (flashLeft / FLASH_MS) * this.flashStrength
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }

  /** 판정 링 + 레인 눈금 + 존 두께 — "여기서 친다"를 보여주는 기준선 */
  private drawRingGuide(ctx: CanvasRenderingContext2D, unit: number) {
    const c = this.toPixels(0, 0)
    ctx.save()

    // 존 두께(반지름 허용 범위)를 옅은 띠로
    ctx.strokeStyle = 'rgba(224,122,79,0.16)'
    ctx.lineWidth = HIT_ZONE_RADIUS_TOL * 2 * unit
    ctx.beginPath()
    ctx.arc(c.x, c.y, RING_RADIUS * unit, 0, Math.PI * 2)
    ctx.stroke()

    // 판정 링 본선
    ctx.strokeStyle = 'rgba(224,122,79,0.55)'
    ctx.lineWidth = Math.max(2, unit * 0.012)
    ctx.beginPath()
    ctx.arc(c.x, c.y, RING_RADIUS * unit, 0, Math.PI * 2)
    ctx.stroke()

    // 레인 경계 눈금
    ctx.strokeStyle = 'rgba(122,106,96,0.3)'
    ctx.lineWidth = Math.max(1, unit * 0.006)
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const deg = laneAngleDeg(lane) + 180 / LANE_COUNT // 레인 사이 경계
      const inner = this.polarToPixels(deg, RING_RADIUS - HIT_ZONE_RADIUS_TOL)
      const outer = this.polarToPixels(deg, RING_RADIUS + HIT_ZONE_RADIUS_TOL)
      ctx.beginPath()
      ctx.moveTo(inner.x, inner.y)
      ctx.lineTo(outer.x, outer.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawTap(ctx: CanvasRenderingContext2D, note: TrackedRingNote, r: number, unit: number) {
    const color = NOTE_COLOR[note.hand]
    const dir = laneDirection(note.lane)
    const p = this.toPixels(dir.x * Math.max(0, r), dir.y * Math.max(0, r))
    // 링에 가까울수록 커지고 진해진다
    const near = Math.min(1, Math.max(0, r / RING_RADIUS))
    const radius = unit * (0.05 + 0.07 * near)

    ctx.save()
    ctx.globalAlpha = 0.35 + 0.65 * near
    ctx.fillStyle = color.body
    ctx.strokeStyle = color.edge
    ctx.lineWidth = Math.max(2, radius * 0.22)
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 도달 임박 — 흰 링으로 "지금!"
    if (near > 0.88) {
      ctx.globalAlpha = (near - 0.88) / 0.12
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(2, radius * 0.3)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius * 1.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 홀드 — 링 위의 호로 경로를 보여주고, 진행 중이면 따라갈 지점을 표시 */
  private drawHold(
    ctx: CanvasRenderingContext2D,
    note: TrackedRingNote,
    tMs: number,
    r: number,
    unit: number,
  ) {
    const color = NOTE_COLOR[note.hand]
    const tracing = note.status === 'holding'
    const near = Math.min(1, Math.max(0, r / RING_RADIUS))
    const c = this.toPixels(0, 0)

    ctx.save()
    // 슬라이드 경로 호 — 캔버스 각도계로 변환(12시 기준 시계방향 → -90° 오프셋)
    const startDeg = laneAngleDeg(note.lane)
    const endDeg = startDeg + (note.laneDelta ?? 0) * (360 / LANE_COUNT)
    const toCanvas = (deg: number) => ((deg - 90) * Math.PI) / 180
    ctx.globalAlpha = tracing ? 0.85 : 0.25 + 0.45 * near
    ctx.strokeStyle = color.edge
    ctx.lineCap = 'round'
    ctx.lineWidth = unit * (tracing ? 0.11 : 0.08)
    ctx.beginPath()
    ctx.arc(
      c.x,
      c.y,
      RING_RADIUS * unit,
      toCanvas(Math.min(startDeg, endDeg)),
      toCanvas(Math.max(startDeg, endDeg)),
    )
    ctx.stroke()

    // head 노트
    if (!tracing) {
      const dir = laneDirection(note.lane)
      const p = this.toPixels(dir.x * Math.max(0, r), dir.y * Math.max(0, r))
      const radius = unit * (0.05 + 0.07 * near)
      ctx.globalAlpha = 0.4 + 0.6 * near
      ctx.fillStyle = color.body
      ctx.lineWidth = Math.max(2, radius * 0.22)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      // 따라가야 할 지점
      const head = this.polarToPixels(holdBearingDeg(note, tMs), RING_RADIUS)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = color.edge
      ctx.lineWidth = Math.max(2, unit * 0.02)
      ctx.beginPath()
      ctx.arc(head.x, head.y, unit * 0.075, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** 존 각도 — 스테이지에서 HUD 안내에 쓴다 */
export const RING_ZONE_ANGLE_DEG = HIT_ZONE_ANGLE_DEG
