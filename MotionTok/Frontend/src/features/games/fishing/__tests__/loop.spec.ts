import { describe, it, expect } from 'vitest'
import {
  bandIndexOf,
  bandYRange,
  createLoop,
  DEFAULT_LOOP,
  landingXFromAim,
  seededRng,
} from '../loop'
import { FISH } from '../fight'

/**
 * 게임 루프 상태머신 스펙.
 *
 * 캔버스 없이 IDLE→CASTING→WAITING→BITE→FIGHTING→RESULT 전체를 돌린다. 데모는 이 로직이
 * 렌더와 한 덩어리라 아무것도 테스트할 수 없었고, 그래서 "입질이 즉시 온다"거나 "챔질에
 * 타이밍이 없다" 같은 결함이 실기에서야 발견됐다.
 */

const DT = 1 / 30

/** 지정 시간만큼 tick을 돌린다 */
function run(loop: ReturnType<typeof createLoop>, sec: number, reelRate = 0) {
  for (let t = 0; t < sec; t += DT) loop.tick(DT, reelRate)
}

/** 원하는 페이즈가 될 때까지 최대 maxSec 돌린다 */
function until(loop: ReturnType<typeof createLoop>, phase: string, maxSec = 20, reelRate = 0) {
  for (let t = 0; t < maxSec; t += DT) {
    if (loop.state().phase === phase) return true
    loop.tick(DT, reelRate)
  }
  return loop.state().phase === phase
}

describe('루프 — 캐스팅 (단면도: 조준 → 착수 x)', () => {
  it('IDLE에서 던지면 CASTING으로 가고 찌가 보인다', () => {
    const loop = createLoop()
    expect(loop.state().phase).toBe('idle')
    expect(loop.state().bobber.visible).toBe(false)
    expect(loop.cast(320)).toBe(true)
    expect(loop.state().phase).toBe('casting')
    expect(loop.state().bobber.visible).toBe(true)
  })

  it('CASTING 중에는 다시 던질 수 없다 — 연타로 상태가 깨지지 않는다', () => {
    const loop = createLoop()
    loop.cast(320)
    expect(loop.cast(320)).toBe(false)
  })

  it('비행이 끝나면 수면 바로 아래에 착수하고 WAITING으로 간다', () => {
    const loop = createLoop()
    loop.cast(320)
    run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
    const s = loop.state()
    expect(s.phase).toBe('waiting')
    expect(s.bobber.y).toBe(DEFAULT_LOOP.waterY + DEFAULT_LOOP.depthMinMarginPx)
  })

  it('오른쪽으로 조준할수록 멀리, 왼쪽 끝은 앵글러 앞에 떨어진다', () => {
    const near = createLoop()
    near.cast(0)
    run(near, DEFAULT_LOOP.castFlightSec + 0.1)
    const far = createLoop()
    far.cast(DEFAULT_LOOP.width)
    run(far, DEFAULT_LOOP.castFlightSec + 0.1)
    // 단면도에서는 오른쪽이 먼 바다다(앵글러가 좌상단)
    expect(far.state().bobber.x).toBeGreaterThan(near.state().bobber.x)
    expect(near.state().bobber.x).toBe(DEFAULT_LOOP.landNearXPx)
    expect(far.state().bobber.x).toBe(DEFAULT_LOOP.width - DEFAULT_LOOP.landFarMarginPx)
  })

  it('조준 전 구간이 착수 전 구간에 선형 대응된다 — 클램프가 아니라 리매핑', () => {
    const nearX = DEFAULT_LOOP.landNearXPx
    const farX = DEFAULT_LOOP.width - DEFAULT_LOOP.landFarMarginPx
    // 화면 정중앙 조준 = 착수 범위 정중앙. 클램프 방식이면 이 등식이 깨진다
    expect(landingXFromAim(DEFAULT_LOOP, DEFAULT_LOOP.width / 2)).toBeCloseTo((nearX + farX) / 2)
    // 왼쪽 1/4 조준도 고유한 착수점을 가진다(클램프면 전부 nearX로 뭉개진다)
    expect(landingXFromAim(DEFAULT_LOOP, DEFAULT_LOOP.width / 4)).toBeGreaterThan(nearX)
  })

  it('조준이 화면 밖이면 착수 범위 안쪽으로 잘린다', () => {
    const loop = createLoop()
    loop.cast(5000)
    run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
    expect(loop.state().bobber.x).toBe(DEFAULT_LOOP.width - DEFAULT_LOOP.landFarMarginPx)
    expect(landingXFromAim(DEFAULT_LOOP, -100)).toBe(DEFAULT_LOOP.landNearXPx)
  })
})

