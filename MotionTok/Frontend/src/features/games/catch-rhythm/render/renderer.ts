/**
 * 캔버스 렌더 루프 — 배경 → 노트(원경부터) → 이펙트 → 커서 순으로 그린다.
 * 스킨의 메서드만 호출하고 모양은 하나도 모른다.
 *
 * 타격감(2026-07-27 피드백)은 두 층으로 만든다.
 *  - 스킨: 노트 자리에서 터지는 이펙트(링·파티클·판정 문구)
 *  - 렌더러: **화면 전체 반응** — 히트 플래시, 미스 시 화면 흔들림. 스킨과 무관하게 항상 먹는다.
 */

import { NOTE_RADIUS, HAND_RADIUS } from '../core/config'
import { noteProgress, trailPointAt, hitReadiness, type TrackedNote } from '../logic/catchLogic'
import type { Hand, Judgement } from '../core/types'
import type { CatchSkin, HitFxView } from './skins/types'

/** 원경에서도 최소한 이만큼은 보이게 — 0이면 점으로 사라진다 */
const MIN_SCALE = 0.15
/** 판정 시점을 지나도 이만큼은 더 보여 준다(늦은 히트 여지 시각화) */
const LINGER_PROGRESS = 1.25

const FX_LIFE_MS = 560
const FLASH_MS = 180
const SHAKE_MS = 260
const SHAKE_PX = 9

export interface RenderHand {
  x: number
  y: number
  isFist: boolean
  landmarks: { x: number; y: number }[]
}

export interface RenderFrame {
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
  combo: number
}

export class Renderer {
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

  /** 판정 순간 호출 — 이펙트 + 화면 반응. 좌표는 게임 좌표. */
  spawnFx(x: number, y: number, judgement: Judgement, hand: Hand, tMs: number, combo = 0): void {
    const { unit } = this.metrics()
    this.fx.push({
      ...this.toPixels(x, y),
      radius: NOTE_RADIUS * unit,
      judgement,
      hand,
      bornMs: tMs,
      combo,
    })

    if (judgement === 'miss') {
      this.shakeUntil = tMs + SHAKE_MS
    } else {
      this.flashUntil = tMs + FLASH_MS
      // 콤보가 쌓일수록 번쩍임이 강해진다 — "잘 치고 있다"는 감각
      this.flashStrength = judgement === 'perfect' ? 0.22 : 0.12
      this.flashStrength *= 1 + Math.min(1, combo / 40)
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

  draw(frame: RenderFrame): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const { w, h, unit } = this.metrics()
    const judgeRadius = NOTE_RADIUS * unit

    ctx.clearRect(0, 0, w, h)

    // 미스 시 화면 흔들림 — 감쇠하는 진동
    const shakeLeft = this.shakeUntil - frame.tMs
    ctx.save()
    if (shakeLeft > 0) {
      const k = shakeLeft / SHAKE_MS
      const amp = SHAKE_PX * k * k
      ctx.translate(Math.sin(frame.tMs / 18) * amp, Math.cos(frame.tMs / 13) * amp)
    }

    this.skin.drawBackground?.(ctx, w, h, frame.tMs)

    const visible = frame.notes
      .filter((n) => n.status === 'active' || n.status === 'tracing')
      .map((n) => ({ note: n, progress: noteProgress(n, frame.tMs, frame.approachTimeMs) }))
      .filter(
        (v) => v.note.status === 'tracing' || (v.progress >= 0 && v.progress <= LINGER_PROGRESS),
      )
      .sort((a, b) => a.progress - b.progress)

    for (const { note, progress } of visible) {
      const scale = MIN_SCALE + (1 - MIN_SCALE) * Math.min(progress, 1)
      const { x, y } = this.toPixels(note.x, note.y)

      let path: { x: number; y: number }[] | undefined
      let head: { x: number; y: number } | undefined
      if (note.kind === 'trail') {
        path = [{ x: note.x, y: note.y }, ...(note.path ?? [])].map((p) => this.toPixels(p.x, p.y))
        if (note.status === 'tracing') {
          const ratio = (frame.tMs - note.timeMs) / (note.durationMs || 1)
          const p = trailPointAt(note, ratio)
          head = this.toPixels(p.x, p.y)
        }
      }

      this.skin.drawNote(
        ctx,
        {
          x,
          y,
          radius: judgeRadius * scale,
          judgeRadius,
          scale,
          progress,
          hand: note.hand,
          kind: note.kind,
          cross: (note as TrackedNote & { cross?: boolean }).cross === true,
          path,
          head,
          tracing: note.status === 'tracing',
          readiness: note.status === 'tracing' ? 0 : hitReadiness(note, frame.tMs),
        },
        frame.tMs,
      )
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

    // 히트 플래시 — 화면 전체가 잠깐 밝아진다. 흔들림 밖에서 그려야 가장자리가 안 비친다.
    const flashLeft = this.flashUntil - frame.tMs
    if (flashLeft > 0) {
      ctx.save()
      ctx.globalAlpha = (flashLeft / FLASH_MS) * this.flashStrength
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }
}
