/**
 * 대전 모드 채보 생성기 — 시드 하나에서 채보 전체를 결정적으로 만든다.
 *
 * 서버가 방 전원에게 같은 seed를 배포하고 각자 이 함수로 채보를 만든다.
 * 따라서 **이 파일의 난수는 전부 인자로 받은 rng에서만 나와야 한다** —
 * Math.random()이나 Date.now()가 한 번이라도 섞이면 전원 동일 채보가 깨진다.
 *
 * rng 호출 순서가 곧 채보이므로, 분기를 바꾸면 같은 seed라도 다른 채보가 나온다.
 * (배포 중 생성기를 바꾸면 구버전 클라와 채보가 갈린다 — 버전 고정 필요)
 */

import { mulberry32, foldSeed, type Rng } from '../core/rng'
import type { Beatmap, CatchNote } from '../core/beatmap'
import type { Hand } from '../core/types'
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
  type Difficulty,
} from './presets'

/** 생성된 노트 — 스키마(CatchNote)에 튜닝·디버그용 cross 플래그를 얹었다. */
export interface GeneratedNote extends CatchNote {
  hand: Hand
  /** 반대편 영역에서 스폰됐는가 */
  cross: boolean
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

/**
 * 스폰 위치 샘플링. avoid에 든 점들과 MIN_GAP 이상 떨어질 때까지 재샘플하고,
 * 상한을 넘으면 마지막 표본을 그대로 쓴다(무한 루프 방지 — 밀집 구간에서는 붙어도 진행).
 */
function samplePlacement(rng: Rng, spawnSide: Hand, avoid: Point[]): Point {
  const [x0, x1] = X_RANGE[spawnSide]
  const [y0, y1] = Y_RANGE
  let point: Point = { x: 0, y: 0 }
  for (let attempt = 0; attempt <= MAX_RESAMPLE; attempt++) {
    point = { x: x0 + rng() * (x1 - x0), y: y0 + rng() * (y1 - y0) }
    const tooClose = avoid.some((p) => Math.hypot(point.x - p.x, point.y - p.y) < MIN_GAP)
    if (!tooClose) break
  }
  return point
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
    const hands: Hand[] = simultaneous ? ['left', 'right'] : [nextHand]

    const placedThisSlot: Point[] = []
    for (const hand of hands) {
      const cross = rng() < preset.crossRate
      const spawnSide = cross ? other(hand) : hand

      const avoid: Point[] = [...placedThisSlot]
      const prev = lastByHand[hand]
      if (prev) avoid.push(prev)

      const { x, y } = samplePlacement(rng, spawnSide, avoid)
      const note: GeneratedNote = { timeMs, x, y, hand, cross }
      notes.push(note)
      lastByHand[hand] = note
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
