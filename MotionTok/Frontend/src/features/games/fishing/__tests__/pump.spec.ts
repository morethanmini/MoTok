import { describe, it, expect } from 'vitest'
import { createPump, DEFAULT_PUMP, type PumpSample } from '../pump'

/**
 * 펌핑 판정 스펙.
 *
 * 회전 판정(reel.ts)이 실기 효율 53~64%에서 막힌 뒤 대안으로 만든 것이라, 가장 중요한 건
 * **효율 100%가 나오는지**(①②)와 **미세 떨림으로 감기지 않는지**(④)다.
 */

const TAU = Math.PI * 2
const FPS = 30
const DT = 1000 / FPS
const CY = 240

/** y = CY + sin(...)·ampPx 궤적을 laps 왕복만큼 흘려보낸다 */
function pumpTrace(opts: {
  laps: number
  perSec: number
  ampPx: number
  fps?: number
  jitterPx?: number
}): PumpSample {
  const { laps, perSec, ampPx, fps = FPS, jitterPx = 0 } = opts
  const pump = createPump()
  const dt = 1000 / fps
  let s = 4242
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff - 0.5
  }
  let last: PumpSample = { rate: 0, revs: 0, active: false }
  for (let t = 0; t <= (laps / perSec) * 1000; t += dt) {
    const y = CY + Math.sin(TAU * perSec * (t / 1000)) * ampPx + rnd() * jitterPx
    last = pump.feed(y, t)
  }
  return last
}

describe('펌핑 — 정상 왕복', () => {
  it('10왕복 · 0.9/s · 진폭 67px → 효율 90% 이상', () => {
    // 진폭 문턱을 90px로 올린 뒤(무의식 흔들림 차단) 창이 차기까지 반주기 하나가 더 깎인다
    const r = pumpTrace({ laps: 10, perSec: 0.9, ampPx: 67 })
    expect(r.revs).toBeGreaterThanOrEqual(9)
    expect(r.active).toBe(true)
  })

  it('최악 프레임레이트(15fps)에서도 효율이 유지된다', () => {
    const r = pumpTrace({ laps: 10, perSec: 1.2, ampPx: 67, fps: 15 })
    expect(r.revs).toBeGreaterThanOrEqual(9)
  })

  it('6px 랜드마크 지터가 섞여도 과다·과소 카운트되지 않는다', () => {
    const r = pumpTrace({ laps: 10, perSec: 0.9, ampPx: 67, jitterPx: 6 })
    expect(r.revs).toBeGreaterThanOrEqual(9)
    expect(r.revs).toBeLessThan(11)
  })

  it('rate가 실제 왕복 속도를 ±15% 안에서 따라간다', () => {
    for (const perSec of [0.5, 0.8, 1.2, 1.7]) {
      const r = pumpTrace({ laps: 12, perSec, ampPx: 67 })
      expect(r.rate).toBeGreaterThan(perSec * 0.85)
      expect(r.rate).toBeLessThan(perSec * 1.15)
    }
  })

  /**
   * 2026-07-29 실기 버그: rate를 "창 안의 반주기 개수"로 냈더니 900ms 창에서 나올 수 있는 값이
   * 0.56 / 1.11 / 1.67…로 0.56 단위로 띄어졌다. 그래서 멸치 요구 속도 0.60이 실질적으로 1.11을
   * 요구해 `요구 0.60 / 현재 0.56`으로 가장 약한 물고기조차 도망갔다.
   * 간격의 역수로 바꿔 연속값이 되었는지 — 0.6~1.1 사이 값이 실제로 나오는지 고정한다.
   */
  it('rate에 양자화 구멍이 없다 — 0.6~1.1 사이 값이 나온다', () => {
    const mid = [0.65, 0.75, 0.85, 0.95, 1.05].map(
      (perSec) => pumpTrace({ laps: 12, perSec, ampPx: 67 }).rate,
    )
    for (const r of mid) {
      expect(r).toBeGreaterThan(0.6)
      expect(r).toBeLessThan(1.1)
    }
    // 서로 구별되는 값이어야 한다(같은 계단에 뭉치면 안 된다)
    expect(new Set(mid.map((r) => r.toFixed(2))).size).toBeGreaterThan(3)
  })

  it('감기를 멈추면 rate가 0으로 감쇠한다', () => {
    const pump = createPump()
    let t = 0
    for (; t <= 4000; t += DT) {
      pump.feed(CY + Math.sin(TAU * (t / 1000)) * 67, t)
    }
    const moving = pump.feed(CY, t).rate
    expect(moving).toBeGreaterThan(0.5)
    // 손을 멈춘 채 3초 경과
    for (let i = 0; i < 90; i++) {
      t += DT
      pump.feed(CY, t)
    }
    expect(pump.feed(CY, t).rate).toBeLessThan(0.2)
  })
})

