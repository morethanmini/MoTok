import { describe, it, expect } from 'vitest'
import { createFight, FISH, idealCatchSeconds, type FishSpec } from '../fight'

/**
 * 힘겨루기 게이지 스펙.
 *
 * 이 모듈의 존재 이유는 "카운트 편향을 게임에서 안 보이게 하는 것"이다(3인 실측에서 펌핑
 * 카운트가 90~115%로 편향). 그래서 가장 중요한 건 마지막 describe — **감기 속도가 15%
 * 차이나도 결과(잡힘/놓침)가 안 뒤집히고 소요 시간만 달라지는지**다.
 */

const DT = 1 / 30
const anchovy = FISH[0]!
const shark = FISH[6]!

/** 일정한 rate로 계속 감았을 때 결과와 소요 시간(초) */
function fightAt(fish: FishSpec, rate: number, maxSec = 60) {
  const f = createFight(fish)
  let t = 0
  for (; t < maxSec; t += DT) {
    const s = f.step(rate, DT)
    if (s.state !== 'fighting') return { state: s.state, sec: t }
  }
  return { state: 'fighting' as const, sec: t }
}

describe('힘겨루기 — 시작 유예', () => {
  /**
   * 2026-07-29 실기: 광어(drain 0.32) 싸움이 세 번 모두 0.8초 만에 끝났다. 시작 진행도 0.25가
   * 저항에 즉시 깎여서, 유저가 손을 올려 감기 시작할 틈이 물리적으로 없었다.
   */
  it('시작 직후 아무것도 안 해도 바로 도망가지 않는다', () => {
    const f = createFight(FISH[2]!) // 광어
    let s = f.step(0, DT)
    for (let t = 0; t < 1.2; t += DT) s = f.step(0, DT)
    expect(s.state).toBe('fighting')
    expect(s.grace).toBe(true)
  })

  it('유예가 끝나면 저항이 걸린다', () => {
    const f = createFight(FISH[2]!)
    let s = f.step(0, DT)
    for (let t = 0; t < 5; t += DT) {
      s = f.step(0, DT)
      if (s.state !== 'fighting') break
    }
    expect(s.state).toBe('escaped')
    expect(s.grace).toBe(false)
  })

  it('유예 중에도 감으면 진행도가 찬다 — 빨리 시작한 사람이 이득', () => {
    const fish = FISH[2]!
    const f = createFight(fish)
    let s = f.step(fish.requiredRate, DT)
    for (let t = 0; t < 1; t += DT) s = f.step(fish.requiredRate, DT)
    expect(s.progress).toBeGreaterThan(0.3)
  })

  it('유예가 있어도 가장 약한 물고기가 자동으로 잡히지는 않는다', () => {
    const f = createFight(FISH[0]!) // 멸치
    let s = f.step(0, DT)
    for (let t = 0; t < 10; t += DT) {
      s = f.step(0, DT)
      if (s.state !== 'fighting') break
    }
    expect(s.state).toBe('escaped')
  })
})

describe('힘겨루기 — 기본 동작', () => {
  it('요구 속도를 충족하면 낚아올린다', () => {
    const r = fightAt(anchovy, anchovy.requiredRate)
    expect(r.state).toBe('caught')
  })

  it('아예 안 감으면 도망간다 (기획: 멈추면 회복)', () => {
    const r = fightAt(anchovy, 0)
    expect(r.state).toBe('escaped')
  })

  it('요구 속도에 살짝 못 미치면 도망간다 — 계속 감아야 한다', () => {
    const r = fightAt(shark, shark.requiredRate - 0.05)
    expect(r.state).toBe('escaped')
  })

  it('reeling 플래그가 요구 속도 충족과 일치한다 — DANGER 연출의 조건', () => {
    const f = createFight(shark)
    expect(f.step(shark.requiredRate, DT).reeling).toBe(true)
    expect(f.step(0, DT).reeling).toBe(false)
  })

  it('결과가 확정되면 진행도가 더 안 움직인다', () => {
    const f = createFight(anchovy)
    let s = f.step(anchovy.requiredRate, 10)
    expect(s.state).toBe('caught')
    s = f.step(0, 10)
    expect(s.state).toBe('caught')
    expect(s.progress).toBe(1)
  })

  it('reset이 새 물고기로 갈아탄다', () => {
    const f = createFight(anchovy)
    f.step(0, 10)
    expect(f.step(0, DT).state).toBe('escaped')
    f.reset(shark)
    expect(f.fish().name).toBe('상어')
    expect(f.step(shark.requiredRate, DT).state).toBe('fighting')
  })
})

