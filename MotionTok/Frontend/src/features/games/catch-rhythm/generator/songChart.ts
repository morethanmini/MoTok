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
  type Preset,
} from './presets'
import type { AnalyzedOnset, SongAnalysis, Sustain } from '../analysis/analyzeSong'
import type { RingBeatmap, RingNote } from '../ring/ringLogic'

// ── 옵션 ─────────────────────────────────────────────────────

export interface SongChartOptions {
  /** 박자당 분할 수 — 4 = 16분음표, 6 = 셋잇단 16분. 곡 BPM 기준이다. */
  subdivision?: 2 | 3 | 4 | 6 | 8
  /**
   * 'free' 전부 원시 온셋 시각 그대로(기본 — 실플레이에서 곡을 제일 잘 따라간다) /
   * 'hybrid' 격자 허용창 안만 스냅 / 'grid' 전부 스냅.
   */
  snap?: 'hybrid' | 'grid' | 'free'
  /** 라운드 길이 상한 — 없으면 곡 끝까지 */
  maxDurationMs?: number
  title?: string
  /**
   * 탭 백본(analysis/tapBackbone의 보정 결과). 있으면 **자동 선택을 완전히 대체**한다 —
   * 밀도 컷 없이 사람이 친 것 전부가 노트 시각이 되고, 격자 스냅·지속음 매칭·배치만 기계가 한다.
   */
  backbone?: AnalyzedOnset[] | null
  /**
   * 트랙→손 **성향**: perc(드럼)는 왼손을, melody(보컬)는 오른손을 우선 시도한다(배치도 그쪽).
   * 강제가 아니다 — 그 손이 연타 한계로 못 받으면 반대손으로 넘기고, 손 라벨도
   * 기존처럼 대부분 any라 플레이어는 아무 손으로나 칠 수 있다.
   */
  handByTrack?: boolean
}

/**
 * 곡 채보 난이도 — 게임 프리셋 3종에 **MANUAL**(탭 백본 전용)을 얹는다.
 * MANUAL은 난이도가 아니라 "내가 찍은 대로": 랜덤 양손·크로스가 꺼지는 건 물론,
 * **물리 제약도 전부 없다** — 연타 간격 0, 도달 보정 없음, 홀드 길이 무제한
 * ("인간에게 한계는 없다" — 유저 지시). 친 것은 무조건 전부 노트가 된다.
 */
export type SongDifficulty = Difficulty | 'MANUAL'

const MANUAL_PRESET: Preset = {
  density: 0, // 백본 모드에서는 안 쓰인다
  simultaneous: 0,
  crossRate: 0,
  anyRate: 0.75,
  kinds: { swipe: 1, trail: 0, catch: 0 },
  trailDurationMs: [400, MAX_TRAIL_MS],
  minSameHandGapMs: 0, // 연타 무제한
  crossMinGapMs: 700,
  approachTimeMs: 1300,
}

function presetFor(difficulty: SongDifficulty): Preset {
  return difficulty === 'MANUAL' ? MANUAL_PRESET : PRESETS[difficulty]
}

