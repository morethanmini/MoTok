import { describe, it, expect } from 'vitest'
import { createCast, DEFAULT_CAST, type CastSample } from '../cast'

/**
 * 캐스팅 판정 스펙.
 *
 * 2026-07-29 실기에서 고친 세 가지를 각각 고정한다:
 *  ① 속도만 보면 어깨 근처에 손을 두고 있어도 저절로 던져졌다 → 최소 낙하 거리 AND 조건
 *  ② 조준을 젖힌 순간에 고정하니 "던지는 대로 안 던져지는 느낌" → armed 동안 손을 따라간다
 *  ③ 거리 = **스윙 최고 속도**. 문턱 넘는 순간 발사하면 상승 구간을 재게 되어 세기 구분이
 *    사라진다는 걸 뒤늦게 알았다 — releasing 페이즈에서 피크를 관찰한 뒤 쏜다
 */

const DT = 1000 / 30
const SHOULDER_Y = 300
const EMPTY: CastSample = {
  phase: 'idle',
  aimX: null,
  fired: null,
  firedAimX: 0,
  downVelPxS: 0,
  dropPx: 0,
}

/** 어깨 위 rise px 위치의 손목 y */
const yAtRise = (rise: number) => SHOULDER_Y - rise
const DOWN_Y = SHOULDER_Y + 60
/** 젖힘 성립 높이(파워 중간쯤) */
const UP_RISE = 80

function run(frames: { x: number; y: number }[]) {
  const cast = createCast()
  let last: CastSample = EMPTY
  const fires: { aimX: number; power: number }[] = []
  frames.forEach((f, i) => {
    last = cast.feed(f.x, f.y, SHOULDER_Y, i * DT)
    if (last.fired !== null) fires.push({ aimX: last.firedAimX, power: last.fired })
  })
  return { last, fires }
}

const HOLD_FRAMES = Math.ceil(DEFAULT_CAST.holdMs / DT) + 2
const hold = (x = 420, rise = UP_RISE) =>
  Array.from({ length: HOLD_FRAMES }, () => ({ x, y: yAtRise(rise) }))
/**
 * step px씩 n프레임 내려꽂고, 그 뒤 정지 프레임을 붙인다.
 * releasing 페이즈가 스윙 피크를 관찰한 뒤 발사하므로 감속 구간이 필요하다.
 */
const swing = (x: number, rise: number, step: number, n = 4) => {
  const down = Array.from({ length: n }, (_, i) => ({ x, y: yAtRise(rise) + (i + 1) * step }))
  const restY = down[down.length - 1]!.y
  return [...down, ...Array.from({ length: 8 }, () => ({ x, y: restY }))]
}

describe('캐스팅 — 2단 모션', () => {
  it('손목이 어깨 아래면 대기 상태', () => {
    const { last } = run(Array.from({ length: 10 }, () => ({ x: 300, y: DOWN_Y })))
    expect(last.phase).toBe('idle')
    expect(last.aimX).toBeNull()
  })

  it('어깨 위로 올려 유지하면 조준이 잠긴다', () => {
    const { last } = run(hold())
    expect(last.phase).toBe('armed')
    expect(last.aimX).not.toBeNull()
  })

  it('유지 시간을 못 채우고 내리면 발사되지 않는다', () => {
    const { fires } = run([
      { x: 420, y: yAtRise(UP_RISE) },
      { x: 420, y: yAtRise(UP_RISE) },
      ...Array.from({ length: 5 }, () => ({ x: 420, y: DOWN_Y })),
    ])
    expect(fires).toHaveLength(0)
  })

  it('빠르고 충분히 깊게 내려꽂으면 발사된다', () => {
    const { fires } = run([...hold(), ...swing(420, UP_RISE, 70)])
    expect(fires).toHaveLength(1)
  })

  it('한 번의 스윙으로 두 번 발사되지 않는다', () => {
    const { fires } = run([...hold(), ...swing(420, UP_RISE, 70, 8)])
    expect(fires).toHaveLength(1)
  })
})

