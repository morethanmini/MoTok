import { describe, expect, it } from 'vitest'
import {
  CHAIN_MIN_MS,
  CHAIN_SPAWN_GAP_Z,
  chainApproachMs,
  chainDurationMs,
  chainGapMs,
  chainGapRatio,
} from '@/features/games/body-fit/chainSchedule'
import { randomPose } from '@/features/games/body-fit/randomPose'

/** 게임④ 무대의 접근 거리 — BodyFitGame의 WALL_STOP_Z(-1) - WALL_START_Z(-6) */
const SPAN_Z = 5
/** 난이도 '쉬움'의 벽 접근 시간 — config.difficulty.easy.approachMs */
const EASY_MS = 6000

describe('chainSchedule', () => {
  it('벽마다 빨라지고 하한에서 멈춘다', () => {
    expect(chainApproachMs(0, EASY_MS)).toBeCloseTo(4800, 5) // 6000 × 0.8
    expect(chainApproachMs(1, EASY_MS)).toBeCloseTo(4560, 5) // × 0.95
    expect(chainApproachMs(1, EASY_MS)).toBeLessThan(chainApproachMs(0, EASY_MS))
    // 0.95^n은 언젠가 하한을 뚫는다 — 그 아래로는 안 내려가야 한다
    expect(chainApproachMs(200, EASY_MS)).toBe(CHAIN_MIN_MS)
  })

  it('스폰 간격 비율은 거리 기준(z 1.8)을 easeIn 역함수로 환산한 값이다', () => {
    const ratio = chainGapRatio(SPAN_Z)
    // 역함수 검산: 이 비율만큼 시간이 흐르면 벽은 정확히 gap만큼 나아가 있다
    expect(ratio ** 2.5 * SPAN_Z).toBeCloseTo(CHAIN_SPAWN_GAP_Z, 10)
    // 다음 벽은 앞 벽이 도착하기 전에 출발한다 — 무대에 두 장이 겹쳐 보이는 근거
    expect(ratio).toBeLessThan(1)
  })

  it('도착 간격이 실측(2.9초 → 점점 짧아짐)과 맞는다', () => {
    const arrival = (i: number) => {
      let start = 0
      for (let k = 0; k < i; k++) start += chainGapMs(k, EASY_MS, SPAN_Z)
      return start + chainApproachMs(i, EASY_MS)
    }
    const first = arrival(1) - arrival(0)
    expect(first / 1000).toBeCloseTo(2.9, 1)
    // 가속 중이라 뒤로 갈수록 간격이 좁아진다
    expect(arrival(6) - arrival(5)).toBeLessThan(first)
  })

  it('벽 수를 정하면 종료 시각이 하나로 확정된다 — 서버 endAt의 근거', () => {
    const ten = chainDurationMs(EASY_MS, 10, SPAN_Z)
    expect(ten).toBeGreaterThan(chainApproachMs(0, EASY_MS)) // 최소한 첫 벽 도착 이후
    expect(chainDurationMs(EASY_MS, 20, SPAN_Z)).toBeGreaterThan(ten)
    // 같은 입력이면 항상 같은 값 — 서버·클라가 따로 계산해도 일치해야 한다
    expect(chainDurationMs(EASY_MS, 10, SPAN_Z)).toBe(ten)
    // 무한(0)은 종료 시각이 없다
    expect(chainDurationMs(EASY_MS, 0, SPAN_Z)).toBe(0)
  })
})

describe('randomPose 시드 주입', () => {
  /** mulberry32 — 테스트용 결정론 PRNG(구현체는 FE 본코드와 무관하게 여기서만 쓴다) */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  it('같은 시드는 같은 포즈를, 다른 시드는 다른 포즈를 만든다', () => {
    const a = randomPose(undefined, seeded(42))
    const b = randomPose(undefined, seeded(42))
    const c = randomPose(undefined, seeded(43))
    expect(b).toEqual(a) // 방에서 전원이 같은 벽을 보는 근거
    expect(c).not.toEqual(a)
  })

  it('난수원을 안 넘기면 기존 동작(Math.random)을 유지한다', () => {
    const p = randomPose()
    expect(p.landmarks).toHaveLength(33)
    expect(p.name.length).toBeGreaterThan(0)
  })
})