/** MANUAL은 자동 선택 몫 계산에서 NORMAL로 취급한다(백본 없이 골랐을 때의 안전망) */
function autoDifficulty(difficulty: SongDifficulty): Difficulty {
  return difficulty === 'MANUAL' ? 'NORMAL' : difficulty
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

/**
 * 연결(trail) 노트 사이 최소 간격 — 직전 트레일이 **끝난** 시각부터 잰다.
 * 지속음이 많은 곡에서 초안이 리본 범벅이 되는 것과, 트레일의 손 점유로 뒤 온셋이
 * 떨어져 나가는 것을 함께 누른다.
 */
const TRAIL_GAP_MS = 2000

// ── 시각 선택 (캐치·링 공용) ──────────────────────────────────

interface PickedOnset extends AnalyzedOnset {
  /** 스냅 적용 후의 파일 내 시각 */
  pickedMs: number
  /** 이 온셋에서 시작하는 지속음 (있으면 홀드/연결 후보) */
  sustain: Sustain | null
}

/**
 * 난이도별 멜로디 스트림 몫 — 밀도를 스트림별로 따로 자른다.
 * 전체를 세기로 한 번에 자르면 플럭스가 작은 보컬이 또 밀려난다(보컬온셋-개선제안.md).
 * EASY는 멜로디 위주(따라 부르기 쉬움), HARD로 갈수록 타악 밀도가 는다.
 */
const MELODY_SHARE: Record<Difficulty, number> = { EASY: 0.6, NORMAL: 0.5, HARD: 0.4 }

/**
 * 온셋 세기 내림차순 그리디 선택 — **스트림별로 따로** 뽑아 병합한다.
 * ① 격자 스냅(옵션) ② 스트림 내 최소 간격 ③ 스트림별 목표 개수(한쪽이 모자라면
 * 남는 몫을 다른 쪽에) ④ 병합 후 시각 순.
 * 스트림 간 간격은 일부러 안 본다 — 킥 옆의 보컬은 양손 동시 노트 재료다.
 */
function pickOnsets(
  analysis: SongAnalysis,
  targetPerSec: number,
  minGapMs: number,
  melodyShare: number,
  options: Required<Pick<SongChartOptions, 'subdivision' | 'snap' | 'maxDurationMs'>> &
    Pick<SongChartOptions, 'backbone'>,
): PickedOnset[] {
  const { gridOriginMs, beatMs, sustains } = analysis
  const stepMs = beatMs / options.subdivision
  const snapTolMs = Math.min(45, stepMs * 0.35)

  const endMs = Math.min(analysis.durationMs, options.maxDurationMs)
  // 백본이 있으면 그것이 곧 온셋 목록 — 사람이 이미 "무엇을 칠지"를 골랐다
  const sourceOnsets = options.backbone ?? analysis.onsets
  const candidates: PickedOnset[] = []
  for (const onset of sourceOnsets) {
    // 백본 탭은 곡 어디든 허용한다(격자 원점 앞의 픽업 프레이즈도 사람이 쳤으면 노트다)
    if (options.backbone ? onset.timeMs < 0 : onset.timeMs < gridOriginMs) continue
    if (onset.timeMs > endMs) continue
    let pickedMs = onset.timeMs
    if (options.snap !== 'free') {
      const k = Math.round((onset.timeMs - gridOriginMs) / stepMs)
      const snapped = gridOriginMs + k * stepMs
      const dist = Math.abs(onset.timeMs - snapped)
      if (options.snap === 'grid' || dist <= snapTolMs) pickedMs = snapped
    }
    const matched = sustains.find((s) => Math.abs(s.startMs - onset.timeMs) < 60) ?? null
    // 탭 홀드는 사람이 정한 길이가 우선 — 검출 지속음은 슬라이드 방향(pitchDelta)만 빌려준다
    const sustain = onset.holdMs
      ? {
          startMs: Math.round(onset.timeMs),
          durationMs: onset.holdMs,
          pitch: onset.pitch,
          pitchDelta: matched?.pitchDelta ?? 0,
        }
      : matched
    candidates.push({ ...onset, pickedMs, sustain })
  }

  // 백본 모드: 선택(밀도 컷) 없이 전부 쓴다. 같은 온셋에 스냅된 중복 탭만 정리.
  if (options.backbone) {
    candidates.sort((a, b) => a.pickedMs - b.pickedMs)
    return candidates.filter(
      (c, i) =>
        i === 0 ||
        Math.abs(c.pickedMs - candidates[i - 1]!.pickedMs) > 10 ||
        c.source !== candidates[i - 1]!.source,
    )
  }

  const targetCount = Math.round(((endMs - gridOriginMs) / 1000) * targetPerSec)
  const perc = candidates.filter((c) => c.source === 'perc')
  const melody = candidates.filter((c) => c.source === 'melody')
  // 스트림별 몫 — 한쪽 후보가 모자라면 남는 몫을 다른 쪽으로 넘긴다
  let melodyTarget = Math.round(targetCount * melodyShare)
  let percTarget = targetCount - melodyTarget
  if (melody.length < melodyTarget) {
    percTarget += melodyTarget - melody.length
    melodyTarget = melody.length
  }
  if (perc.length < percTarget) {
    melodyTarget = Math.min(melody.length, melodyTarget + (percTarget - perc.length))
    percTarget = perc.length
  }

  const pickStream = (list: PickedOnset[], count: number): PickedOnset[] => {
    const byStrength = [...list].sort((a, b) => b.strength - a.strength)
    const out: PickedOnset[] = []
    for (const c of byStrength) {
      if (out.length >= count) break
      if (out.some((p) => Math.abs(p.pickedMs - c.pickedMs) < minGapMs)) continue
      out.push(c)
    }
    return out
  }

  const picked = [...pickStream(perc, percTarget), ...pickStream(melody, melodyTarget)]
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

function occupiedPoints(
  notes: CatchNote[],
  timeMs: number,
  maxTrailMs = MAX_TRAIL_MS, // MANUAL 홀드는 상한이 없다 — 실제 최장 길이를 받아 스캔을 넓힌다
): Obstacle[] {
  const out: Obstacle[] = []
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!
    if (timeMs - n.timeMs > OVERLAP_WINDOW_MS + maxTrailMs) break
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

/** 초안 노트 — battleChart의 GeneratedNote처럼 검증·디버그용 owner·source를 남긴다 */
export interface SongCatchNote extends CatchNote {
  owner: Hand
  /** 어느 검출 스트림에서 온 노트인가 (perc=리듬 뼈대 / melody=보컬·멜로디) */
  source: 'perc' | 'melody'
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
  difficulty: SongDifficulty,
  seed: number | string,
  options: SongChartOptions = {},
): SongCatchChart {
  const preset = presetFor(difficulty)
  const rng = mulberry32(foldSeed(seed))
  const opts = {
    subdivision: options.subdivision ?? (4 as const),
    snap: options.snap ?? ('free' as const),
    maxDurationMs: options.maxDurationMs ?? Infinity,
    backbone: options.backbone ?? null,
    handByTrack: options.handByTrack ?? false,
  }
  const offsetMs = songStartMs(analysis)
  const toGame = (fileMs: number) => Math.round(offsetMs + (fileMs - analysis.gridOriginMs))

  const picked = pickOnsets(
    analysis,
    TARGET_NOTES_PER_SEC[autoDifficulty(difficulty)].catch,
    // 스트림 내 최소 간격 — 좌우 교대를 전제로 같은 손 간격의 절반. 16분 연타 대역까지 허용한다.
    Math.max(110, preset.minSameHandGapMs / 2),
    MELODY_SHARE[autoDifficulty(difficulty)],
    opts,
  )

  const notes: SongCatchNote[] = []
  const lastByHand: Record<Hand, SongCatchNote | null> = { left: null, right: null }
  let nextHand: Hand = rng() < 0.5 ? 'left' : 'right'
  /** 직전 연결 노트가 끝난 시각 — 연결 노트 간 최소 간격(쿨다운)의 기준 */
  let lastTrailEndMs = -Infinity
  const manual = difficulty === 'MANUAL'
  /** 지금까지 만든 가장 긴 연결 노트 — 장애물 스캔 창이 이보다 좁으면 산 노트를 놓친다 */
  let maxTrailMsSeen = MAX_TRAIL_MS

  for (let i = 0; i < picked.length; i++) {
    const onset = picked[i]!
    const timeMs = toGame(onset.pickedMs)
    if (timeMs < LEAD_IN_MS) continue

    // 트랙→손 성향: perc=왼손, melody=오른손을 **우선 시도**한다. 강제가 아니라
    // 그 손이 바쁘면 아래 폴백이 반대손으로 넘긴다(노트를 버리지 않는 게 우선).
    const preferredHand: Hand = opts.handByTrack
      ? onset.source === 'perc'
        ? 'left'
        : 'right'
      : nextHand
    // 아주 강한 온셋(드랍·강박)은 NORMAL 이상에서 양손 동시 노트가 된다
    const simultaneous =
      preset.simultaneous > 0 && onset.strength >= 1.6 && rng() < preset.simultaneous * 2
    /** 이 손이 이 시각에 새 노트를 받을 수 있는가 — 연타 한계 */
    const ready = (hand: Hand): boolean => {
      const prev = lastByHand[hand]
      return !prev || timeMs - endTimeOf(prev) >= preset.minSameHandGapMs
    }
    // 우선 손(성향 또는 교대)이 기본이되, 못 돌아왔으면 반대손으로 넘긴다 —
    // 온셋(곡의 소리)을 버리는 것은 양손 다 막혔을 때뿐이다
    const owners: Hand[] = simultaneous
      ? (['left', 'right'] as Hand[]).filter(ready)
      : ready(preferredHand)
        ? [preferredHand]
        : ready(other(preferredHand))
          ? [other(preferredHand)]
          : []

    const placedThisOnset: Obstacle[] = []
    let placedAny = false
    for (const usedOwner of owners) {
      const usedPrev = lastByHand[usedOwner]
      const usedDt = usedPrev ? timeMs - endTimeOf(usedPrev) : Infinity

      const cross = usedDt >= preset.crossMinGapMs && rng() < preset.crossRate
      const spawnSide = cross ? other(usedOwner) : usedOwner

      // melody: 음높이 → 높이(+y가 위) — 멜로디가 오르내리는 등고선.
      // perc: 하단 안정 위치 — 발 구르듯 낮게 깔려 리듬 뼈대라는 감각을 준다.
      const yTarget =
        onset.source === 'melody'
          ? Y_RANGE[0] + onset.pitch * (Y_RANGE[1] - Y_RANGE[0])
          : Y_RANGE[0] + 0.3 * (Y_RANGE[1] - Y_RANGE[0])

      const obstacles: Obstacle[] = [
        ...placedThisOnset,
        ...occupiedPoints(notes, timeMs, maxTrailMsSeen),
      ]
      // MANUAL은 도달 보정도 없다 — 화면 반대편 연타든 뭐든 친 대로 놓는다
      const { x, y } = choosePlacement(
        rng,
        spawnSide,
        yTarget,
        obstacles,
        manual ? null : usedPrev ? endOf(usedPrev) : null,
        usedDt,
      )

      const hand: NoteHand = rng() < preset.anyRate ? 'any' : usedOwner
      const note: SongCatchNote = {
        timeMs,
        x,
        y,
        hand,
        kind: 'swipe',
        owner: usedOwner,
        source: onset.source,
      }

      // 지속음이면 연결(trail) 노트 — 길이는 지속음을 따르되 프리셋 대역으로 제한한다.
      //
      // ★ 억제 규칙 두 가지(실플레이 피드백: 링은 박이 맞는데 캐치만 어긋난다):
      // 트레일은 손 하나를 오래 점유해서, 그동안 반대손 혼자 감당 못 하는 촘촘한 구간이
      // 오면 온셋이 양손 만석으로 통째로 떨어진다 — "박이 빠지는" 체감의 주범.
      // ① 쿨다운: 직전 트레일이 끝나고 일정 시간이 지나야 다음 트레일을 허용
      // ② 길이 절단: 트레일 중에 같은손 최소 간격보다 촘촘한 온셋 쌍이 등장하면
      //    그 앞에서 손을 놓도록 길이를 줄인다(줄여서 너무 짧아지면 스와이프로 강등)
      const [durLo, durHi] = preset.trailDurationMs
      // 탭 홀드(사람이 누르고 있던 것)는 쿨다운·프리셋 대역을 무시한다 — 명시적 의도라서.
      // 물리 한계(MAX_TRAIL_MS·촘촘 구간 절단)만 지킨다.
      const tapped = onset.holdMs !== undefined
      const wantTrail =
        onset.sustain &&
        !simultaneous &&
        (tapped
          ? true
          : onset.sustain.durationMs >= durLo * 0.8 && timeMs - lastTrailEndMs >= TRAIL_GAP_MS)
      if (wantTrail && onset.sustain) {
        // MANUAL 홀드는 길이 무제한 — 누른 만큼이 곧 리본 길이다
        const tapCapMs = manual ? Number.POSITIVE_INFINITY : MAX_TRAIL_MS
        let dur = tapped
          ? Math.min(tapCapMs, Math.max(400, onset.sustain.durationMs))
          : Math.min(durHi, Math.max(durLo, onset.sustain.durationMs))
        for (let j = i + 1; j + 1 < picked.length; j++) {
          const a = toGame(picked[j]!.pickedMs)
          if (a > timeMs + dur + preset.minSameHandGapMs) break
          const b = toGame(picked[j + 1]!.pickedMs)
          if (b - a < preset.minSameHandGapMs) {
            dur = Math.min(dur, a - preset.minSameHandGapMs - timeMs)
            break
          }
        }
        if (dur >= (tapped ? 300 : durLo * 0.8)) {
          note.kind = 'trail'
          note.durationMs = Math.round(dur)
          note.path = makeTrailPath(
            rng,
            { x, y },
            note.durationMs,
            onset.sustain.pitchDelta,
            obstacles,
          )
          lastTrailEndMs = timeMs + note.durationMs
          maxTrailMsSeen = Math.max(maxTrailMsSeen, note.durationMs)
        }
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
  difficulty: SongDifficulty,
  seed: number | string,
  options: SongChartOptions & { audio?: string | null } = {},
): RingDraftChart {
  const rng = mulberry32(foldSeed(seed))
  const opts = {
    subdivision: options.subdivision ?? (4 as const),
    snap: options.snap ?? ('free' as const),
    maxDurationMs: options.maxDurationMs ?? Infinity,
    backbone: options.backbone ?? null,
    handByTrack: options.handByTrack ?? false,
  }
  const minGapMs: Record<Difficulty, number> = { EASY: 280, NORMAL: 210, HARD: 160 }
  const picked = pickOnsets(
    analysis,
    TARGET_NOTES_PER_SEC[autoDifficulty(difficulty)].ring,
    minGapMs[autoDifficulty(difficulty)],
    MELODY_SHARE[autoDifficulty(difficulty)],
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
    // 트랙→손 성향: 드럼은 왼쪽 반원, 보컬은 오른쪽 반원에 **주로** 놓는다.
    // 손을 못 박는 게 아니라(hand는 그대로 any) 위치로 자연스럽게 유도하는 것.
    const useSide: 'R' | 'L' = opts.handByTrack ? (onset.source === 'perc' ? 'L' : 'R') : side
    // melody: 음높이 등고선(멜로디를 따라 부르는 느낌) / perc: 시드 난수 — 리듬 뼈대는 자유 배치
    let lane = laneFor(onset.source === 'melody' ? onset.pitch : rng(), useSide)
    // MANUAL은 레인 이동 상한도 없다 — 등고선 그대로("인간에게 한계는 없다")
    if (prevLane !== null && difficulty !== 'MANUAL') {
      const dt = timeMs - prevEndMs
      const diff = laneDiff(prevLane, lane)
      const cap = allowedSteps(dt)
      if (Math.abs(diff) > cap) lane = (prevLane + Math.sign(diff) * cap + RING_LANES) % RING_LANES
    }

    const note: RingDraftNote = { timeMs, lane }
    // 탭 홀드(사람 의도)는 문턱을 낮춰서 존중한다
    if (onset.sustain && onset.sustain.durationMs >= (onset.holdMs ? 300 : 500)) {
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

/**
 * 링 초안(에디터 규약: 파일 내 시각) → 인게임 RingBeatmap(게임 시각) — 채보 랩 미리 플레이용.
 * 곡 격자 원점이 {@link songStartMs}에 오도록 전체를 평행이동한다.
 */
export function ringDraftToGameChart(
  draft: RingDraftChart,
  analysis: SongAnalysis,
): RingBeatmap & { durationMs: number } {
  const offset = songStartMs(analysis)
  const notes: RingNote[] = draft.notes
    .map((n) => {
      const note: RingNote = {
        timeMs: Math.round(offset + (n.timeMs - analysis.gridOriginMs)),
        lane: n.lane,
        hand: n.hand ?? 'any',
        type: n.type === 'hold' ? 'hold' : 'tap',
      }
      if (n.type === 'hold') {
        note.durationMs = n.durationMs
        note.laneDelta = n.laneDelta ?? 0
      }
      return note
    })
    .filter((n) => n.timeMs >= LEAD_IN_MS)
  return {
    approachTimeMs: draft.approachTimeMs,
    notes,
    durationMs: notes[notes.length - 1]?.timeMs ?? 0,
  }
}
