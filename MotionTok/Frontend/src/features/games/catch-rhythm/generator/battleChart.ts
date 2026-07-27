/**
 * 대전 모드 채보 생성기 — 시드 하나에서 채보 전체를 결정적으로 만든다.
 *
 * 서버가 방 전원에게 같은 seed를 배포하고 각자 이 함수로 채보를 만든다.
 * 따라서 **이 파일의 난수는 전부 인자로 받은 rng에서만 나와야 한다** —
 * Math.random()이나 Date.now()가 한 번이라도 섞이면 전원 동일 채보가 깨진다.
 *
 * ★ 물리적 도달 가능성(2026-07-27 실플레이 피드백)
 * 예전에는 공간 최소거리만 봤기 때문에 "250ms 뒤 화면 반대편" 같은 못 치는 패턴이 나왔다.
 * 이제 같은 손의 직전 노트로부터 (1) 최소 시간 간격 (2) 이동 속도 한계를 둘 다 건다.
 */

import { mulberry32, foldSeed, type Rng } from '../core/rng'
import { HAND_MAX_SPEED, REACH_SAFETY } from '../core/config'
import type { Beatmap, CatchNote, PathPoint } from '../core/beatmap'
import type { Hand, NoteHand, NoteKind } from '../core/types'
import {
  PRESETS,
  X_RANGE,
  Y_RANGE,
  MIN_GAP,
  MAX_RESAMPLE,
  SLOT_MS,
  LEAD_IN_MS,
  CHART_BPM,
  HAND_SHUFFLE_RATE,
  TRAIL_SEGMENTS,
  TRAIL_SEG_BUDGET,
  type KindWeights,
  type Difficulty,
} from './presets'

/** 생성된 노트 — 스키마(CatchNote)에 튜닝·디버그용 정보를 얹었다. */
export interface GeneratedNote extends CatchNote {
  /** 반대편 영역에서 스폰됐는가 */
  cross: boolean
  /** 'any' 노트도 배치·도달 계산은 이 손 기준으로 한다 */
  owner: Hand
}

export interface GeneratedChart extends Beatmap {
  notes: GeneratedNote[]
}

interface Point {
  x: number
  y: number
}