describe('펌핑 — 감기로 보지 않는 것', () => {
  it('정지 상태는 누적되지 않는다', () => {
    const pump = createPump()
    let last: PumpSample = { rate: 0, revs: 0, active: false }
    for (let t = 0; t <= 3000; t += DT) last = pump.feed(CY, t)
    expect(last.revs).toBe(0)
    expect(last.active).toBe(false)
  })

  it('진폭이 문턱 미만인 미세 떨림은 누적되지 않는다', () => {
    // minAmpPx(26px)의 절반짜리 빠른 떨림
    const r = pumpTrace({ laps: 40, perSec: 8, ampPx: 6 })
    expect(r.revs).toBe(0)
    expect(r.active).toBe(false)
  })

  it('불감대 안에서만 흔들면 반전으로 인정되지 않는다', () => {
    const pump = createPump()
    // 큰 진폭을 한 번 만들어 창을 채운 뒤(진폭 문턱 통과), 중앙에서만 미세하게 흔든다
    for (let t = 0; t <= 300; t += DT) pump.feed(CY + Math.sin(TAU * (t / 300)) * 60, t)
    const before = pump.debug().halves
    for (let t = 300; t <= 1000; t += DT) {
      pump.feed(CY + Math.sin(TAU * 6 * (t / 1000)) * 3, t)
    }
    // 중앙 미세 떨림은 불감대(진폭의 ±25%)를 못 넘어 반주기를 만들지 않는다
    expect(pump.debug().halves - before).toBeLessThanOrEqual(1)
  })

  it('reset이 누적을 지운다', () => {
    const pump = createPump()
    for (let t = 0; t <= 3000; t += DT) {
      pump.feed(CY + Math.sin(TAU * (t / 1000)) * 67, t)
    }
    expect(pump.debug().halves).toBeGreaterThan(3)
    pump.reset()
    // firstTick·lastTick도 지워야 한다 — 남으면 지속 속도 구간이 리셋 전까지 늘어난다
    expect(pump.debug()).toEqual({
      ampPx: 0,
      halves: 0,
      phase: null,
      firstTick: 0,
      lastTick: 0,
    })
  })

  /**
   * 지속 속도의 근거 — 랩이 어종표 requiredRate를 정할 때 쓰는 숫자다.
   *
   * feed의 rate는 마지막 반주기 간격의 역수라 순간값이고, 지속 속도와 3배까지 벌어진다
   * (2026-07-29 실측: y왕복 순간 1.28/s vs 어종표를 잡은 지속 0.37~0.63/s). 순간값을 지속
   * 속도로 착각해 어종표를 한 번 잘못 잡았으므로(fight.ts 어종표 주석) 구간 평균이 실제
   * 주기와 맞는다는 걸 고정해둔다.
   */
  it('firstTick~lastTick 구간 평균이 실제 왕복 주기와 맞는다', () => {
    const pump = createPump()
    const HZ = 1.0
    for (let t = 0; t <= 10_000; t += DT) {
      pump.feed(CY + Math.sin(TAU * HZ * (t / 1000)) * 67, t)
    }
    const d = pump.debug()
    // 구간 안의 반주기 간격은 halves-1개다 — 양 끝이 시각이라 간격이 하나 적다
    const sustained = (d.halves - 1) / 2 / ((d.lastTick - d.firstTick) / 1000)
    expect(sustained).toBeCloseTo(HZ, 1)
  })
})

describe('펌핑 — 회전 동작도 그대로 통과한다', () => {
  it('타원 궤도로 돌린 손의 y성분만 봐도 왕복이 잡힌다', () => {
    // 실측 크랭크: 장축 67px·종횡비 0.55 → y는 진폭 67px 사인파
    const pump = createPump()
    let last: PumpSample = { rate: 0, revs: 0, active: false }
    for (let t = 0; t <= (10 / 0.89) * 1000; t += DT) {
      const a = TAU * 0.89 * (t / 1000)
      // x는 버리고 y만 넣는다 — 판정에 x가 필요 없다는 게 이 방식의 핵심
      last = pump.feed(CY + Math.sin(a) * 67, t)
    }
    expect(last.revs).toBeGreaterThanOrEqual(9)
  })

  /**
   * 실측 감기 진폭(왕복 전체 폭)은 191~358px였다(2026-07-29 3인). 문턱은 그보다 충분히 낮아
   * 실제 감기를 놓치지 않으면서, 무의식적 흔들림(수십 px)은 잘라야 한다.
   */
  it('진폭 문턱이 실측 감기 진폭(191px 이상)보다 충분히 낮다', () => {
    expect(DEFAULT_PUMP.minAmpPx).toBeLessThan(191 * 0.6)
    // 26px은 너무 낮아 손을 어깨 근처에 두기만 해도 저절로 감겼다
    expect(DEFAULT_PUMP.minAmpPx).toBeGreaterThan(50)
  })
})
