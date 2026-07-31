/**
 * 곡 주도 채보 초안 생성기 — 분석 결과(SongAnalysis)에서 캐치/링 초안을 만든다.
 *
 * battleChart(시드 난수 주도)와의 차이: **노트가 놓일 시각을 난수가 아니라 곡의 온셋이
 * 정한다.** 난수는 좌표·손 배정 같은 "어디에/어느 손"에만 쓰이고, 시각 선택은 온셋 세기
 * 순 결정적 그리디다 — 같은 (분석, 난이도, 시드)면 항상 같은 초안이 나온다.
 *
 * 물리 제약(도달 속도·겹침 회피)은 battleChart의 검증된 로직을 **복제**해 쓴다.
 * 공유 모듈로 빼지 않는 이유: battleChart는 대전 결정성의 심장이라 손대지 않는 게 팀 원칙이고,
 * 이쪽은 후보 생성에 음높이 바이어스가 들어가 시그니처가 이미 다르다.
 *
 * 격자: 기본 16분음표(subdivision 4). 셋잇단(3·6)도 받는다. 'hybrid' 스냅은 격자
 * 허용창 안이면 붙이고 밖이면 **원시 온셋 시각을 그대로 둔다** — 밀고 당기는(스윙·루바토)
 * 곡의 그루브를 격자로 뭉개지 않기 위해서다.
 */

import { mulberry32, foldSeed, type Rng } from '../core/rng'
import { HAND_MAX_SPEED, REACH_SAFETY, NOTE_RADIUS } from '../core/config'
import type { Beatmap, CatchNote, PathPoint } from '../core/beatmap'
import type { Hand, NoteHand } from '../core/types'
import {
  PRESETS,
  X_RANGE,
  Y_RANGE,
  MIN_GAP,
  OVERLAP_WINDOW_MS,
  MAX_TRAIL_MS,
  PLACEMENT_CANDIDATES,
  LEAD_IN_MS,
  HAND_SHUFFLE_RATE,
  TRAIL_SEGMENTS,
  TRAIL_SEG_BUDGET,
  TRAIL_ANGLE_CANDIDATES,
  type Difficulty,
} from './presets'
import type { AnalyzedOnset, SongAnalysis, Sustain } from '../analysis/analyzeSong'

// ── 옵션 ─────────────────────────────────────────────────────

export interface SongChartOptions {
  /** 박자당 분할 수 — 4 = 16분음표, 6 = 셋잇단 16분. 곡 BPM 기준이다. */
  subdivision?: 2 | 3 | 4 | 6 | 8
  /**
   * 'hybrid' 격자 허용창 안이면 스냅, 밖이면 원시 시각 유지(기본).
   * 'grid' 전부 스냅 / 'free' 전부 원시 시각.
   */
  snap?: 'hybrid' | 'grid' | 'free'
  /** 라운드 길이 상한 — 없으면 곡 끝까지 */
  maxDurationMs?: number
  title?: string
}

/** 난이도별 목표 노트 밀도(개/초) — 기존 프리셋의 슬롯 확률 × 슬롯 수와 같은 대역이다 */
const TARGET_NOTES_PER_SEC: Record<Difficulty, { catch: number; ring: number }> = {
  EASY: { catch: 0.8, ring: 1.0 },
  NORMAL: { catch: 1.4, ring: 1.7 },
  HARD: { catch: 2.2, ring: 2.6 },
}

/** 곡의 격자 원점이 게임 시각에서 놓이는 자리 — 리드인 뒤 한 박 쉬고 곡이 들어온다 */
export function songStartMs(analysis: SongAnalysis): number {
  return LEAD_IN_MS + Math.round(analysis.beatMs)
}

// ── 시각 선택 (캐치·링 공용) ──────────────────────────────────

interface PickedOnset extends AnalyzedOnset {
  /** 스냅 적용 후의 파일 내 시각 */
  pickedMs: number
  /** 이 온셋에서 시작하는 지속음 (있으면 홀드/연결 후보) */
  sustain: Sustain | null
}

/**
 * 온셋 세기 내림차순 그리디 선택.
 * ① 격자 스냅(옵션) ② 같은 칸 중복 제거 ③ 전역 최소 간격 ④ 목표 개수 도달 시 중단.
 * 세기 순으로 뽑으므로 "곡에서 큰 소리 순서대로" 채워지고, 난이도가 낮을수록
 * 목표 개수가 작아 강한 온셋만 남는다.
 */
