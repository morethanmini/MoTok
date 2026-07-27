/**
 * 난이도 프리셋 + 채보 생성 기하 상수.
 * 실플레이 튜닝은 이 파일과 core/config.ts에서만 한다.
 */

import type { Hand } from '../core/types'

export type Difficulty = 'EASY' | 'NORMAL' | 'HARD'

export const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD']

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as string[]).includes(value)
}

export interface Preset {
  /** 슬롯마다 노트가 생길 확률 */
  density: number
  /** 노트가 생겼을 때 좌+우 동시 노트가 될 확률 */
  simultaneous: number
  /** 반대편 영역에서 스폰될 확률 (팔이 꼬이는 재미) */
  crossRate: number
  /** 노트가 원경에서 판정 지점까지 오는 시간 */
  approachTimeMs: number
}

export const PRESETS: Record<Difficulty, Preset> = {
  EASY: { density: 0.2, simultaneous: 0, crossRate: 0, approachTimeMs: 1400 },
  NORMAL: { density: 0.38, simultaneous: 0.1, crossRate: 0.1, approachTimeMs: 1200 },
  HARD: { density: 0.55, simultaneous: 0.25, crossRate: 0.35, approachTimeMs: 1000 },
}

// ── 채보 기하 ──────────────────────────────────────────────

/** 고정 BPM. 곡 채보(확장)가 들어오면 이 값 대신 곡의 bpm을 쓴다. */
export const CHART_BPM = 120
/** 1/2박 = 250ms @ BPM 120 — 노트가 놓일 수 있는 최소 간격 */
export const SLOT_MS = 250
/** 카운트다운 직후 유예 — 이 시간 전에는 노트를 놓지 않는다 */
export const LEAD_IN_MS = 3000

/** 손별 기본 스폰 영역(게임 좌표). 겹치는 [-0.1, 0.1]은 가운데 공용 구간. */
export const X_RANGE: Record<Hand, readonly [number, number]> = {
  left: [-0.75, 0.1],
  right: [-0.1, 0.75],
}
export const Y_RANGE: readonly [number, number] = [-0.6, 0.6]

/** 직전 같은 손 노트(및 동시 노트 짝)와 이만큼은 떨어뜨린다 */
export const MIN_GAP = 0.35
/** 간격 조건을 못 맞출 때 재샘플 상한 — 넘으면 마지막 표본을 그대로 쓴다 */
export const MAX_RESAMPLE = 10

/** 좌우 교대를 기본으로 하되 이 확률로 한 번 더 뒤집어 단조로움을 깬다 */
export const HAND_SHUFFLE_RATE = 0.25
