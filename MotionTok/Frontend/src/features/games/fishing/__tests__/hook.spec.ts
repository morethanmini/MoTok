import { describe, it, expect } from 'vitest'
import { createHook, DEFAULT_HOOK } from '../hook'

/**
 * 훅킹 판정 스펙.
 *
 * 문턱값 자체는 미실측이라(캐스팅·릴만 2026-07-30에 쟀다) 고정하지 않는다. 대신 **구조**를
 * 고정한다 — 속도 AND 거리. 이 AND가 빠졌을 때 "손을 어깨 근처에 두고 있으면 저절로 챔질"이
 * 실기에서 나왔고(2026-07-29), 그 회귀만은 문턱을 어떻게 조정하든 막아야 한다.
 */

const DT = 1000 / 30
const SW = 165
const REST_Y = 400

/** 양손 중점 y를 프레임마다 step px씩 위로 올린다(음수 = 위) */
function rise(opts: { step: number; frames: number; sw?: number }) {
  const { step, frames, sw = SW } = opts
  const hook = createHook()
  let fired = false
  let t = 0
  // 내린 자세로 최저점을 만든다
  for (let i = 0; i < 6; i++, t += DT) hook.feed(REST_Y, sw, t)
  for (let i = 1; i <= frames; i++, t += DT) {
    if (hook.feed(REST_Y - step * i, sw, t).fired) fired = true
  }
  return fired
}

describe('훅킹 — 속도 AND 거리', () => {
  it('빠르게 충분히 들어올리면 챔질된다', () => {
    // 20px/frame = ×3.6/s, 총 120px = ×0.73
    expect(rise({ step: 20, frames: 6 })).toBe(true)
  })

  it('빠르지만 짧은 흔들림은 챔질되지 않는다', () => {
    // ×3.6/s로 빠르지만 총 40px = ×0.24 < minRiseSw(0.32)
    expect(rise({ step: 20, frames: 2 })).toBe(false)
  })

  it('충분히 올렸지만 느리면 챔질되지 않는다 — 자세 교정과 구분', () => {
    // 총 80px = ×0.48로 거리는 충족하지만 ×1.45/s < upVelSw(2.0)
    expect(rise({ step: 8, frames: 10 })).toBe(false)
  })

  it('가만히 있으면 챔질되지 않는다', () => {
    expect(rise({ step: 0, frames: 20 })).toBe(false)
  })

  it('아래로 내리는 동작은 챔질되지 않는다 — 캐스팅과 겹치지 않는다', () => {
    expect(rise({ step: -20, frames: 6 })).toBe(false)
  })

  it('어깨 너비를 모르면 판정하지 않는다', () => {
    expect(rise({ step: 20, frames: 6, sw: 0 })).toBe(false)
  })
})

describe('훅킹 — 상태 관리', () => {
  it('reset이 히스토리를 지운다 — 이전 페이즈의 동작이 새 입질로 새지 않는다', () => {
    const hook = createHook()
    let t = 0
    for (let i = 0; i < 6; i++, t += DT) hook.feed(REST_Y, SW, t)
    // 올리는 중간에 리셋하면 최저점 기준이 사라져 상승 거리가 0에서 다시 쌓인다
    for (let i = 1; i <= 3; i++, t += DT) hook.feed(REST_Y - 20 * i, SW, t)
    hook.reset()
    const s = hook.feed(REST_Y - 80, SW, (t += DT))
    expect(s.fired).toBe(false)
    expect(s.riseSw).toBe(0)
  })

  it('두 문턱이 모두 양수다 — 하나라도 0이면 AND가 무력해진다', () => {
    expect(DEFAULT_HOOK.upVelSw).toBeGreaterThan(0)
    expect(DEFAULT_HOOK.minRiseSw).toBeGreaterThan(0)
  })
})