function pickOnsets(
  analysis: SongAnalysis,
  targetPerSec: number,
  minGapMs: number,
  options: Required<Pick<SongChartOptions, 'subdivision' | 'snap' | 'maxDurationMs'>>,
): PickedOnset[] {
  const { gridOriginMs, beatMs, sustains } = analysis
  const stepMs = beatMs / options.subdivision
  const snapTolMs = Math.min(45, stepMs * 0.35)

  const endMs = Math.min(analysis.durationMs, options.maxDurationMs)
  const candidates: PickedOnset[] = []
  for (const onset of analysis.onsets) {
    if (onset.timeMs < gridOriginMs || onset.timeMs > endMs) continue
    let pickedMs = onset.timeMs
    if (options.snap !== 'free') {
      const k = Math.round((onset.timeMs - gridOriginMs) / stepMs)
      const snapped = gridOriginMs + k * stepMs
      const dist = Math.abs(onset.timeMs - snapped)
      if (options.snap === 'grid' || dist <= snapTolMs) pickedMs = snapped
    }
    const sustain =
      sustains.find((s) => Math.abs(s.startMs - onset.timeMs) < 60) ?? null
    candidates.push({ ...onset, pickedMs, sustain })
  }

  const targetCount = Math.round(((endMs - gridOriginMs) / 1000) * targetPerSec)
  const byStrength = [...candidates].sort((a, b) => b.strength - a.strength)
  const picked: PickedOnset[] = []
  for (const c of byStrength) {
    if (picked.length >= targetCount) break
    if (picked.some((p) => Math.abs(p.pickedMs - c.pickedMs) < minGapMs)) continue
    picked.push(c)
  }
  picked.sort((a, b) => a.pickedMs - b.pickedMs)
  return picked
}

// ── 캐치 초안 ────────────────────────────────────────────────
// 아래 기하 helper들은 battleChart의 검증된 코드를 복제·개조한 것이다(위 파일 주석 참고).

interface Point {
  x: number
  y: number
}

interface Obstacle extends Point {
  needGap: number
}

function other(hand: Hand): Hand {
  return hand === 'left' ? 'right' : 'left'
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clampReach(point: Point, prev: Point | null, dtMs: number): Point {
  if (!prev) return point
  const maxDist = HAND_MAX_SPEED * (dtMs / 1000) * REACH_SAFETY
  const d = dist(point, prev)
  if (d <= maxDist || d === 0) return point
  const k = maxDist / d
  return { x: prev.x + (point.x - prev.x) * k, y: prev.y + (point.y - prev.y) * k }
}

function requiredGap(dtMs: number): number {
  const near = 350
  if (dtMs <= near) return MIN_GAP
  const k = Math.min(1, (dtMs - near) / (OVERLAP_WINDOW_MS - near))
  return MIN_GAP + (NOTE_RADIUS * 2 - MIN_GAP) * k
}

function clearanceRatio(p: Point, obstacles: Obstacle[]): number {
  let worst = Infinity
  for (const o of obstacles) {
    worst = Math.min(worst, Math.hypot(p.x - o.x, p.y - o.y) / o.needGap)
  }
  return worst
}

function clampToField(p: Point): Point {
  const lo = X_RANGE.left[0]
  const hi = X_RANGE.right[1]
  return {
    x: Math.min(hi, Math.max(lo, p.x)),
    y: Math.min(Y_RANGE[1], Math.max(Y_RANGE[0], p.y)),
  }
}

function endTimeOf(note: CatchNote): number {
  return note.timeMs + (note.durationMs ?? 0)
}

function endOf(note: CatchNote): Point {
  const last = note.path?.[note.path.length - 1]
  return last ?? { x: note.x, y: note.y }
}

function occupiedPoints(notes: CatchNote[], timeMs: number): Obstacle[] {
  const out: Obstacle[] = []
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!
    if (timeMs - n.timeMs > OVERLAP_WINDOW_MS + MAX_TRAIL_MS) break
    const dt = timeMs - endTimeOf(n)
    if (dt > OVERLAP_WINDOW_MS) continue
    const needGap = requiredGap(Math.max(0, dt))
    out.push({ x: n.x, y: n.y, needGap })
    if (n.path) for (const p of n.path) out.push({ x: p.x, y: p.y, needGap })
  }
  return out
}

/**
 * battleChart의 choosePlacement에 **음높이 바이어스**를 얹은 버전.
 * y를 완전 균등으로 뽑지 않고 목표 높이(pitch가 정한다) 주변 정규분포풍으로 뽑는다 —
 * 멜로디가 올라가면 노트도 올라가는 "곡을 따라간다"는 감각의 두 번째 축이다.
 * 겹침 회피가 우선이라 후보 중 목표에서 먼 것도 남겨 둔다(전부 목표 근처면 뭉친다).
 */