describe('루프 — 깊이 조작 (단면도: 양손 높이 → 미끼 깊이)', () => {
  /** 물고기가 끼어들지 않게 비운다 — 깊이 이동만 본다 */
  function emptyWaiting() {
    const loop = createLoop({ ...DEFAULT_LOOP, fishCount: 0 })
    loop.cast(320)
    run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
    expect(loop.state().phase).toBe('waiting')
    return loop
  }

  it('steer로 미끼가 목표 깊이까지 내려간다', () => {
    const loop = emptyWaiting()
    loop.steer(1)
    run(loop, 3)
    expect(loop.state().bobber.y).toBe(DEFAULT_LOOP.height - DEFAULT_LOOP.depthMaxMarginPx)
  })

  it('미끼는 순간이동하지 않는다 — steerPxS 속도로 이동한다', () => {
    const loop = emptyWaiting()
    const y0 = loop.state().bobber.y
    loop.steer(1)
    loop.tick(DT, 0)
    const moved = loop.state().bobber.y - y0
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThanOrEqual(DEFAULT_LOOP.steerPxS * DT + 1e-9)
  })

  it('WAITING이 아니면 steer는 무시된다', () => {
    const loop = createLoop({ ...DEFAULT_LOOP, fishCount: 0 })
    const y0 = loop.state().bobber.y
    loop.steer(1)
    loop.tick(DT, 0)
    expect(loop.state().bobber.y).toBe(y0)
  })

  it('어종 깊이 층 — 점수가 높을수록 깊고, 스폰이 자기 층 안에 있다', () => {
    const anchovy = FISH[0]!
    const shark = FISH[FISH.length - 1]!
    expect(bandIndexOf(anchovy)).toBeLessThan(bandIndexOf(shark))

    for (let seed = 1; seed <= 20; seed++) {
      for (const f of createLoop(DEFAULT_LOOP, seed).state().fishes) {
        const band = bandYRange(DEFAULT_LOOP, bandIndexOf(f.spec))
        expect(f.y).toBeGreaterThanOrEqual(band.top)
        expect(f.y).toBeLessThanOrEqual(band.bottom)
      }
    }
  })

  /**
   * 선택·해제의 기준은 **깊이 층**이다 (실기 지적 2026-07-31: "상어를 노렸는데 딴 물고기가
   * 끝까지 따라옴"). 거리로만 판정하면 approaching 물고기가 approachPxS로 미끼를 쫓아와
   * 거리가 좁혀지므로 바닥까지 따라 내려온다 — 층을 고르는 조작이 성립하지 않는다.
   *
   * 이 불변식이 깨지면 "노린 물고기를 잡는다"는 게임의 전제가 무너진다.
   */
  it('관심을 보인 물고기는 항상 미끼와 같은 깊이 층이다', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const loop = createLoop(DEFAULT_LOOP, seed)
      loop.cast(320)
      run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
      // 얕은 층 → 깊은 층으로 옮겨 다니며 매 프레임 불변식을 확인한다
      for (const depth of [0, 0.35, 0.7, 1]) {
        loop.steer(depth)
        for (let t = 0; t < 2.5; t += DT) {
          loop.tick(DT, 0)
          const s = loop.state()
          if (s.phase !== 'waiting') break // 입질까지 갔다 — 이 시드는 여기서 끝
          if (!s.active) continue
          const { top, bottom } = bandYRange(DEFAULT_LOOP, bandIndexOf(s.active.spec))
          // 해제 히스테리시스(14px)만큼 여유를 둔다
          expect(s.bobber.y).toBeGreaterThan(top - 20)
          expect(s.bobber.y).toBeLessThan(bottom + 20)
        }
      }
    }
  })

  it('미끼를 다른 층으로 옮기면 관심을 보인 물고기가 흥미를 잃는다', () => {
    const loop = createLoop()
    loop.cast(320)
    run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
    for (let t = 0; t < 6 && !loop.state().active; t += DT) loop.tick(DT, 0)
    if (!loop.state().active) return // 이 시드에서 아무도 안 물었다 — 판정할 게 없다
    // active 물고기의 층에서 가장 먼 층으로 옮긴다
    const band = bandIndexOf(loop.state().active!.spec)
    loop.steer(band <= 1 ? 1 : 0)
    let released = false
    for (let t = 0; t < 4; t += DT) {
      loop.tick(DT, 0)
      const s = loop.state()
      if (s.phase !== 'waiting') break
      if (!s.active) {
        released = true
        break
      }
    }
    // 층 기준이므로 따라오는 속도와 무관하게 반드시 해제된다
    expect(released).toBe(true)
    for (const f of loop.state().fishes) expect(f.interest).toBe('none')
  })
})