function other(hand: Hand): Hand {
  return hand === 'left' ? 'right' : 'left'
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * 도달 보정 — 직전 노트에서 dt 안에 갈 수 있는 거리를 넘으면 그쪽으로 당긴다.
 * 스폰 영역 두 구간이 이어져 있어(합집합이 볼록) 당긴 점도 항상 영역 안이다.
 */
function clampReach(point: Point, prev: Point | null, dtMs: number): Point {
  if (!prev) return point
  const maxDist = HAND_MAX_SPEED * (dtMs / 1000) * REACH_SAFETY
  const d = dist(point, prev)
  if (d <= maxDist || d === 0) return point
  const k = maxDist / d
  return { x: prev.x + (point.x - prev.x) * k, y: prev.y + (point.y - prev.y) * k }
}

/**
 * 스폰 위치 샘플링. avoid에 든 점들과 MIN_GAP 이상 떨어질 때까지 재샘플하고,
 * 상한을 넘으면 마지막 표본을 쓴다(밀집 구간에서 무한 루프 방지).
 */
function samplePlacement(rng: Rng, spawnSide: Hand, avoid: Point[]): Point {
  const [x0, x1] = X_RANGE[spawnSide]
  const [y0, y1] = Y_RANGE
  let point: Point = { x: 0, y: 0 }
  for (let attempt = 0; attempt <= MAX_RESAMPLE; attempt++) {
    point = { x: x0 + rng() * (x1 - x0), y: y0 + rng() * (y1 - y0) }
    if (!avoid.some((p) => dist(point, p) < MIN_GAP)) break
  }
  return point
}

/** 전체 스폰 영역(좌우 합집합)으로 점을 밀어 넣는다. */
function clampToField(p: Point): Point {
  const lo = X_RANGE.left[0]
  const hi = X_RANGE.right[1]
  return {
    x: Math.min(hi, Math.max(lo, p.x)),
    y: Math.min(Y_RANGE[1], Math.max(Y_RANGE[0], p.y)),
  }
}

function pickKind(rng: Rng, weights: KindWeights): NoteKind {
  const total = weights.swipe + weights.trail + weights.catch
  const r = rng() * total
  if (r < weights.swipe) return 'swipe'
  if (r < weights.swipe + weights.trail) return 'trail'
  return 'catch'
}

/**
 * 연결 노트 경로 — 시작점에서 이어지는 꺾인 선.
 * durationMs 동안 등속으로 훑으므로 **전체 길이가 손 속도 한계를 넘으면 안 된다**.
 */
function makeTrailPath(rng: Rng, start: Point, durationMs: number): PathPoint[] {
  const [segLo, segHi] = TRAIL_SEGMENTS
  const segments = segLo + Math.floor(rng() * (segHi - segLo + 1))
  // 경로 전체를 durationMs 안에 훑어야 하므로 구간당 예산을 나눠 갖는다
  const budgetPerSeg = (HAND_MAX_SPEED * (durationMs / 1000) * REACH_SAFETY) / segments

  const path: PathPoint[] = []
  let cur = start
  let angle = rng() * Math.PI * 2
  const [fracLo, fracHi] = TRAIL_SEG_BUDGET
  for (let i = 0; i < segments; i++) {
    // 급격히 꺾이면 못 따라가므로 ±60° 안에서만 방향을 튼다
    angle += (rng() - 0.5) * (Math.PI / 1.5)
    const len = budgetPerSeg * (fracLo + rng() * (fracHi - fracLo))
    const next = clampToField({
      x: cur.x + Math.cos(angle) * len,
      y: cur.y + Math.sin(angle) * len,
    })
    path.push(next)
    cur = next
  }
  return path
}

/** 경로의 마지막 점 — 다음 노트의 도달 계산은 여기서 출발한다. */
function endOf(note: GeneratedNote): Point {
  const last = note.path?.[note.path.length - 1]
  return last ?? { x: note.x, y: note.y }
}

/** 노트가 손을 붙잡고 있는 마지막 시각 */
function endTimeOf(note: GeneratedNote): number {
  return note.timeMs + (note.durationMs ?? 0)
}

/**
 * seed + 난이도 + 라운드 길이 → 채보.
 * 같은 인자면 언제 어디서 호출해도 완전히 같은 결과가 나온다.
 */
export function generateBattleChart(
  seed: number | string,
  difficulty: Difficulty,
  durationMs: number,
): GeneratedChart {
  const preset = PRESETS[difficulty]
  const rng = mulberry32(foldSeed(seed))

  const notes: GeneratedNote[] = []
  const lastByHand: Record<Hand, GeneratedNote | null> = { left: null, right: null }
  // 시작 손도 시드에서 — 매판 같은 손으로 시작하지 않게
  let nextHand: Hand = rng() < 0.5 ? 'left' : 'right'

  for (let timeMs = LEAD_IN_MS; timeMs <= durationMs; timeMs += SLOT_MS) {
    if (rng() >= preset.density) continue

    const simultaneous = rng() < preset.simultaneous
    const owners: Hand[] = simultaneous ? ['left', 'right'] : [nextHand]

    const placedThisSlot: Point[] = []
    for (const owner of owners) {
      const prev = lastByHand[owner]
      // 연결 노트는 끝날 때까지 손을 붙잡으므로 "끝난 시각"부터 계산한다
      const dtMs = prev ? timeMs - endTimeOf(prev) : Infinity

      // ① 연타 한계 — 이 손이 아직 못 돌아왔으면 이 슬롯은 건너뛴다
      if (dtMs < preset.minSameHandGapMs) continue

      // ② 크로스는 반대편까지 가야 하므로 여유가 있을 때만
      const cross = dtMs >= preset.crossMinGapMs && rng() < preset.crossRate
      const spawnSide = cross ? other(owner) : owner

      const avoid: Point[] = [...placedThisSlot]
      if (prev) avoid.push(endOf(prev))

      // ③ 도달 보정 — 시간 안에 갈 수 있는 거리로 당긴다
      const sampled = samplePlacement(rng, spawnSide, avoid)
      const { x, y } = clampReach(sampled, prev ? endOf(prev) : null, dtMs)

      const hand: NoteHand = rng() < preset.anyRate ? 'any' : owner
      const kind = pickKind(rng, preset.kinds)

      const note: GeneratedNote = { timeMs, x, y, hand, kind, cross, owner }
      if (kind === 'trail') {
        const [durLo, durHi] = preset.trailDurationMs
        note.durationMs = Math.round(durLo + rng() * (durHi - durLo))
        note.path = makeTrailPath(rng, { x, y }, note.durationMs)
      }
      notes.push(note)
      lastByHand[owner] = note
      placedThisSlot.push(note)
    }

    // 좌우 교대가 기본, 가끔 한 번 더 뒤집어 같은 손이 연속되게 한다
    nextHand = other(nextHand)
    if (rng() < HAND_SHUFFLE_RATE) nextHand = other(nextHand)
  }

  return {
    version: 2,
    title: `캐치캐치리듬 ${difficulty}`,
    mode: 'catch',
    bpm: CHART_BPM,
    offsetMs: 0,
    approachTimeMs: preset.approachTimeMs,
    notes,
    durationMs: notes[notes.length - 1]?.timeMs ?? 0,
  }
}
