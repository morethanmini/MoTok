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
import {
  LANE_COUNT,
  RING_RADIUS,
  RING_HAND_SPEED,
  RING_REACH_SAFETY,
  TIGHT_GAP_MS,
  TIGHT_MAX_LANE_STEP,
} from './ringConfig'

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
    density: 0.26,
    holdRate: 0.22,
    holdDurationMs: [900, 1400],
    anyRate: 0.75,
    simultaneous: 0,
    minSameHandGapMs: 500,
    approachTimeMs: 1500,
  },
  NORMAL: {
    density: 0.44,
    holdRate: 0.25,
    holdDurationMs: [800, 1300],
    anyRate: 0.6,
    simultaneous: 0.08,
    minSameHandGapMs: 400,
    approachTimeMs: 1300,
  },
  HARD: {
    density: 0.62,
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

/** 슬라이드가 지나가는 레인 전부 — 그 위에 다른 노트를 놓으면 못 친다 */
function sweptLanes(note: RingNote): number[] {
  const delta = note.laneDelta ?? 0
  const step = delta >= 0 ? 1 : -1
  const lanes: number[] = []
  for (let i = 0; i !== delta + step; i += step) {
    lanes.push((((note.lane + i) % LANE_COUNT) + LANE_COUNT) % LANE_COUNT)
  }
  return lanes
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
 *
 * @param slides 슬라이드 노트를 낼지. false(탭 전용 모드)면 슬롯 격자 대신
 *               **프레이즈 기반 생성기**로 간다 — 정박 일변도를 깨고 엇박·버스트·
 *               점프 교차 같은 패턴 다양성이 여기서 나온다.
 */
export function generateRingChart(
  seed: number | string,
  difficulty: Difficulty,
  durationMs: number,
  slides = true,
): GeneratedRingChart {
  if (!slides) return generateRingTapChart(seed, difficulty, durationMs)
  const preset = RING_PRESETS[difficulty]
  const rng = mulberry32(foldSeed(seed))

  const notes: GeneratedRingNote[] = []
  const lastByHand: Record<Hand, GeneratedRingNote | null> = { left: null, right: null }
  let nextHand: Hand = rng() < 0.5 ? 'left' : 'right'
  /** 진행 중인 슬라이드가 점유한 구간 — 그 위엔 노트를 놓지 않는다 */
  const slideBlocks: { fromMs: number; toMs: number; lanes: number[] }[] = []
  /** 손 상관없이 직전 노트 — 짧은 간격 판정용 */
  let lastAny: GeneratedRingNote | null = null

  for (let timeMs = LEAD_IN_MS; timeMs <= durationMs; timeMs += SLOT_MS) {
    if (rng() >= preset.density) continue

    const simultaneous = rng() < preset.simultaneous
    const owners: Hand[] = simultaneous ? ['left', 'right'] : [nextHand]
    const takenLanes: number[] = []

    // 지나간 슬라이드 구간은 버린다(시간순 생성이라 앞에서부터 만료)
    while (slideBlocks.length && slideBlocks[0]!.toMs < timeMs) slideBlocks.shift()
    const blocked = new Set(
      slideBlocks.filter((b) => timeMs >= b.fromMs && timeMs <= b.toMs).flatMap((b) => b.lanes),
    )
    // ★ 짧은 간격이면 양손 가능 + 가까운 레인으로만 — 이 조건이 있어야 밀도를 올릴 수 있다
    const tight = lastAny !== null && timeMs - lastAny.timeMs < TIGHT_GAP_MS

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
        // ★ 슬라이드가 지나가는 레인 위엔 놓지 않는다 (슬라이드 중인 손이 못 친다)
        if (blocked.has(lane)) continue
        // ★ 빠른 구간은 직전 노트 근처로만
        if (tight && laneDistance(lastAny!.lane, lane) > TIGHT_MAX_LANE_STEP) continue
        candidates.push(lane)
      }
      if (candidates.length === 0) continue
      const lane = candidates[Math.floor(rng() * candidates.length)]!

      // 빠른 구간은 손을 지정하지 않는다 — 지정하면 물리적으로 못 친다
      const hand: NoteHand = tight || rng() < preset.anyRate ? 'any' : owner
      // 빠른 구간에 슬라이드가 끼면 손이 묶여 다음 노트를 놓친다
      const isHold = !tight && rng() < preset.holdRate

      const note: GeneratedRingNote = { timeMs, lane, hand, type: 'tap', owner }

      if (isHold) {
        const [lo, hi] = preset.holdDurationMs
        const durationMs = Math.round(lo + rng() * (hi - lo))
        // ★ 제자리 홀드(laneDelta 0)는 만들지 않는다.
        // 호 길이가 0이라 화면에선 점 하나가 멈춰 있는 걸로만 보여 "이게 뭐지"가 된다.
        const maxSlide = Math.max(1, Math.floor(reachableLanes(durationMs)))
        const steps = 1 + Math.floor(rng() * maxSlide)
        const laneDelta = rng() < 0.5 ? -steps : steps
        const lanes = sweptLanes({ ...note, laneDelta })

        // ★ 경로가 **이 슬롯에 이미 놓인 노트**를 관통하면 슬라이드를 포기하고 탭으로 둔다.
        // (거꾸로 나중 노트가 경로를 밟는 건 아래 blocked 집합이 막는다)
        if (!lanes.some((l) => takenLanes.includes(l))) {
          note.type = 'hold'
          note.durationMs = durationMs
          note.laneDelta = laneDelta
          slideBlocks.push({ fromMs: timeMs, toMs: timeMs + durationMs, lanes })
          for (const l of lanes) blocked.add(l)
        }
      }
      notes.push(note)
      lastByHand[owner] = note
      lastAny = note
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

// ═══════════════════════════════════════════════════════════════
// 탭 전용(밀도 높은) 모드 — 프레이즈 기반 생성기
//
// 슬롯 격자에 독립 확률로 노트를 뿌리면 간격이 250ms 정박 일변도가 돼 재미가 없다
// (실플레이 피드백: "너무 정박으로만 나옴"). 그래서 탭 전용 모드는 채보를
// **프레이즈(짧은 패턴 묶음) 단위**로 만든다: 계단·트릴·버스트·점프 교차·갤럽 엇박·양손 동시.
//
// 물리 불변식은 슬라이드 모드와 동일하게 지킨다 — 단 검사 단위가 다르다:
// 손을 번갈아 쓰는 프레이즈는 "직전 노트와 가까울 것"이 아니라
// **각 손 기준 도달 가능성**(같은 손 연타 한계 + 링 둘레 이동 속도)으로 보장한다.
// 예: 12시↔6시 점프 교차는 노트 간 250ms지만 왼손은 12시, 오른손은 6시에
// 머물러 있으므로 손마다는 500ms 간격 + 제자리다.
// ═══════════════════════════════════════════════════════════════

export interface RingTapPreset {
  approachTimeMs: number
  /** 같은 손 연타 한계 — 프레이즈가 뭘 의도하든 이걸 넘는 노트는 버려진다 */
  minSameHandGapMs: number
  /** 여유 있는 노트가 아무 손이나 가능(any)일 확률. 빠른 구간은 무조건 any */
  anyRate: number
  /** 프레이즈 사이 쉼(ms) — 숨 돌릴 틈이자 밀도 조절 손잡이 */
  restMs: readonly [number, number]
  /** 계단·트릴·점프 노트 간격(ms) */
  stepMs: number
  /** 계단·트릴 프레이즈 길이(노트 수) 범위 */
  phraseLen: readonly [number, number]
  /** 버스트 노트 간격(ms). 손이 번갈아 맡아 한 손 기준은 2배가 된다. 0이면 버스트 없음 */
  burstGapMs: number
  /** 프레이즈 종류 가중치 (합이 1이 아니어도 비율로 동작) */
  weights: {
    stream: number
    trill: number
    burst: number
    jump: number
    gallop: number
    doubles: number
  }
}

export const RING_TAP_PRESETS: Record<Difficulty, RingTapPreset> = {
  EASY: {
    approachTimeMs: 1500,
    minSameHandGapMs: 400,
    anyRate: 0.8,
    restMs: [800, 1300],
    stepMs: 600,
    phraseLen: [3, 4],
    burstGapMs: 0,
    weights: { stream: 0.55, trill: 0.15, burst: 0, jump: 0.1, gallop: 0, doubles: 0.2 },
  },
  NORMAL: {
    approachTimeMs: 1300,
    minSameHandGapMs: 320,
    anyRate: 0.65,
    restMs: [500, 850],
    stepMs: 375,
    phraseLen: [3, 5],
    burstGapMs: 175,
    weights: { stream: 0.3, trill: 0.15, burst: 0.1, jump: 0.2, gallop: 0.15, doubles: 0.1 },
  },
  HARD: {
    approachTimeMs: 1100,
    minSameHandGapMs: 256,
    anyRate: 0.5,
    restMs: [400, 850],
    stepMs: 250,
    phraseLen: [4, 6],
    burstGapMs: 150,
    weights: { stream: 0.2, trill: 0.15, burst: 0.2, jump: 0.25, gallop: 0.15, doubles: 0.05 },
  },
}

function normLane(lane: number): number {
  return ((lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT
}

/**
 * 목표 레인을 그 손이 갈 수 있는 만큼만 이동시킨다(캐치의 "도달 보정"과 같은 원리).
 * 프레이즈는 의도를 말하고, 물리적으로 안 되는 거리는 여기서 직전 위치 쪽으로 당겨진다.
 */
function clampLaneForOwner(
  prev: GeneratedRingNote | null,
  targetLane: number,
  timeMs: number,
): number {
  if (!prev) return normLane(targetLane)
  const from = endLaneOf(prev)
  const maxStep = Math.floor(reachableLanes(timeMs - endTimeOf(prev)))
  let delta = normLane(targetLane - from)
  if (delta > LANE_COUNT / 2) delta -= LANE_COUNT // 원형이라 짧은 방향으로
  const step = Math.max(-maxStep, Math.min(maxStep, delta))
  return normLane(from + step)
}

export function generateRingTapChart(
  seed: number | string,
  difficulty: Difficulty,
  durationMs: number,
): GeneratedRingChart {
  const preset = RING_TAP_PRESETS[difficulty]
  const rng = mulberry32(foldSeed(seed))

  const notes: GeneratedRingNote[] = []
  const lastByHand: Record<Hand, GeneratedRingNote | null> = { left: null, right: null }
  let lastNote: GeneratedRingNote | null = null
  let hand: Hand = rng() < 0.5 ? 'left' : 'right'

  const randInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
  const dirOf = () => (rng() < 0.5 ? -1 : 1)

  /**
   * 물리 제약을 통과한 노트만 채보에 실린다 — 같은 손 연타 한계 미달이면 버리고,
   * 못 가는 레인은 당기고, 동시 노트끼리는 2레인 미만으로 붙지 않는다.
   */
  const emit = (owner: Hand, timeMs: number, targetLane: number): GeneratedRingNote | null => {
    timeMs = Math.round(timeMs)
    if (timeMs > durationMs) return null
    const prev = lastByHand[owner]
    if (prev && timeMs - endTimeOf(prev) < preset.minSameHandGapMs) return null
    const lane = clampLaneForOwner(prev, targetLane, timeMs)
    if (notes.some((n) => n.timeMs === timeMs && laneDistance(n.lane, lane) < 2)) return null
    // 빠른 구간에서 손을 지정하면 물리적으로 못 친다 — 슬라이드 모드와 같은 규칙
    const tight = lastNote !== null && lastNote.timeMs !== timeMs && timeMs - lastNote.timeMs < TIGHT_GAP_MS
    const noteHand: NoteHand = tight || rng() < preset.anyRate ? 'any' : owner
    const note: GeneratedRingNote = { timeMs, lane, hand: noteHand, type: 'tap', owner }
    notes.push(note)
    lastByHand[owner] = note
    lastNote = note
    return note
  }

  /** 계단 — 한 방향으로 감아 도는 기본 채움 */
  const stream = (t: number): number => {
    const len = randInt(preset.phraseLen[0], preset.phraseLen[1])
    const dir = dirOf()
    let lane = lastNote ? lastNote.lane + dir : Math.floor(rng() * LANE_COUNT)
    for (let i = 0; i < len; i++) {
      const emitted = emit(hand, t + i * preset.stepMs, lane)
      lane = (emitted ? emitted.lane : lane) + dir
      hand = other(hand)
    }
    return t + (len - 1) * preset.stepMs
  }

  /** 트릴 — 이웃한 두 레인을 양손이 번갈아 두드린다 */
  const trill = (t: number): number => {
    const len = randInt(preset.phraseLen[0] + 1, preset.phraseLen[1] + 1)
    const a = Math.floor(rng() * LANE_COUNT)
    const b = normLane(a + randInt(1, 2) * dirOf())
    for (let i = 0; i < len; i++) {
      emit(hand, t + i * preset.stepMs, i % 2 === 0 ? a : b)
      hand = other(hand)
    }
    return t + (len - 1) * preset.stepMs
  }

  /** 버스트 — 촘촘한 연타가 이웃 레인으로 흘러간다. 밀도의 정점 */
  const burst = (t: number): number => {
    const len = randInt(4, 6)
    const dir = dirOf()
    let lane = lastNote ? lastNote.lane : Math.floor(rng() * LANE_COUNT)
    for (let i = 0; i < len; i++) {
      const emitted = emit(hand, t + i * preset.burstGapMs, lane)
      if (emitted) lane = emitted.lane
      if (rng() < 0.6) lane += dir
      hand = other(hand)
    }
    return t + (len - 1) * preset.burstGapMs
  }

  /** 점프 교차 — 반대편 레인을 번갈아 찍는다(12시↔6시). 손이 하나씩 맡아 각자는 제자리 */
  const jump = (t: number): number => {
    const pairs = randInt(2, 4)
    const rotate = randInt(-1, 1) // 축이 조금씩 도는 변형
    let a = Math.floor(rng() * LANE_COUNT)
    let b = normLane(a + LANE_COUNT / 2 + randInt(-1, 1))
    for (let i = 0; i < pairs; i++) {
      emit(hand, t + 2 * i * preset.stepMs, a)
      hand = other(hand)
      emit(hand, t + (2 * i + 1) * preset.stepMs, b)
      hand = other(hand)
      a = normLane(a + rotate)
      b = normLane(b + rotate)
    }
    return t + (2 * pairs - 1) * preset.stepMs
  }

  /** 갤럽 — "다-닥" 싱코페이션. 반 박을 밀어 두드리는 엇박이 여기서 나온다 */
  const gallop = (t: number): number => {
    const cycles = randInt(2, 4)
    const longGap = Math.round(preset.stepMs * 1.5)
    const shortGap = preset.stepMs * 2 - longGap
    const dir = dirOf()
    let lane = lastNote ? lastNote.lane : Math.floor(rng() * LANE_COUNT)
    let tc = t
    for (let i = 0; i < cycles; i++) {
      const first = emit(hand, tc, lane)
      hand = other(hand)
      if (first) lane = first.lane
      const second = emit(hand, tc + longGap, lane + dir)
      hand = other(hand)
      if (second) lane = second.lane
      tc += longGap + shortGap
    }
    return tc - shortGap
  }

  /** 더블 — 양손 동시 타격. 좌우 대칭이라 읽자마자 몸이 나간다 */
  const doubles = (t: number): number => {
    const reps = randInt(2, 3)
    const rotate = randInt(-1, 1)
    let left = 5 + randInt(0, 2) // 9시 부근(5·6·7)
    let right = normLane(LANE_COUNT - left) // 대칭: 3·2·1
    const gap = preset.stepMs * 2
    for (let i = 0; i < reps; i++) {
      emit('left', t + i * gap, left)
      emit('right', t + i * gap, right)
      const nl = normLane(left + rotate)
      const nr = normLane(right - rotate)
      if (laneDistance(nl, nr) >= 2) {
        left = nl
        right = nr
      }
    }
    return t + (reps - 1) * gap
  }

  const table: [number, (t: number) => number][] = [
    [preset.weights.stream, stream],
    [preset.weights.trill, trill],
    [preset.weights.burst, burst],
    [preset.weights.jump, jump],
    [preset.weights.gallop, gallop],
    [preset.weights.doubles, doubles],
  ]
  const totalWeight = table.reduce((s, [w]) => s + w, 0)

  let cursor = LEAD_IN_MS
  while (cursor <= durationMs) {
    let r = rng() * totalWeight
    let phrase = table[0]![1]
    for (const [w, fn] of table) {
      r -= w
      if (r < 0) {
        phrase = fn
        break
      }
    }
    const end = phrase(cursor)
    cursor = end + preset.restMs[0] + Math.round(rng() * (preset.restMs[1] - preset.restMs[0]))
  }

  notes.sort((a, b) => a.timeMs - b.timeMs)
  return {
    approachTimeMs: preset.approachTimeMs,
    notes,
    durationMs: notes.length ? endTimeOf(notes[notes.length - 1]!) : 0,
  }
}