describe('루프 — 대기와 입질 (기획: 관심 → 접근 → 입질)', () => {
  it('착수 직후 바로 입질하지 않는다 — 물고기가 다가올 시간이 있다', () => {
    const loop = createLoop()
    loop.cast(320)
    run(loop, DEFAULT_LOOP.castFlightSec + 0.1)
    expect(loop.state().phase).toBe('waiting')
    // 데모는 착수와 거의 동시에 입질했다(12마리에 초당 0.9 확률을 굴렸다) — 대기가 없었다
    run(loop, 0.2)
    expect(loop.state().phase).toBe('waiting')
  })

  it('관심을 보인 물고기가 찌로 다가와 입질한다', () => {
    const loop = createLoop()
    loop.cast(320)
    expect(until(loop, 'bite')).toBe(true)
    expect(loop.state().active).not.toBeNull()
  })

  it('입질 창을 놓치면 물고기가 도망간다 (missed)', () => {
    const loop = createLoop()
    loop.cast(320)
    until(loop, 'bite')
    run(loop, DEFAULT_LOOP.biteWindowSec + 0.2)
    expect(loop.state().phase).toBe('result')
    expect(loop.state().last?.outcome).toBe('missed')
    expect(loop.state().score).toBe(0)
  })

  it('BITE가 아니면 챔질해도 무효다', () => {
    const loop = createLoop()
    expect(loop.hook()).toBe(false)
    loop.cast(320)
    expect(loop.hook()).toBe(false)
  })

  it('아무도 관심을 안 보이면 제한 시간 뒤 찌를 회수한다', () => {
    // 물고기 0마리 — 입질이 일어날 수 없다
    const loop = createLoop({ ...DEFAULT_LOOP, fishCount: 0 })
    loop.cast(320)
    run(loop, DEFAULT_LOOP.castFlightSec + DEFAULT_LOOP.waitTimeoutSec + 0.2)
    expect(loop.state().phase).toBe('idle')
    expect(loop.state().bobber.visible).toBe(false)
  })
})

