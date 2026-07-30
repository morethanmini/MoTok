import { describe, it, expect } from 'vitest'
import {
  createFight,
  DRAIN_CAP,
  DRAIN_PER_GAIN,
  drainSeconds,
  expectedCatchSeconds,
  FISH,
  reactionSeconds,
  WARMUP_SEC,
  type FishSpec,
} from '../fight'

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

  it('큰 물고기일수록 요구 속도가 높고 게이지가 천천히 찬다', () => {
    for (let i = 1; i < FISH.length; i++) {
      expect(FISH[i]!.requiredRate).toBeGreaterThan(FISH[i - 1]!.requiredRate)
      expect(FISH[i]!.gain).toBeLessThan(FISH[i - 1]!.gain)
    }
  })

  /**
   * drain은 gain에 비례해야 한다. "큰 물고기일수록 저항이 크다"로 잡으면 못 잡는 물고기가
   * 생긴다 — 잡히는 조건이 `p·gain > (1-p)·drain`인데 큰 물고기는 gain이 작기 때문이다.
   * 이전 버전에서 상어 요구 1.30이 물리적으로 불가능했던 것과 같은 실패 모드다.
   */
  it('drain이 gain에 비례하되 상한을 넘지 않는다 — 못 잡는 물고기가 생기지 않는 배치', () => {
    for (const f of FISH) {
      expect(f.drain).toBeCloseTo(Math.min(DRAIN_PER_GAIN * f.gain, DRAIN_CAP), 2)
    }
  })

  /**
   * 2026-07-30 실기: 멸치 4마리 중 3마리가 `관측최대=0.00`으로 도망갔다 — **감기를 시작하지도
   * 못했다.** drain을 gain에 비례시키니 gain이 가장 큰 멸치가 drain도 가장 커져(0.68) 유예 뒤
   * 0.44초 만에 게이지가 비었고, pump 워밍업이 1초라 물리적으로 이길 수 없었다.
   */
  it('감기를 시작할 수 있는 시간이 pump 워밍업보다 넉넉하다', () => {
    for (const f of FISH) {
      // 워밍업 1초 + 사람 반응 0.5초 = 1.5초보다 여유가 있어야 한다
      expect(reactionSeconds(f)).toBeGreaterThan(WARMUP_SEC + 1.5)
    }
  })

  it('요구 속도를 65% 이상 유지하면 어떤 어종도 잡힌다', () => {
    // p·gain > (1-p)·drain 을 p=0.65에서 만족하는지 — drain/gain 비율의 상한이 여기서 나온다
    const P = 0.65
    for (const f of FISH) {
      expect(P * f.gain).toBeGreaterThan((1 - P) * f.drain)
    }
  })

  /**
   * DANGER가 위협이려면 멈췄을 때 게이지가 그 어종의 싸움 시간 안에 비어야 한다.
   *
   * 단 **멸치는 예외다.** 3초짜리 싸움에 1.2초의 반응 여유(DRAIN_CAP)를 주면 게이지 비는
   * 시간이 4초가 되어 목표를 넘는다. 둘이 충돌할 때는 반응 여유가 이긴다 — 손쓸 수 없이
   * 죽는 물고기(2026-07-30 멸치 3마리)가 위협 없는 물고기보다 나쁘다.
   * 3초 안에 끝나는 싸움은 애초에 멈출 틈이 없어서 위협이 필요하지도 않다.
   */
  it('멈추면 게이지가 빈다 — 오래 싸우는 어종은 목표 시간 안에', () => {
    for (const f of FISH) {
      expect(f.drain).toBeGreaterThan(0)
      if (f.targetSec >= 5) expect(drainSeconds(f)).toBeLessThan(f.targetSec)
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
   * gain은 `워밍업 + 실측배율 × 이론시간 = targetSec`으로 역산한다. 이론시간만 맞추면
   * 실제가 1.3배 + 1초로 나온다(2026-07-30 7전: 상어 목표 20s → 실제 26.2s).
   */
  it('예상 소요 시간이 목표와 정합한다 — 워밍업·실측 배율 포함', () => {
    for (const f of FISH) {
      expect(expectedCatchSeconds(f)).toBeCloseTo(f.targetSec, 0)
    }
  })

  /**
   * 2026-07-30 실측(게임 루프 6전): 지속 감기 속도가 **1.45~2.41 왕복/s(평균 2.07)**.
   * 이전 표는 0.30~0.75라 전 어종이 문턱의 3~7배 아래였고 DANGER가 뜰 일이 없었다.
   * 요구 속도를 실측 밴드 안에 펼쳐야 큰 물고기가 실제로 저항한다.
   */
  it('요구 속도가 실측 지속 밴드(1.45~2.41) 안에 펼쳐진다', () => {
    // 가장 약한 물고기는 누구나 넘는다
    expect(FISH[0]!.requiredRate).toBeLessThan(1.45 * 0.5)
    // 가장 센 물고기는 실측 최저보다 위 — 자주 문턱 아래로 떨어져야 저항이 된다
    expect(shark.requiredRate).toBeGreaterThan(1.45)
    // 다만 실측 평균은 넘지 않는다. 넘으면 물리적으로 불가능해진다(이전 버전의 실패 모드)
    expect(shark.requiredRate).toBeLessThan(2.07)
  })

  it('실측 최저 지속 속도(1.45)로 참치까지 잡히고, 상어는 더 빨리 감아야 한다', () => {
    for (const f of FISH.slice(0, 6)) {
      expect(fightAt(f, 1.45).state).toBe('caught')
    }
    expect(fightAt(shark, 1.45).state).toBe('escaped')
    // 실측 평균(2.07)이면 상어도 잡힌다
    expect(fightAt(shark, 2.07).state).toBe('caught')
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
