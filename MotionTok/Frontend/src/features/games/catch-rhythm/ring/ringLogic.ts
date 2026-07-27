/**
 * 마이마이(링) 모드 판정 — DOM/카메라 의존 없는 순수 로직.
 * 프로토타입 `modes/ring/logic.js`를 TS로 이식하고 인식 관대함만 조정했다.
 *
 * 좌표는 게임 좌표(중앙 원점, 위가 +y). 레인 0 = 12시, 시계방향 45° 간격.
 * 노트는 중심에서 링 반지름까지 밖으로 밀려 나오고, timeMs에 링에 도달한다.
 *
 * 이벤트 모양은 캐치 모드와 같다(spawn/hit/miss) — 스테이지가 두 모드를 같은 파이프로 처리한다.
 */

import { judgeHit, isMissed } from '../core/judge'
import type { Hand, HitJudgement, NoteHand } from '../core/types'
import type { Hands } from '../logic/catchLogic'
import {
  LANE_COUNT,
  RING_RADIUS,
  HIT_ZONE_ANGLE_DEG,
  HIT_ZONE_RADIUS_TOL,
  HOLD_GRACE_MS,
  HOLD_KEEP_RATIO,
  CAMP_TIMEOUT_MS,
} from './ringConfig'

const LANE_STEP_DEG = 360 / LANE_COUNT

export type RingNoteType = 'tap' | 'hold'

export interface RingNote {
  timeMs: number
  /** 0 = 12시, 시계방향 */
  lane: number
  hand: NoteHand
  type: RingNoteType
  /** hold 전용 — 유지 시간 */
  durationMs?: number
  /** hold 전용 — 유지 중 이동할 레인 수(부호 = 방향). 8 이상이면 한 바퀴를 넘는다 */
  laneDelta?: number
}

export interface RingBeatmap {
  approachTimeMs: number
  notes: RingNote[]
}

type RingStatus = 'pending' | 'active' | 'holding' | 'hit' | 'miss'

export interface TrackedRingNote extends RingNote {
  id: number
  status: RingStatus
  /** hold 전용 — 잡고 있는 손 */
  holdHand: Hand | null
  /** hold 전용 — 유지 표본 / 성공 표본 */
  holdSamples: number
  holdKept: number
  /** hold 전용 — 존을 벗어난 시각(연속 이탈 측정) */
  outSince: number | null
}

export type RingEvent =
  | { type: 'spawn'; note: TrackedRingNote }
  | { type: 'miss'; note: TrackedRingNote }
  | { type: 'hit'; note: TrackedRingNote; judgement: HitJudgement; hand: Hand; deltaMs: number }

const SIDES: Hand[] = ['left', 'right']

// ── 기하 ───────────────────────────────────────────────────

/** 레인 중심 방위각(12시=0°, 시계방향) */
export function laneAngleDeg(lane: number): number {
  return lane * LANE_STEP_DEG
}

/** 레인 중심 단위 방향 벡터(게임 좌표) */
export function laneDirection(lane: number): { x: number; y: number } {
  const rad = (laneAngleDeg(lane) * Math.PI) / 180
  return { x: Math.sin(rad), y: Math.cos(rad) }
}