describe('루프 — 힘겨루기와 결과', () => {
  it('챔질하면 FIGHTING으로 가고, 충분히 감으면 잡아서 점수가 오른다', () => {
    const loop = createLoop()
    loop.cast(320)
    until(loop, 'bite')
    expect(loop.hook()).toBe(true)
    expect(loop.state().phase).toBe('fighting')

    const spec = loop.state().active?.spec ?? FISH[0]!
    // 어떤 어종이 걸려도 넉넉히 넘는 속도로 감는다
    run(loop, 40, 2.0)
    const s = loop.state()
    expect(['result', 'idle']).toContain(s.phase)
    expect(s.score).toBeGreaterThanOrEqual(spec.score)
    expect(s.caught.length).toBe(1)
  })

  it('안 감으면 물고기가 도망가고 점수가 없다', () => {
    const loop = createLoop()
    loop.cast(320)
    until(loop, 'bite')
    loop.hook()
    run(loop, 20, 0)
    expect(loop.state().last?.outcome ?? loop.state().phase).not.toBe('caught')
    expect(loop.state().score).toBe(0)
  })

  it('RESULT가 지나면 IDLE로 돌아가 다시 던질 수 있다', () => {
    const loop = createLoop()
    loop.cast(320)
    until(loop, 'bite')
    loop.hook()
    run(loop, 40, 2.0)
    expect(until(loop, 'idle', 5, 2.0)).toBe(true)
    expect(loop.cast(320)).toBe(true)
  })

  it('힘겨루기 중 유예가 지나고 안 감으면 진행도가 줄어든다', () => {
    const loop = createLoop()
    loop.cast(320)
    until(loop, 'bite')
    loop.hook()
    run(loop, 0.3, 5)
    const high = loop.state().progress
    run(loop, 3, 0)
    expect(loop.state().progress).toBeLessThan(high)
  })
})

describe('루프 — 결정론 (멀티플레이 대비)', () => {
  /**
   * 기획 §게임 화면 구성: "바다는 두 플레이어가 동일한 맵 사용".
   * 서버 시드를 내려주면 각 클라가 같은 물고기를 재생해야 하므로, 같은 시드는 같은 결과여야 한다.
   */
  it('같은 시드는 같은 물고기 배치를 만든다', () => {
    const a = createLoop(DEFAULT_LOOP, 42)
    const b = createLoop(DEFAULT_LOOP, 42)
    const key = (l: ReturnType<typeof createLoop>) =>
      l.state().fishes.map((f) => `${f.spec.name}@${f.x.toFixed(2)},${f.y.toFixed(2)},${f.dir}`)
    expect(key(a)).toEqual(key(b))
  })

  it('다른 시드는 다른 배치를 만든다', () => {
    const a = createLoop(DEFAULT_LOOP, 1)
    const b = createLoop(DEFAULT_LOOP, 999)
    const key = (l: ReturnType<typeof createLoop>) =>
      l.state().fishes.map((f) => `${f.spec.name}@${f.x.toFixed(2)}`)
    expect(key(a)).not.toEqual(key(b))
  })

  it('seededRng이 같은 시드에서 같은 수열을 낸다', () => {
    const a = seededRng(7)
    const b = seededRng(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('루프 — 희귀도 (기획 §희귀도)', () => {
  it('작은 물고기가 큰 물고기보다 자주 나온다', () => {
    const counts = new Map<string, number>()
    for (let seed = 1; seed <= 60; seed++) {
      for (const f of createLoop(DEFAULT_LOOP, seed).state().fishes) {
        counts.set(f.spec.name, (counts.get(f.spec.name) ?? 0) + 1)
      }
    }
    // 이름이 아니라 점수로 집는다 — 어종 이름이 바뀌어도(스프라이트에 맞춘 개명) 이 규칙은 같다
    const cheapest = FISH.reduce((a, b) => (a.score <= b.score ? a : b))
    const priciest = FISH.reduce((a, b) => (a.score >= b.score ? a : b))
    expect(counts.get(cheapest.name) ?? 0).toBeGreaterThan(counts.get(priciest.name) ?? 0)
  })
})