function choosePlacement(
  rng: Rng,
  spawnSide: Hand,
  yTarget: number,
  obstacles: Obstacle[],
  prevEnd: Point | null,
  dtMs: number,
): Point {
  const [x0, x1] = X_RANGE[spawnSide]
  const [y0, y1] = Y_RANGE
  let best: Point = { x: 0, y: 0 }
  let bestScore = -Infinity

  for (let i = 0; i < PLACEMENT_CANDIDATES; i++) {
    // 후보 절반은 목표 높이 주변, 절반은 균등 — 바이어스와 탈출구를 같이 가진다
    const yBiased = yTarget + (rng() + rng() - 1) * 0.35
    const y = i % 2 === 0 ? Math.min(y1, Math.max(y0, yBiased)) : y0 + rng() * (y1 - y0)
    const raw = { x: x0 + rng() * (x1 - x0), y }
    const point = clampReach(raw, prevEnd, dtMs)
    const score = clearanceRatio(point, obstacles)
    if (score > bestScore) {
      bestScore = score
      best = point
    }
    if (score >= 1) break
  }
  return best
}

/** battleChart의 makeTrailPath 복제 — 시작 방향만 음높이 변화를 따라 위/아래로 기울인다. */
function makeTrailPath(
  rng: Rng,
  start: Point,
  durationMs: number,
  pitchDelta: number,
  obstacles: Obstacle[],
): PathPoint[] {
  const [segLo, segHi] = TRAIL_SEGMENTS
  const segments = segLo + Math.floor(rng() * (segHi - segLo + 1))
  const budgetPerSeg = (HAND_MAX_SPEED * (durationMs / 1000) * REACH_SAFETY) / segments
  const [fracLo, fracHi] = TRAIL_SEG_BUDGET

  const path: PathPoint[] = []
  let cur = start
  // 게임 좌표 +y가 위쪽 — 멜로디가 올라가면(+delta) 리본도 위로 出発한다
  let angle =
    Math.abs(pitchDelta) > 0.1
      ? (pitchDelta > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * (Math.PI / 3)
      : rng() * Math.PI * 2

  for (let i = 0; i < segments; i++) {
    const len = budgetPerSeg * (fracLo + rng() * (fracHi - fracLo))
    let best: Point = cur
    let bestAngle = angle
    let bestScore = -Infinity

    for (let k = 0; k < TRAIL_ANGLE_CANDIDATES; k++) {
      const a = angle + (rng() - 0.5) * (Math.PI / 1.5)
      const end = clampToField({ x: cur.x + Math.cos(a) * len, y: cur.y + Math.sin(a) * len })
      const mid = { x: (cur.x + end.x) / 2, y: (cur.y + end.y) / 2 }
      const score = Math.min(clearanceRatio(end, obstacles), clearanceRatio(mid, obstacles))
      if (score > bestScore) {
        bestScore = score
        best = end
        bestAngle = a
      }
      if (score >= 1) break
    }

    path.push(best)
    obstacles = [...obstacles, { x: best.x, y: best.y, needGap: MIN_GAP }]
    cur = best
    angle = bestAngle
  }
  return path
}

/** 초안 노트 — battleChart의 GeneratedNote처럼 검증·디버그용 owner를 남긴다 */
export interface SongCatchNote extends CatchNote {
  owner: Hand
}

export interface SongCatchChart extends Beatmap {
  notes: SongCatchNote[]
}

/**
 * SongAnalysis → 캐치 모드 초안.
 *
 * 반환 채보의 `offsetMs`는 **곡의 격자 원점이 놓이는 게임 시각**이다({@link songStartMs}) —
 * 재생 측은 이 시각에 파일의 `analysis.gridOriginMs` 지점이 오도록 곡을 예약하면
 * 노트와 소리가 같은 축에 선다.
 */
export function generateSongCatchChart(
  analysis: SongAnalysis,
  difficulty: Difficulty,
  seed: number | string,
  options: SongChartOptions = {},
): SongCatchChart {
  const preset = PRESETS[difficulty]
  const rng = mulberry32(foldSeed(seed))
  const opts = {
    subdivision: options.subdivision ?? (4 as const),
    snap: options.snap ?? ('hybrid' as const),
    maxDurationMs: options.maxDurationMs ?? Infinity,
  }
  const offsetMs = songStartMs(analysis)
  const toGame = (fileMs: number) => Math.round(offsetMs + (fileMs - analysis.gridOriginMs))

  const picked = pickOnsets(
    analysis,
    TARGET_NOTES_PER_SEC[difficulty].catch,
    // 전역 최소 간격 — 좌우 교대를 전제로 같은 손 간격의 절반. 16분 연타 대역까지 허용한다.
    Math.max(110, preset.minSameHandGapMs / 2),
    opts,
  )

  const notes: SongCatchNote[] = []
  const lastByHand: Record<Hand, SongCatchNote | null> = { left: null, right: null }
  let nextHand: Hand = rng() < 0.5 ? 'left' : 'right'

  for (const onset of picked) {
    const timeMs = toGame(onset.pickedMs)
    if (timeMs < LEAD_IN_MS) continue

    // 아주 강한 온셋(드랍·강박)은 NORMAL 이상에서 양손 동시 노트가 된다
    const simultaneous =
      preset.simultaneous > 0 && onset.strength >= 1.6 && rng() < preset.simultaneous * 2
    /** 이 손이 이 시각에 새 노트를 받을 수 있는가 — 연타 한계 */
    const ready = (hand: Hand): boolean => {
      const prev = lastByHand[hand]
      return !prev || timeMs - endTimeOf(prev) >= preset.minSameHandGapMs
    }
    // 단일 노트는 교대 손이 기본이되, 그 손이 못 돌아왔으면 반대손으로 넘긴다 —
    // 온셋(곡의 소리)을 버리는 것은 양손 다 막혔을 때뿐이다
    const owners: Hand[] = simultaneous
      ? (['left', 'right'] as Hand[]).filter(ready)
      : ready(nextHand)
        ? [nextHand]
        : ready(other(nextHand))
          ? [other(nextHand)]
          : []

    const placedThisOnset: Obstacle[] = []
    let placedAny = false
    for (const usedOwner of owners) {
      const usedPrev = lastByHand[usedOwner]
      const usedDt = usedPrev ? timeMs - endTimeOf(usedPrev) : Infinity

      const cross = usedDt >= preset.crossMinGapMs && rng() < preset.crossRate
      const spawnSide = cross ? other(usedOwner) : usedOwner

      // 음높이 → 높이(+y가 위). 0.5(중앙)를 기준으로 펼친다
      const yTarget = Y_RANGE[0] + onset.pitch * (Y_RANGE[1] - Y_RANGE[0])

      const obstacles: Obstacle[] = [...placedThisOnset, ...occupiedPoints(notes, timeMs)]
      const { x, y } = choosePlacement(
        rng,
        spawnSide,
        yTarget,
        obstacles,
        usedPrev ? endOf(usedPrev) : null,
        usedDt,
      )

      const hand: NoteHand = rng() < preset.anyRate ? 'any' : usedOwner
      const note: SongCatchNote = { timeMs, x, y, hand, kind: 'swipe', owner: usedOwner }

      // 지속음이면 연결(trail) 노트 — 길이는 지속음을 따르되 프리셋 대역으로 제한한다
      const [durLo, durHi] = preset.trailDurationMs
      if (onset.sustain && onset.sustain.durationMs >= durLo * 0.8 && !simultaneous) {
        note.kind = 'trail'
        note.durationMs = Math.round(Math.min(durHi, Math.max(durLo, onset.sustain.durationMs)))
        note.path = makeTrailPath(
          rng,
          { x, y },
          note.durationMs,
          onset.sustain.pitchDelta,
          obstacles,
        )
      }

      notes.push(note)
      lastByHand[usedOwner] = note
      placedThisOnset.push({ x, y, needGap: MIN_GAP })
      placedAny = true
    }

    if (placedAny) {
      nextHand = other(nextHand)
      if (rng() < HAND_SHUFFLE_RATE) nextHand = other(nextHand)
    }
  }

  return {
    version: 2,
    title: options.title ?? `곡 채보 초안 ${difficulty}`,
    mode: 'catch',
    bpm: analysis.bpm,
    offsetMs,
    approachTimeMs: preset.approachTimeMs,
    notes,
    durationMs: notes[notes.length - 1]?.timeMs ?? 0,
  }
}

// ── 링 초안 (프로토타입 에디터 v2 JSON) ───────────────────────

/** 에디터가 읽는 링 노트 — timeMs는 **파일 내 절대 시각**이다(에디터 offsetMs 규약) */
export interface RingDraftNote {
  timeMs: number
  lane: number
  hand?: 'left' | 'right'
  type?: 'hold'
  durationMs?: number
  laneDelta?: number
}

export interface RingDraftChart {
  version: 2
  title: string
  mode: 'ring'
  audio: string | null
  bpm: number
  offsetMs: number
  approachTimeMs: number
  notes: RingDraftNote[]
  /** 에디터 파형 아래 온셋 마커용 — 게임 로더(parseBeatmap)는 무시한다 */
  analysis: { onsets: { timeMs: number; strength: number }[] }
}

const RING_LANES = 8

/** 원형 레인의 최단 부호 거리 (-4~+4) */
function laneDiff(from: number, to: number): number {
  let d = (to - from) % RING_LANES
  if (d > RING_LANES / 2) d -= RING_LANES
  if (d < -RING_LANES / 2) d += RING_LANES
  return d
}

/**
 * SongAnalysis → 링(8레인) 초안. 에디터에서 열어 수정하는 것이 목적이라
 * hand는 지정하지 않고(any), 물리 제약은 "레인 이동량 제한"으로 단순화한다.
 *
 * 레인 배치: 음높이 → 상하 단계(12시=높음, 6시=낮음), 좌우 측면은 교대 —
 * 멜로디 등고선이 링 위에 그려진다.
 */
export function generateSongRingChart(
  analysis: SongAnalysis,
  difficulty: Difficulty,
  seed: number | string,
  options: SongChartOptions & { audio?: string | null } = {},
): RingDraftChart {
  const rng = mulberry32(foldSeed(seed))
  const opts = {
    subdivision: options.subdivision ?? (4 as const),
    snap: options.snap ?? ('hybrid' as const),
    maxDurationMs: options.maxDurationMs ?? Infinity,
  }
  const minGapMs: Record<Difficulty, number> = { EASY: 280, NORMAL: 210, HARD: 160 }
  const picked = pickOnsets(
    analysis,
    TARGET_NOTES_PER_SEC[difficulty].ring,
    minGapMs[difficulty],
    opts,
  )

  // 상하 단계: 0(12시)~4(6시). 우측이면 lane = 단계, 좌측이면 거울(8-lane mod 8)
  const laneFor = (pitch: number, side: 'R' | 'L'): number => {
    const level = Math.round((1 - pitch) * 4)
    return side === 'R' ? level : (RING_LANES - level) % RING_LANES
  }
  /** dt 안에 손이 감당할 레인 이동량 — 대략 200ms에 한 칸 */
  const allowedSteps = (dtMs: number): number =>
    dtMs >= 900 ? RING_LANES : Math.max(1, Math.floor(dtMs / 200))

  const notes: RingDraftNote[] = []
  let side: 'R' | 'L' = rng() < 0.5 ? 'R' : 'L'
  let prevLane: number | null = null
  let prevEndMs = -Infinity

  for (const onset of picked) {
    const timeMs = Math.round(onset.pickedMs)
    let lane = laneFor(onset.pitch, side)
    if (prevLane !== null) {
      const dt = timeMs - prevEndMs
      const diff = laneDiff(prevLane, lane)
      const cap = allowedSteps(dt)
      if (Math.abs(diff) > cap) lane = (prevLane + Math.sign(diff) * cap + RING_LANES) % RING_LANES
    }

    const note: RingDraftNote = { timeMs, lane }
    if (onset.sustain && onset.sustain.durationMs >= 500) {
      note.type = 'hold'
      note.durationMs = Math.round(
        Math.min(analysis.beatMs * 4, Math.max(400, onset.sustain.durationMs)),
      )
      // 멜로디가 움직이면 슬라이드 — 방향은 음높이 변화, 폭은 변화량에 비례(최대 2칸)
      const delta = Math.round(onset.sustain.pitchDelta * 4)
      if (delta !== 0) note.laneDelta = Math.max(-2, Math.min(2, delta))
    }
    notes.push(note)

    prevLane = note.laneDelta ? (lane + note.laneDelta + RING_LANES * 8) % RING_LANES : lane
    prevEndMs = timeMs + (note.durationMs ?? 0)
    if (rng() < 0.5) side = side === 'R' ? 'L' : 'R'
  }

  return {
    version: 2,
    title: options.title ?? `곡 채보 초안 ${difficulty}`,
    mode: 'ring',
    audio: options.audio ?? null,
    bpm: analysis.bpm,
    offsetMs: Math.round(analysis.gridOriginMs),
    approachTimeMs: 1200,
    notes,
    analysis: {
      onsets: analysis.onsets.map((o) => ({
        timeMs: o.timeMs,
        strength: o.strength,
      })),
    },
  }
}