/** 위치의 방위각(12시=0°, 시계방향, [0,360)). 원점이면 null */
export function bearingDeg(x: number, y: number): number | null {
  if (x === 0 && y === 0) return null
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

/** 두 각도의 최소 차(0~180) */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 노트의 현재 반지름 — 중심(0)에서 링(RING_RADIUS)으로 밀려 나온다 */
export function ringNoteRadius(note: RingNote, tMs: number, approachTimeMs: number): number {
  return RING_RADIUS * (1 - (note.timeMs - tMs) / approachTimeMs)
}

/** 노트의 현재 게임 좌표 */
export function ringNotePosition(
  note: RingNote,
  tMs: number,
  approachTimeMs: number,
): { x: number; y: number } {
  const r = Math.max(0, ringNoteRadius(note, tMs, approachTimeMs))
  const dir = laneDirection(note.lane)
  return { x: dir.x * r, y: dir.y * r }
}

/**
 * 홀드 노트가 지금 요구하는 방위각.
 * 시작 레인에서 laneDelta × 45°만큼 durationMs에 걸쳐 선형 이동한다.
 */
export function holdBearingDeg(note: RingNote, tMs: number): number {
  const duration = note.durationMs ?? 1
  const p = Math.min(Math.max((tMs - note.timeMs) / duration, 0), 1)
  const deg = laneAngleDeg(note.lane) + (note.laneDelta ?? 0) * LANE_STEP_DEG * p
  return ((deg % 360) + 360) % 360
}

function inZoneAt(pos: { x: number; y: number } | null, targetDeg: number): boolean {
  if (!pos) return false
  const r = Math.hypot(pos.x, pos.y)
  if (Math.abs(r - RING_RADIUS) > HIT_ZONE_RADIUS_TOL) return false
  const b = bearingDeg(pos.x, pos.y)
  if (b === null) return false
  return angleDiffDeg(b, targetDeg) <= HIT_ZONE_ANGLE_DEG
}

/** 손이 이 레인의 히트 존 안인가 */
export function isInHitZone(pos: { x: number; y: number } | null, lane: number): boolean {
  return inZoneAt(pos, laneAngleDeg(lane))
}

/** 홀드 중 이동하는 존 안인가 */
export function isInHoldZone(
  pos: { x: number; y: number } | null,
  note: RingNote,
  tMs: number,
): boolean {
  return inZoneAt(pos, holdBearingDeg(note, tMs))
}

// ── 로직 ───────────────────────────────────────────────────

export class RingLogic {
  private readonly approachTimeMs: number
  readonly notes: TrackedRingNote[]
  /** (손, 레인)별 존 진입 시각. null = 존 밖 */
  private readonly zoneEnteredAt: Record<Hand, (number | null)[]> = {
    left: new Array(LANE_COUNT).fill(null),
    right: new Array(LANE_COUNT).fill(null),
  }

  constructor(beatmap: RingBeatmap) {
    this.approachTimeMs = beatmap.approachTimeMs
    this.notes = beatmap.notes.map((n, id) => ({
      ...n,
      id,
      status: 'pending' as RingStatus,
      holdHand: null,
      holdSamples: 0,
      holdKept: 0,
      outSince: null,
    }))
  }

  update(tMs: number, hands: Hands): RingEvent[] {
    this.updateZones(tMs, hands)
    const events: RingEvent[] = []
    const usedHands = new Set<Hand>()

    for (const note of this.notes) {
      if (note.status === 'hit' || note.status === 'miss') continue

      if (note.status === 'pending' && tMs >= note.timeMs - this.approachTimeMs) {
        note.status = 'active'
        events.push({ type: 'spawn', note })
      }

      if (note.status === 'holding') {
        this.updateHold(note, tMs, hands, events)
        continue
      }
      if (note.status !== 'active') continue

      const delta = tMs - note.timeMs
      if (isMissed(delta)) {
        note.status = 'miss'
        events.push({ type: 'miss', note })
        continue
      }
      // 도달 전에는 판정하지 않는다 — 미리 와서 기다린 손이 Good으로 손해 보지 않게
      if (delta < 0) continue

      const sides = note.hand === 'any' ? SIDES : [note.hand]
      for (const side of sides) {
        const hand = hands[side]
        if (!hand || usedHands.has(side)) continue
        if (!this.canHit(side, note.lane, tMs)) continue
        const judgement = judgeHit(delta)
        if (!judgement) continue

        usedHands.add(side)
        if (note.type === 'hold') {
          // head를 잡았다 → 이제 이동 존을 따라가야 한다
          note.status = 'holding'
          note.holdHand = side
          note.outSince = null
          break
        }
        note.status = 'hit'
        events.push({ type: 'hit', note, judgement, hand: side, deltaMs: delta })
        break
      }
    }
    return events
  }

  /**
   * 홀드 유지 — head를 잡은 손이 이동 존 안에 있어야 한다.
   * 연속 이탈이 유예를 넘으면 즉시 실패, 끝까지 가면 유지 비율로 판정한다.
   * (끝까지 완벽할 필요는 없다 — 트래킹이 흔들리는 게 정상이다)
   */
  private updateHold(note: TrackedRingNote, tMs: number, hands: Hands, events: RingEvent[]): void {
    const hand = note.holdHand ? hands[note.holdHand] : null
    const inZone = isInHoldZone(hand, note, tMs)

    note.holdSamples += 1
    if (inZone) {
      note.holdKept += 1
      note.outSince = null
    } else {
      note.outSince ??= tMs
      if (tMs - note.outSince > HOLD_GRACE_MS) {
        note.status = 'miss'
        events.push({ type: 'miss', note })
        return
      }
    }

    if (tMs >= note.timeMs + (note.durationMs ?? 0)) {
      const kept = note.holdSamples === 0 ? 0 : note.holdKept / note.holdSamples
      if (kept >= HOLD_KEEP_RATIO) {
        note.status = 'hit'
        events.push({
          type: 'hit',
          note,
          judgement: kept >= 0.85 ? 'perfect' : 'good',
          hand: note.holdHand ?? 'right',
          deltaMs: 0,
        })
      } else {
        note.status = 'miss'
        events.push({ type: 'miss', note })
      }
    }
  }

  /** 존 안 && 캠핑 아님 */
  private canHit(side: Hand, lane: number, tMs: number): boolean {
    const enteredAt = this.zoneEnteredAt[side][lane]
    if (enteredAt === null || enteredAt === undefined) return false
    return tMs - enteredAt <= CAMP_TIMEOUT_MS
  }

  private updateZones(tMs: number, hands: Hands): void {
    for (const side of SIDES) {
      const hand = hands[side]
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if (hand && isInHitZone(hand, lane)) {
          this.zoneEnteredAt[side][lane] ??= tMs
        } else {
          this.zoneEnteredAt[side][lane] = null // 이탈 → 재활성
        }
      }
    }
  }

  /** 캠핑으로 무효화된 상태인가 — HUD 경고용 */
  isCamping(side: Hand, lane: number, tMs: number): boolean {
    const enteredAt = this.zoneEnteredAt[side][lane]
    return enteredAt != null && tMs - enteredAt > CAMP_TIMEOUT_MS
  }

  /**
   * 늦게 시작한 참가자용 — 이미 지난 노트를 이벤트 없이 정리한다.
   * 이유는 CatchLogic.catchUp 주석 참고(연출 폭주 방지).
   */
  catchUp(tMs: number): number {
    let skipped = 0
    for (const note of this.notes) {
      if (note.status === 'hit' || note.status === 'miss') continue
      if (isMissed(tMs - note.timeMs - (note.durationMs ?? 0))) {
        note.status = 'miss'
        skipped += 1
      }
    }
    return skipped
  }

  activeNotes(): TrackedRingNote[] {
    return this.notes.filter((n) => n.status === 'active' || n.status === 'holding')
  }

  isFinished(): boolean {
    return this.notes.every((n) => n.status === 'hit' || n.status === 'miss')
  }
}
