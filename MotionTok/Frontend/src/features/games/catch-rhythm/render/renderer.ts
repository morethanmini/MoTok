/**
 * 캔버스 렌더 루프 — 배경 → 노트(원경부터) → 이펙트 → 커서 순으로 그린다.
 * 스킨의 메서드만 호출하고 모양은 하나도 모른다.
 *
 * 노트 위치는 매 프레임 게임 시각 t로부터 다시 계산한다(프레임 드랍 내성).
 * 좌표 변환: 게임 y ∈ [-1,1] → 캔버스 높이. x도 같은 스케일(등방)이라
 * 종횡비가 넓어지면 x 가시 범위만 넓어진다.
 */

import { NOTE_RADIUS, HAND_RADIUS } from '../core/config'
import { noteProgress, type TrackedNote } from '../logic/catchLogic'
import type { Hand, Judgement } from '../core/types'
import type { CatchSkin, HitFxView } from './skins/types'

/** 원경에서도 최소한 이만큼은 보이게 — 0이면 점으로 사라진다 */
const MIN_SCALE = 0.15
/** 판정 시점을 지나도 이만큼은 더 보여 준다(늦은 히트 여지 시각화) */
const LINGER_PROGRESS = 1.25

export interface RenderHand {
  x: number
  y: number
  isFist: boolean
  /** 게임 좌표 랜드마크 21개 — 손 모양을 그대로 그린다 */
  landmarks: { x: number; y: number }[]
}

export interface RenderFrame {
  /** 게임 시각(ms) */
  tMs: number
  notes: TrackedNote[]
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
}

export class Renderer {
  private fx: ActiveFx[] = []

  constructor(
    private readonly canvas: HTMLCanvasElement,
    public skin: CatchSkin,
  ) {}

  setSkin(skin: CatchSkin): void {
    this.skin = skin
  }

  /** 판정 순간 호출 — 이펙트를 띄운다. 좌표는 게임 좌표. */
  spawnFx(x: number, y: number, judgement: Judgement, hand: Hand, tMs: number): void {
    const { unit } = this.metrics()
    this.fx.push({
      ...this.toPixels(x, y),
      radius: NOTE_RADIUS * unit,
      judgement,
      hand,
      bornMs: tMs,
    })
  }

  clearFx(): void {
    this.fx = []
  }

  /**
   * 백버퍼를 표시 크기 × DPR로 맞춘다. 리사이즈마다 호출(같은 크기면 아무 일도 안 한다).
   * @returns 크기가 바뀌었는가
   */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // 고DPI에서 과도한 픽셀 방지
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
    // 게임 1단위 = 화면 높이의 절반. x·y 등방.
    return { w, h, unit: h / 2 }
  }

  private toPixels(x: number, y: number) {
    const { w, h, unit } = this.metrics()
    return { x: w / 2 + x * unit, y: h / 2 - y * unit }
  }

  draw(frame: RenderFrame): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const { w, h, unit } = this.metrics()
    const judgeRadius = NOTE_RADIUS * unit

    ctx.clearRect(0, 0, w, h)
    this.skin.drawBackground?.(ctx, w, h, frame.tMs)

    // 원경(작은 scale)부터 그려야 가까운 노트가 위에 온다
    const visible = frame.notes
      .filter((n) => n.status === 'active')
      .map((n) => ({ note: n, progress: noteProgress(n, frame.tMs, frame.approachTimeMs) }))
      .filter((v) => v.progress >= 0 && v.progress <= LINGER_PROGRESS)
      .sort((a, b) => a.progress - b.progress)

    for (const { note, progress } of visible) {
      const scale = MIN_SCALE + (1 - MIN_SCALE) * Math.min(progress, 1)
      const { x, y } = this.toPixels(note.x, note.y)
      this.skin.drawNote(ctx, {
        x,
        y,
        radius: judgeRadius * scale,
        judgeRadius,
        scale,
        progress,
        hand: note.hand,
        kind: note.kind,
        cross: (note as TrackedNote & { cross?: boolean }).cross === true,
      })
    }

    // 이펙트 — 스킨이 false를 주면 수명 종료
    this.fx = this.fx.filter((f) => {
      const view: HitFxView = {
        x: f.x,
        y: f.y,
        radius: f.radius,
        judgement: f.judgement,
        hand: f.hand,
        elapsedMs: frame.tMs - f.bornMs,
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
  }
}
