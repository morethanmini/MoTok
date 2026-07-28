/**
 * 노트 판정 로직 — DOM/카메라 의존 없는 순수 로직.
 *
 * 노트는 고정 위치에서 원경→근경으로 접근(스케일 확대)해 timeMs에 판정 크기에 도달한다.
 *
 * - swipe (주력): 판정창 안에서 손이 반경에 들어오면 히트. 쥠 여부 무관
 * - trail: 헤드를 잡은 뒤 경로를 따라간 **커버리지 비율**로 판정
 * - catch (특수): "펴짐→쥠" 전환 순간에만 인정 — 쥔 채로 쓸고 다니기 방지
 */

import {
  NOTE_RADIUS,
  HAND_RADIUS,
  CATCH_REACH_SCALE,
  CATCH_WINDOW_SCALE,
  SWIPE_REACH_SCALE,
  TRAIL_REACH_SCALE,
  TRAIL_PERFECT_COVERAGE,
  TRAIL_GOOD_COVERAGE,
} from '../core/config'
import { judgeHit, isMissed, windowCloseness } from '../core/judge'
import { MISS_AFTER_MS } from '../core/config'
import type { Beatmap, CatchNote, PathPoint } from '../core/beatmap'
import type { Hand, HitJudgement, Judgement } from '../core/types'

/** 프레임마다 넘기는 손 상태. grabbed는 "펴짐→쥠" 전환 프레임에만 true. */
export interface HandState {
  x: number
  y: number
  grabbed: boolean
}

export type Hands = Record<Hand, HandState | null>

type NoteStatus = 'pending' | 'active' | 'tracing' | 'hit' | 'miss'

export interface TrackedNote extends CatchNote {
  id: number
  status: NoteStatus
  /** trail 전용 — 경로를 따라간 표본 수 / 전체 표본 수 */
  samples: number
  tracked: number
  /** trail 전용 — 지금 따라가고 있는 손 */
  tracingHand: Hand | null
}

export type CatchEvent =
  | { type: 'spawn'; note: TrackedNote }
  | { type: 'miss'; note: TrackedNote }
  | {
      type: 'hit'
      note: TrackedNote
      judgement: HitJudgement
      hand: Hand
      deltaMs: number
      /** trail이면 경로 커버리지(0~1), 그 외는 1 */
      coverage: number
    }

const SIDES: Hand[] = ['left', 'right']

/** 이 노트의 접근 시간 — 노트별 값이 있으면 그것이 우선(주먹 노트는 더 길다). */
export function approachOf(note: CatchNote, fallbackMs: number): number {
  return note.approachMs ?? fallbackMs
}

/** 노트 접근 진행도 0(스폰)→1(판정 시점). 도달 후에는 1 초과. */
export function noteProgress(note: CatchNote, tMs: number, approachTimeMs: number): number {
  return 1 - (note.timeMs - tMs) / approachOf(note, approachTimeMs)
}

/** 판정창 배율 — 주먹 노트만 넉넉하게 잡는다. */
export function windowScaleOf(note: CatchNote): number {
  return note.kind === 'catch' ? CATCH_WINDOW_SCALE : 1
}

/** 지금 판정창에 얼마나 들어와 있는가(0~1). 화면에 '지금!'을 표시하는 데 쓴다. */
export function hitReadiness(note: CatchNote, tMs: number): number {
  return windowCloseness(tMs - note.timeMs, windowScaleOf(note))
}

function reachOf(note: CatchNote): number {
  const base = NOTE_RADIUS + HAND_RADIUS
  if (note.kind === 'swipe') return base * SWIPE_REACH_SCALE
  if (note.kind === 'trail') return base * TRAIL_REACH_SCALE
  return base * CATCH_REACH_SCALE
}

/** 손-노트 거리가 히트 반경 안인가. 종류별로 반경이 다르다. */
export function isInReach(hand: HandState | null, note: CatchNote): boolean {
  if (!hand) return false
  return Math.hypot(hand.x - note.x, hand.y - note.y) < reachOf(note)
}

/**
 * 연결 노트의 시각 t에서 손이 있어야 할 위치.
 * ratio 0 = 시작점, 1 = 경로 끝. 구간 길이에 비례해 등속으로 훑는다.
 */
export function trailPointAt(note: CatchNote, ratio: number): PathPoint {
  const start: PathPoint = { x: note.x, y: note.y }
  const path = note.path ?? []
  if (path.length === 0) return start

  const points = [start, ...path]
  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    segLens.push(len)
    total += len
  }
  if (total === 0) return start

  let want = Math.max(0, Math.min(1, ratio)) * total
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i]!
    if (want <= len || i === segLens.length - 1) {
      const a = points[i]!
      const b = points[i + 1]!
      const k = len === 0 ? 0 : Math.min(1, want / len)
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    want -= len
  }
  return points[points.length - 1]!
}

function coverageJudgement(coverage: number): Judgement {
  if (coverage >= TRAIL_PERFECT_COVERAGE) return 'perfect'
  if (coverage >= TRAIL_GOOD_COVERAGE) return 'good'
  return 'miss'
}

export class CatchLogic {
  private readonly approachTimeMs: number
  readonly notes: TrackedNote[]

  constructor(beatmap: Pick<Beatmap, 'approachTimeMs' | 'notes'>) {
    this.approachTimeMs = beatmap.approachTimeMs
    this.notes = beatmap.notes.map((n, id) => ({
      ...n,
      id,
      status: 'pending',
      samples: 0,
      tracked: 0,
      tracingHand: null,
    }))
  }