describe('어종표 — 밸런스', () => {
  it('점수는 기획 §물고기 종류를 그대로 유지한다', () => {
    expect(FISH.map((f) => f.score)).toEqual([5, 15, 25, 35, 45, 70, 120])
  })

  it('큰 물고기일수록 요구 속도·저항이 높다', () => {
    for (let i = 1; i < FISH.length; i++) {
      expect(FISH[i]!.requiredRate).toBeGreaterThan(FISH[i - 1]!.requiredRate)
      expect(FISH[i]!.drain).toBeGreaterThan(FISH[i - 1]!.drain)
    }
  })

  it('설계 목표 시간이 90초 한 판에 맞고 단조 증가한다', () => {
    for (const f of FISH) {
      expect(f.targetSec).toBeGreaterThanOrEqual(3)
      // 상어도 판의 4분의 1(22.5초) 안쪽 — 보스지만 한 판을 다 먹지는 않는다
      expect(f.targetSec).toBeLessThanOrEqual(22.5)
    }
    for (let i = 1; i < FISH.length; i++) {
      expect(FISH[i]!.targetSec).toBeGreaterThan(FISH[i - 1]!.targetSec)
    }
  })

  /**
   * 실측 배율(실제 ÷ ideal)은 어종마다 2.1~3.3이다. gain이 목표 시간과 이 배율에 대해
   * 대략 정합한지 본다 — ideal × 배율이 targetSec의 ±40% 안이면 튜닝이 유효하다.
   */
  it('gain이 실측 배율 기준으로 목표 시간과 정합한다', () => {
    const factorFor = (i: number) => 2.1 + (i / (FISH.length - 1)) * 1.2 // 2.1 → 3.3 선형
    FISH.forEach((f, i) => {
      const predicted = idealCatchSeconds(f) * factorFor(i)
      expect(predicted).toBeGreaterThan(f.targetSec * 0.6)
      expect(predicted).toBeLessThan(f.targetSec * 1.4)
    })
  })

  /**
   * 2026-07-29 실측: 지속 가능한 감기 속도는 0.37~0.63 왕복/s였다. 처음에 쓴 "1.1~1.7"은
   * 회전 판정 화면에서 스쳐본 순간값이라 지속 속도가 아니었고, 그 탓에 상어 요구 1.30이
   * 물리적으로 불가능해 무조건 도망갔다. 요구 속도 전체를 실측 범위 안으로 넣는다.
   */
  it('모든 어종의 요구 속도가 실측 지속 가능 범위(0.37~0.8) 안에 있다', () => {
    for (const f of FISH) {
      expect(f.requiredRate).toBeGreaterThanOrEqual(0.25)
      expect(f.requiredRate).toBeLessThanOrEqual(0.8)
    }
  })

  it('실측 지속 속도(0.6)로 연어까지 잡히고, 참치·상어는 더 빨리 감아야 한다', () => {
    // 멸치~연어(요구 0.30~0.58) — 평소 속도로 잡힌다
    for (const f of FISH.slice(0, 5)) {
      expect(fightAt(f, 0.6).state).toBe('caught')
    }
    // 참치(0.65)·상어(0.75) — 평소 속도로는 놓치고, 분발하면 잡힌다
    expect(fightAt(FISH[5]!, 0.6).state).toBe('escaped')
    expect(fightAt(FISH[5]!, 0.7).state).toBe('caught')
    expect(fightAt(shark, 0.6).state).toBe('escaped')
    expect(fightAt(shark, 0.8).state).toBe('caught')
  })
})

describe('힘겨루기 — 카운트 편향 흡수 (이 설계의 목적)', () => {
  it('감기 속도가 15% 높아도 결과는 안 뒤집히고 시간만 짧아진다', () => {
    const base = fightAt(shark, shark.requiredRate)
    const fast = fightAt(shark, shark.requiredRate * 1.15)
    expect(base.state).toBe('caught')
    expect(fast.state).toBe('caught')
    // 속도 모델이라 요구치를 넘으면 채우는 속도는 같다 — 편향이 결과에 안 나타난다
    expect(fast.sec).toBeCloseTo(base.sec, 1)
  })

  it('요구 속도를 넉넉히 넘기면 사람마다 편향이 있어도 전원 잡는다', () => {
    // 3인 실측 편향(90% / 95% / 115%)을 감기 속도에 그대로 반영
    for (const bias of [0.9, 0.95, 1.15]) {
      const r = fightAt(FISH[2]!, FISH[2]!.requiredRate * 1.3 * bias)
      expect(r.state).toBe('caught')
    }
  })
})