describe('캐스팅 — 오발 방지 (① 속도 AND 거리)', () => {
  /**
   * 실기: "손을 어깨에 애매하게 위치하고 있으면 찌도 저절로 던져진다."
   * 속도 문턱(700px/s)만 걸면 80ms 창에서 56px만 움직여도 넘는다 — 거리 조건이 필요하다.
   */
  it('빠르지만 짧은 흔들림은 발사되지 않는다 — 실기에서 저절로 던져진 경로', () => {
    // 프레임당 45px = 1350px/s (속도 문턱 통과) 이지만 총 낙하 90px < 110px
    const { fires } = run([...hold(), ...swing(420, UP_RISE, 45, 2)])
    expect(fires).toHaveLength(0)
  })

  it('깊지만 느리게 내리면 발사되지 않는다', () => {
    const slow = Array.from({ length: 30 }, (_, i) => ({ x: 420, y: yAtRise(UP_RISE) + i * 8 }))
    expect(run([...hold(), ...slow]).fires).toHaveLength(0)
  })

  it('젖히지 않고 손만 빠르게 내려도 발사되지 않는다', () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ x: 300, y: DOWN_Y + i * 70 }))
    expect(run(frames).fires).toHaveLength(0)
  })

  it('어깨 경계에서 미세하게 떨어도 발사되지 않는다 — 히스테리시스', () => {
    const jitter = Array.from({ length: 90 }, (_, i) => ({
      x: 400,
      y: yAtRise(DEFAULT_CAST.raiseMarginPx + (i % 2 === 0 ? 3 : -3)),
    }))
    expect(run(jitter).fires).toHaveLength(0)
  })

  it('손을 천천히 어깨 아래로 내리면 조준이 풀린다 — 취소 경로', () => {
    const { last } = run([...hold(), ...Array.from({ length: 5 }, () => ({ x: 420, y: DOWN_Y }))])
    expect(last.phase).toBe('idle')
    expect(last.aimX).toBeNull()
  })
})

describe('캐스팅 — 조준 (② 손을 따라간다)', () => {
  it('armed 동안 손을 좌우로 옮기면 조준도 따라간다', () => {
    const cast = createCast()
    let t = 0
    const feed = (x: number, rise = UP_RISE) => cast.feed(x, yAtRise(rise), SHOULDER_Y, t++ * DT)
    for (let i = 0; i < HOLD_FRAMES; i++) feed(420)
    const first = cast.feed(420, yAtRise(UP_RISE), SHOULDER_Y, t++ * DT).aimX
    // 손을 왼쪽으로 옮기고 지연 시간 이상 유지
    const lagFrames = Math.ceil(DEFAULT_CAST.aimLagMs / DT) + 3
    let moved: number | null = null
    for (let i = 0; i < lagFrames; i++) moved = feed(150).aimX
    expect(first).toBeCloseTo(420, 0)
    expect(moved).toBeCloseTo(150, 0)
  })

  it('발사 조준은 내려꽂기 이전 위치를 쓴다 — 스윙 중 흔들림이 섞이지 않는다', () => {
    const lagFrames = Math.ceil(DEFAULT_CAST.aimLagMs / DT) + 2
    const frames = [
      ...hold(),
      // 조준을 200에 두고 충분히 유지
      ...Array.from({ length: lagFrames }, () => ({ x: 200, y: yAtRise(UP_RISE) })),
      // 내려꽂으며 x가 크게 흔들린다
      ...swing(600, UP_RISE, 70).map((f, i) => ({ ...f, x: 600 + i * 40 })),
    ]
    const { fires } = run(frames)
    expect(fires).toHaveLength(1)
    // 600 근처가 아니라 200 근처여야 한다
    expect(fires[0]!.aimX).toBeLessThan(400)
  })
})

describe('캐스팅 — 거리 (③ 스윙 최고 속도)', () => {
  it('세게 내려꽂으면 거리가 크다', () => {
    const soft = run([...hold(), ...swing(420, UP_RISE, 40, 6)])
    const hard = run([...hold(), ...swing(420, UP_RISE, 100, 6)])
    expect(soft.fires).toHaveLength(1)
    expect(hard.fires).toHaveLength(1)
    expect(hard.fires[0]!.power).toBeGreaterThan(soft.fires[0]!.power)
  })

  /**
   * 이 테스트가 이번 수정의 핵심이다. 문턱을 넘는 순간 발사하면 측정값이 항상 문턱 근처로
   * 눌려서(스윙의 상승 구간) 세기 구분이 사라진다 — 실기에서 "범위 1.7배"로 보인 원인이었다.
   * releasing 페이즈가 피크를 기다리므로 강약 차이가 실제로 벌어져야 한다.
   */
  it('강·약 거리 차이가 0.3 이상 벌어진다 — 문턱 근처로 눌리지 않는다', () => {
    const soft = run([...hold(), ...swing(420, UP_RISE, 40, 6)]).fires[0]!.power
    const hard = run([...hold(), ...swing(420, UP_RISE, 110, 6)]).fires[0]!.power
    expect(hard - soft).toBeGreaterThan(0.3)
  })

  it('거리는 0~1 범위를 벗어나지 않는다', () => {
    const insane = run([...hold(), ...swing(420, UP_RISE, 300, 6)])
    expect(insane.fires[0]!.power).toBeLessThanOrEqual(1)
    expect(insane.fires[0]!.power).toBeGreaterThanOrEqual(0)
  })
})

describe('캐스팅 — 상태 관리', () => {
  it('reset이 상태를 되돌린다', () => {
    const cast = createCast()
    for (let i = 0; i < HOLD_FRAMES; i++) cast.feed(420, yAtRise(UP_RISE), SHOULDER_Y, i * DT)
    cast.reset()
    const s = cast.feed(420, yAtRise(UP_RISE), SHOULDER_Y, 9999)
    expect(s.phase).toBe('raising')
    expect(s.aimX).toBeNull()
  })
})
