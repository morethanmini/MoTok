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

/**
 * 노트 종류 가중치 — 합이 1이 아니어도 되고, 비율로 정규화된다.
 *
 * catch(주먹 쥐기)는 **현재 전 난이도 0**이다. 손 트래킹으로 쥠/폄을 구분하는 게
 * 태생적으로 느리고 부정확해서 실플레이에서 계속 걸림돌이 됐다.
 * 판정 로직·렌더·테스트는 남아 있으니 되살리려면 이 숫자만 올리면 된다.
 */
export interface KindWeights {
  swipe: number
  trail: number
  catch: number
}

export interface Preset {
  /** 슬롯마다 노트가 생길 확률 */
  density: number
  /** 노트가 생겼을 때 좌+우 동시 노트가 될 확률 */
  simultaneous: number
  /** 반대편 영역에서 스폰될 확률 (팔이 꼬이는 재미) */
  crossRate: number
  /** 아무 손으로나 잡을 수 있는 노트의 비율 — 주력이다 */
  anyRate: number
  /** 노트 종류 분포 */
  kinds: KindWeights
  /** 연결 노트 길이 범위(ms) */
  trailDurationMs: readonly [number, number]
  /** 같은 손 노트 사이 최소 간격 — 물리적 연타 한계 */
  minSameHandGapMs: number
  /** 크로스는 반대편까지 가야 하므로 이만큼 여유가 있을 때만 만든다 */
  crossMinGapMs: number
  /** 노트가 원경에서 판정 지점까지 오는 시간 */
  approachTimeMs: number
}

/**
 * 실플레이 피드백(2026-07-27) 2차 반영.
 * - **스와이프가 주력**. 주먹(catch)은 인식률 문제로 아예 빼고, 스와이프/연결 둘로 간다
 * - **양손 인식(any)이 기본** — 손을 지정하면 급격히 어려워진다
 * - 크로스는 "스와이프인데 손이 꼬이는" 재미 요소로만 남긴다
 */
export const PRESETS: Record<Difficulty, Preset> = {
  EASY: {
    density: 0.18,
    simultaneous: 0,
    crossRate: 0,
    anyRate: 0.75,
    kinds: { swipe: 0.76, trail: 0.24, catch: 0 },
    trailDurationMs: [1100, 1700],
    minSameHandGapMs: 500,
    crossMinGapMs: 900,
    approachTimeMs: 1500,
  },
  NORMAL: {
    density: 0.32,
    simultaneous: 0.08,
    crossRate: 0.16,
    anyRate: 0.6,
    kinds: { swipe: 0.73, trail: 0.27, catch: 0 },
    trailDurationMs: [1000, 1500],
    minSameHandGapMs: 380,
    crossMinGapMs: 800,
    approachTimeMs: 1300,
  },
  HARD: {
    density: 0.48,
    simultaneous: 0.2,
    crossRate: 0.3,
    anyRate: 0.45,
    kinds: { swipe: 0.71, trail: 0.29, catch: 0 },
    trailDurationMs: [850, 1300],
    minSameHandGapMs: 300,
    crossMinGapMs: 700,
    approachTimeMs: 1100,
  },
}

// ── 채보 기하 ──────────────────────────────────────────────

/** 고정 BPM. 곡 채보(확장)가 들어오면 이 값 대신 곡의 bpm을 쓴다. */
export const CHART_BPM = 120
/** 1/2박 = 250ms @ BPM 120 — 노트가 놓일 수 있는 최소 간격 */
export const SLOT_MS = 250
/**
 * 카운트다운 직후 유예 — 이 시간 전에는 노트를 놓지 않는다.
 *
 * 3초는 카운트다운이 끝나자마자 첫 노트가 도착해 대처할 틈이 없었다(실플레이 피드백).
 * 카운트다운 3초 + 손을 올리고 자세를 잡을 2초를 준다.
 */
export const LEAD_IN_MS = 5000

/** 손별 기본 스폰 영역(게임 좌표). 두 구간이 이어져 있어 합집합이 볼록하다(도달 보정에 필요). */
export const X_RANGE: Record<Hand, readonly [number, number]> = {
  left: [-0.75, 0.1],
  right: [-0.1, 0.75],
}
export const Y_RANGE: readonly [number, number] = [-0.6, 0.6]

/**
 * 화면에 같이 떠 있는 노트끼리 최소 이 거리는 떨어뜨린다.
 * 노트 지름(2 × NOTE_RADIUS = 0.30)보다 커야 시각적으로 겹치지 않는다.
 */
export const MIN_GAP = 0.44
/**
 * 겹침 검사 시간 창 — 판정 시각이 이 안에 있는 노트끼리 거리를 본다.
 * 접근 시간이 최대 1.9초(주먹 노트)라 그만큼 넓게 봐야 화면이 안 지저분해진다.
 */
export const OVERLAP_WINDOW_MS = 1700
/** 위치 후보를 이만큼 뽑아 **가장 안 겹치는 것**을 고른다(실패해도 최선을 쓴다) */
export const PLACEMENT_CANDIDATES = 24

/** 좌우 교대를 기본으로 하되 이 확률로 한 번 더 뒤집어 단조로움을 깬다 */
export const HAND_SHUFFLE_RATE = 0.25

/** 연결 노트 경로의 꺾임 개수 범위 (시작점 제외한 추가 점 개수) */
/** 어떤 난이도에서도 연결 노트가 이보다 길지 않다 — 장애물 스캔 범위 계산에 쓴다 */
export const MAX_TRAIL_MS = 1700

export const TRAIL_SEGMENTS: readonly [number, number] = [2, 4]
/**
 * 구간 길이를 "지속 시간이 허락하는 예산"의 몇 배로 잡을지.
 * 너무 짧으면 인식 반경 안에 경로가 통째로 들어와 **가만히 있어도 통과**한다 —
 * 판정을 후하게 가져가는 대신 경로는 반드시 손을 움직여야 하는 길이여야 한다.
 */
/** 연결 노트 구간마다 방향 후보를 이만큼 뽑아 장애물을 가장 잘 피하는 쪽을 고른다 */
export const TRAIL_ANGLE_CANDIDATES = 12

export const TRAIL_SEG_BUDGET: readonly [number, number] = [0.6, 1.0]
