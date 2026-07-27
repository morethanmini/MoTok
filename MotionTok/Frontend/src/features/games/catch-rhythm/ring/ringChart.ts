/**
 * 마이마이(링) 채보 생성기 — 캐치와 같은 결정적 시드 규칙을 따른다.
 * 난수는 `mulberry32(foldSeed(seed))` 하나뿐. 방 전원이 같은 채보를 만든다.
 *
 * ★ 도달 가능성: 캐치에서 얻은 교훈을 각도로 환산해 그대로 적용한다.
 * 손은 링 둘레를 따라 움직이므로 두 레인 사이 이동 거리 = RING_RADIUS × 각도(rad).
 * 시간 안에 못 가는 레인 배치는 만들지 않는다 — 그게 "물리적으로 불가능한 패턴"의 원인이었다.
 */

import { mulberry32, foldSeed, type Rng } from '../core/rng'
import { LEAD_IN_MS, SLOT_MS, type Difficulty } from '../generator/presets'
import type { Hand, NoteHand } from '../core/types'
import type { RingBeatmap, RingNote } from './ringLogic'
import { LANE_COUNT, RING_RADIUS, RING_HAND_SPEED, RING_REACH_SAFETY } from './ringConfig'

export interface RingPreset {
  density: number
  /** 노트가 생겼을 때 슬라이드가 될 확률 */
  holdRate: number
  /** 홀드 길이 범위(ms) */
  holdDurationMs: readonly [number, number]
  /** 아무 손이나 가능한 노트 비율 — 캐치와 마찬가지로 이게 기본이다 */
  anyRate: number
  /** 좌+우 동시 노트 확률 */
  simultaneous: number
  /** 같은 손 노트 사이 최소 간격 */
  minSameHandGapMs: number
  approachTimeMs: number
}

export const RING_PRESETS: Record<Difficulty, RingPreset> = {
  EASY: {
    density: 0.18,
    holdRate: 0.22,
    holdDurationMs: [900, 1400],
    anyRate: 0.75,
    simultaneous: 0,
    minSameHandGapMs: 500,
    approachTimeMs: 1500,
  },
  NORMAL: {
    density: 0.3,
    holdRate: 0.25,
    holdDurationMs: [800, 1300],
    anyRate: 0.6,
    simultaneous: 0.08,
    minSameHandGapMs: 400,
    approachTimeMs: 1300,
  },
  HARD: {
    density: 0.44,
    holdRate: 0.28,
    holdDurationMs: [700, 1100],
    anyRate: 0.45,
    simultaneous: 0.2,
    minSameHandGapMs: 320,
    approachTimeMs: 1100,
  },
}

const LANE_STEP_RAD = (Math.PI * 2) / LANE_COUNT

/** 두 레인 사이 최소 각거리(레인 수) — 링은 원형이라 양방향 중 짧은 쪽 */
function laneDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % LANE_COUNT
  return Math.min(d, LANE_COUNT - d)
}

/** 그 시간 안에 갈 수 있는 최대 레인 수 */
function reachableLanes(dtMs: number): number {
  const arcBudget = RING_HAND_SPEED * (dtMs / 1000) * RING_REACH_SAFETY
  return arcBudget / (RING_RADIUS * LANE_STEP_RAD)
}

/** 노트가 손을 붙잡고 있는 마지막 시각 */
function endTimeOf(note: RingNote): number {
  return note.timeMs + (note.durationMs ?? 0)
}

/** 홀드가 끝나는 레인(슬라이드면 이동한 자리) */
function endLaneOf(note: RingNote): number {
  return (((note.lane + (note.laneDelta ?? 0)) % LANE_COUNT) + LANE_COUNT) % LANE_COUNT
}

export interface GeneratedRingNote extends RingNote {
  /** 'any' 노트도 배치·도달 계산은 이 손 기준으로 한다 */
  owner: Hand
}

export interface GeneratedRingChart extends RingBeatmap {
  notes: GeneratedRingNote[]
  durationMs: number
}

function other(hand: Hand): Hand {
  return hand === 'left' ? 'right' : 'left'
}

/**
 * seed + 난이도 + 라운드 길이 → 링 채보.
 * 캐치 생성기와 같은 슬롯 격자·같은 유예를 쓴다(두 모드의 리듬 감각을 맞추기 위해).
 */
export function generateRingChart(
  seed: number | string,
  difficulty: Difficulty,
  durationMs: number,
): GeneratedRingChart {
  const preset = RING_PRESETS[difficulty]
  const rng = mulberry32(foldSeed(seed))

  const notes: GeneratedRingNote[] = []
  const lastByHand: Record<Hand, GeneratedRingNote | null> = { left: null, right: null }
  let nextHand: Hand = rng() < 0.5 ? 'left' : 'right'

  for (let timeMs = LEAD_IN_MS; timeMs <= durationMs; timeMs += SLOT_MS) {
    if (rng() >= preset.density) continue

    const simultaneous = rng() < preset.simultaneous
    const owners: Hand[] = simultaneous ? ['left', 'right'] : [nextHand]
    const takenLanes: number[] = []

    for (const owner of owners) {
      const prev = lastByHand[owner]
      const dtMs = prev ? timeMs - endTimeOf(prev) : Infinity
      if (dtMs < preset.minSameHandGapMs) continue

      // ★ 도달 가능한 레인만 후보로 둔다
      const maxStep = Math.max(1, Math.floor(reachableLanes(dtMs)))
      const from = prev ? endLaneOf(prev) : Math.floor(rng() * LANE_COUNT)
      const candidates: number[] = []
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if (takenLanes.some((t) => laneDistance(t, lane) < 2)) continue // 동시 노트끼리 붙지 않게
        if (prev && laneDistance(from, lane) > maxStep) continue
        candidates.push(lane)
      }
      if (candidates.length === 0) continue
      const lane = candidates[Math.floor(rng() * candidates.length)]!

      const hand: NoteHand = rng() < preset.anyRate ? 'any' : owner
      const isHold = rng() < preset.holdRate

      const note: GeneratedRingNote = {
        timeMs,
        lane,
        hand,
        type: isHold ? 'hold' : 'tap',
        owner,
      }
      if (isHold) {
        const [lo, hi] = preset.holdDurationMs
        note.durationMs = Math.round(lo + rng() * (hi - lo))
        // ★ 제자리 홀드(laneDelta 0)는 만들지 않는다.
        // 호 길이가 0이라 화면에선 점 하나가 멈춰 있는 걸로만 보여 "이게 뭐지"가 된다.
        // 슬라이드는 **반드시 최소 1레인 이상 움직인다**.
        const maxSlide = Math.max(1, Math.floor(reachableLanes(note.durationMs)))
        const steps = 1 + Math.floor(rng() * maxSlide)
        note.laneDelta = rng() < 0.5 ? -steps : steps
      }

      notes.push(note)
      lastByHand[owner] = note
      takenLanes.push(lane)
    }

    nextHand = other(nextHand)
  }

  return {
    approachTimeMs: preset.approachTimeMs,
    notes,
    durationMs: notes.length ? endTimeOf(notes[notes.length - 1]!) : 0,
  }
}
