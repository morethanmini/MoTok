import { describe, expect, it } from 'vitest'
import {
  CHAIN_MIN_MS,
  CHAIN_SPAWN_GAP_Z,
  chainApproachMs,
  chainDurationMs,
  chainGapMs,
  chainGapRatio,
  seededRng,
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

  /**
   * 서버(GameSessionService.chainDurationMillis)가 같은 식을 Java로 미러하고 있다.
   * 어긋나면 마지막 벽 도착 전에 정산되거나(점수 유실) 끝난 뒤 빈 화면으로 기다리게 되는데,
   * 두 언어를 한 테스트에서 돌릴 수 없으므로 양쪽을 같은 숫자에 못박아 드리프트를 잡는다.
   * BE GameSessionServiceTest의 endAt 기대값 = 이 값 + 꼬리 여유 1500ms.
   */
  it('BE와 못박은 값 — 이 숫자가 바뀌면 서버 endAt도 같이 갱신해야 한다', () => {
    expect(Math.round(chainDurationMs(6000, 10, SPAN_Z))).toBe(26614) // 쉬움
    expect(Math.round(chainDurationMs(6000, 20, SPAN_Z))).toBe(42304)
    expect(Math.round(chainDurationMs(6000, 30, SPAN_Z))).toBe(56923)
    expect(Math.round(chainDurationMs(5000, 20, SPAN_Z))).toBe(36870) // 보통
    expect(Math.round(chainDurationMs(4000, 20, SPAN_Z))).toBe(32597) // 어려움
  })
})

describe('시드 → 벽 수열', () => {
  it('같은 시드는 같은 포즈를, 다른 시드는 다른 포즈를 만든다', () => {
    const a = randomPose(undefined, seededRng('42'))
    const b = randomPose(undefined, seededRng('42'))
    const c = randomPose(undefined, seededRng('43'))
    expect(b).toEqual(a) // 방에서 전원이 같은 벽을 보는 근거
    expect(c).not.toEqual(a)
  })

  /**
   * 실제로 방에서 벌어지는 일 — 참가자마다 rng를 따로 만들어 벽 30장을 뽑는다.
   * 한 장만 어긋나도 그 뒤 전부가 갈리므로(수열이라) 승부가 무의미해진다.
   */
  it('참가자마다 따로 만든 생성기가 벽 30장 전부 같은 수열을 낸다', () => {
    const seed = '8675309'
    const player = (s: string) => {
      const rng = seededRng(s)
      return Array.from({ length: 30 }, () => randomPose(undefined, rng))
    }
    expect(player(seed)).toEqual(player(seed))
    expect(player('8675310')).not.toEqual(player(seed))
  })

  it('난수원을 안 넘기면 기존 동작(Math.random)을 유지한다', () => {
    const p = randomPose()
    expect(p.landmarks).toHaveLength(33)
    expect(p.name.length).toBeGreaterThan(0)
  })
})