  /**
   * 매 프레임 호출. 노트는 timeMs 오름차순이라 겹칠 때 이른 노트가 먼저 판정된다.
   * 반환: 이 프레임에 발생한 이벤트들.
   */
  update(tMs: number, hands: Hands): CatchEvent[] {
    const events: CatchEvent[] = []
    const usedHands = new Set<Hand>() // 한 번의 전환은 노트 하나만 파괴

    for (const note of this.notes) {
      if (note.status === 'hit' || note.status === 'miss') continue

      if (note.status === 'pending' && tMs >= note.timeMs - approachOf(note, this.approachTimeMs)) {
        note.status = 'active'
        events.push({ type: 'spawn', note })
      }

      // ── 연결 노트: 이미 따라가는 중이면 커버리지를 쌓는다 ────────────────
      if (note.status === 'tracing') {
        const done = this.traceStep(note, tMs, hands)
        if (done) {
          // 채점 구간이 아예 없을 만큼 짧은 경로는 헤드를 잡은 것만으로 인정한다
          const coverage = note.samples === 0 ? 1 : note.tracked / note.samples
          const judgement = coverageJudgement(coverage)
          const hand = note.tracingHand ?? 'right'
          if (judgement === 'miss') {
            note.status = 'miss'
            events.push({ type: 'miss', note })
          } else {
            note.status = 'hit'
            events.push({ type: 'hit', note, judgement, hand, deltaMs: 0, coverage })
          }
        }
        continue
      }

      if (note.status !== 'active') continue

      const delta = tMs - note.timeMs
      if (isMissed(delta, windowScaleOf(note))) {
        note.status = 'miss'
        events.push({ type: 'miss', note })
        continue
      }

      const sides = note.hand === 'any' ? SIDES : [note.hand]
      for (const side of sides) {
        const hand = hands[side]
        if (!hand || usedHands.has(side)) continue
        // swipe·trail은 손이 닿기만 하면 되고, catch만 "펴짐→쥠" 전환을 요구한다.
        // 조건을 이 방향으로 써야 kind가 빠진 노트가 공짜 히트로 새지 않는다.
        if (note.kind !== 'swipe' && note.kind !== 'trail' && !hand.grabbed) continue
        if (!isInReach(hand, note)) continue

        const graded = judgeHit(delta, windowScaleOf(note)) // 이른 히트(delta<0)도 창 내면 인정
        if (!graded) continue
        // 스와이프는 기본 노트라 타이밍을 따지지 않는다 — 손만 닿으면 PERFECT(실플레이 결정)
        const judgement: HitJudgement = note.kind === 'swipe' ? 'perfect' : graded

        usedHands.add(side)
        if (note.kind === 'trail') {
          // 헤드를 잡았다 → 이제부터 경로를 따라간다
          note.status = 'tracing'
          note.tracingHand = side
          break
        }
        note.status = 'hit'
        events.push({ type: 'hit', note, judgement, hand: side, deltaMs: delta, coverage: 1 })
        break
      }
    }
    return events
  }

  /**
   * 연결 노트 한 프레임 추적. 경로가 끝났으면 true.
   *
   * ★ 채점은 **실제로 움직여야 하는 구간에서만** 한다.
   * 인식 반경이 후해서 경로 앞부분은 헤드에 손을 얹고 가만히 있어도 닿는다 —
   * 그 구간까지 세면 "안 따라가도 GOOD"이 나온다. 기대 위치가 시작점의 반경을
   * 벗어난 뒤부터 세면 "따라갔는가"만 정확히 남는다.
   */
  private traceStep(note: TrackedNote, tMs: number, hands: Hands): boolean {
    const duration = note.durationMs ?? 0
    const ratio = duration === 0 ? 1 : (tMs - note.timeMs) / duration
    const want = trailPointAt(note, ratio)

    // 지정된 손이 사라졌으면 다른 손도 인정한다(인식을 후하게)
    const candidates: Hand[] = note.hand === 'any' ? SIDES : [note.hand]
    const reach = reachOf(note)
    const near = candidates.some((side) => {
      const h = hands[side]
      if (!h) return false
      if (Math.hypot(h.x - want.x, h.y - want.y) < reach) {
        note.tracingHand = side
        return true
      }
      return false
    })

    const movedAway = Math.hypot(want.x - note.x, want.y - note.y) > reach
    if (movedAway) {
      note.samples += 1
      if (near) note.tracked += 1
    }
    return ratio >= 1
  }

  /**
   * 늦게 시작한 참가자용 — 이미 판정 시각이 지난 노트를 **이벤트 없이** 정리한다.
   *
   * 대전에서 t=0은 서버 시각에 맞추는데, 손 인식 모델(7.5MB)이 캐시에 없으면
   * 로드에 수 초가 걸려 그만큼 t가 점프한다. 그때 지나간 노트를 평소처럼 처리하면
   * 한 프레임에 수십 개의 miss가 쏟아지며 이펙트·효과음이 동시에 생성돼 화면이 멈춘다.
   * 놓친 건 놓친 대로 세되(점수 공정성) 연출은 내보내지 않는다.
   *
   * @returns 이렇게 정리된 노트 수
   */
  catchUp(tMs: number): number {
    let skipped = 0
    for (const note of this.notes) {
      if (note.status === 'hit' || note.status === 'miss') continue
      if (tMs - note.timeMs > MISS_AFTER_MS * windowScaleOf(note)) {
        note.status = 'miss'
        skipped += 1
      }
    }
    return skipped
  }

  activeNotes(): TrackedNote[] {
    return this.notes.filter((n) => n.status === 'active' || n.status === 'tracing')
  }

  isFinished(): boolean {
    return this.notes.every((n) => n.status === 'hit' || n.status === 'miss')
  }
}
