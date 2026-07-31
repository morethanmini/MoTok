import { describe, it, expect } from 'vitest'
import { createCast, DEFAULT_CAST, type CastSample } from '../cast'

/**
 * 캐스팅 판정 스펙 — 양손 중점 + 낙하 거리 파워.
 *
 * 2026-07-30 실측(강 12회 / 약 9회)이 이전 설계를 뒤집었다. 그 결론들을 고정한다:
 *  ① 파워는 **낙하 거리**다. 최고 속도는 강·약이 겹쳤고(강 ×6.49/s < 약 ×7.53/s인 사례가
 *     실제로 나왔다), 낙하 거리는 갭 33%로 완전히 갈렸다.
 *  ② 백스윙 없는 하향은 던짐이 아니다 — 세션마다 "끝나고 팔 내리기"가 1건씩 기록됐다.
 *  ③ 어깨선·유지 시간 조건은 없다. 판정기가 어깨 y를 아예 받지 않는다.
 *  ④ 문턱은 전부 어깨너비 배수라 카메라 거리에 안 흔들린다.
 */

const DT = 1000 / 30
/** 실측 어깨너비 대역(148~206px)의 중간 */
const SW = 165
/** 손을 내린 기준 위치 */
const REST_Y = 400

const EMPTY: CastSample = {
  phase: 'idle',
  aimX: null,
  fired: null,
  firedAimX: 0,
  riseSw: 0,
  dropSw: 0,
  velSw: 0,
}

/**
 * reset 직후 정착 구간(settleMs)이 지나가는 데 필요한 대기 프레임 수.
 * 이 구간에는 백스윙 기준점이 계속 갱신되므로 판정이 일어나지 않는다.
 */
const LEAD = Math.ceil(DEFAULT_CAST.settleMs / DT) + 4

/**
 * 던지는 동작 한 번.
 *
 * @param rise       백스윙 상승(px)
 * @param drop       포워드 낙하(px) — 파워의 원본값
 * @param downFrames 낙하에 쓰는 프레임 수. 적으면 빠른 스윙, 많으면 느린 스윙.
 *                   **속도와 거리를 따로 만들 수 있어야** ①을 검증할 수 있다.
 *
 * 생략하면 **속도가 실측대(약 ×10/s)로 고정되도록 깊이에서 역산한다.**
 *
 * 고정 프레임 수를 쓰면 얕은 던짐이 자동으로 느려져서(낙하 ×0.46을 3프레임에 = ×4.6/s) 스윙
 * 시작 게이트 아래로 떨어진다. 그러면 "파워 하한"을 테스트하려던 게 "게이트를 못 넘는다"를
 * 테스트하는 것으로 바뀐다. 실측 던짐은 깊이와 무관하게 전부 ×10.5~13.1/s였다(2026-07-30).
 */
function makeThrow(opts: {
  rise: number
  drop: number
  downFrames?: number
  x?: number
  xDuringDrop?: number
}) {
  const {
    rise,
    drop,
    downFrames = Math.max(1, Math.round(drop / (SW * 0.33))),
    x = 320,
    xDuringDrop,
  } = opts
  const out: { x: number; y: number }[] = []
  // 내린 자세 — 정착 구간을 지나고 상승 거리의 기준점(restY)을 만든다
  for (let i = 0; i < LEAD; i++) out.push({ x, y: REST_Y })
  // 백스윙
  const upFrames = Math.max(3, Math.ceil(rise / 20))
  for (let i = 1; i <= upFrames; i++) out.push({ x, y: REST_Y - (rise * i) / upFrames })
  const topY = REST_Y - rise
  // 정점 유지 — minBackMs(200ms)보다 넉넉히 길게 둔다. 실측 조준→스윙 간격은 1000ms 이상이었다
  for (let i = 0; i < 6; i++) out.push({ x, y: topY })
  // 포워드 스윙
  const dx = xDuringDrop ?? x
  for (let i = 1; i <= downFrames; i++) out.push({ x: dx, y: topY + (drop * i) / downFrames })
  /*
   * 팔로스루 반동 — 실제 팔은 최저점을 찍고 조금 되올라온다.
   *
   * 판정 종료가 이 반동을 본다(`endBackSw`). 예전 픽스처는 최저점에서 위치를 그대로 유지했는데,
   * 그건 속도 기반 종료에만 맞는 모양이었다. 낙하는 최저점 기준이라 반동이 값을 줄이지 않는다.
   */
  const bottom = topY + drop
  const rebound = Math.max(0.09 * SW, drop * 0.08)
  for (let i = 1; i <= 3; i++) out.push({ x: dx, y: bottom - (rebound * i) / 3 })
  for (let i = 0; i < 10; i++) out.push({ x: dx, y: bottom - rebound })
  return out
}

function run(frames: { x: number; y: number }[], sw = SW) {
  const cast = createCast()
  let last: CastSample = EMPTY
  const fires: { aimX: number; power: number }[] = []
  frames.forEach((f, i) => {
    last = cast.feed(f.x, f.y, sw, i * DT)
    if (last.fired !== null) fires.push({ aimX: last.firedAimX, power: last.fired })
  })
  return { last, fires }
}

/** 실측 대역(최저점 기준 재측정): 강 상승 ×0.80~1.78 / 최대낙하 ×1.28~1.92 */
const strong = (dropSw: number, downFrames?: number) =>
  makeThrow({ rise: 1.4 * SW, drop: dropSw * SW, downFrames })
/** 실측 대역(최저점 기준 재측정): 약 상승 ×0.38~1.04 / 최대낙하 ×0.64~1.22 */
const weak = (dropSw: number, downFrames?: number) =>
  makeThrow({ rise: 0.72 * SW, drop: dropSw * SW, downFrames })

describe('캐스팅 — 던짐 성립', () => {
  it('백스윙 후 내려꽂으면 발사된다', () => {
    const { fires } = run(strong(1.0))
    expect(fires).toHaveLength(1)
    expect(fires[0]!.power).toBeGreaterThan(0)
  })

  it('손을 내리고만 있으면 대기 상태다', () => {
    const { last } = run(Array.from({ length: 20 }, () => ({ x: 320, y: REST_Y })))
    expect(last.phase).toBe('idle')
    expect(last.aimX).toBeNull()
  })

  it('백스윙을 올리면 조준이 뜬다 — 자세 유지 없이 즉시', () => {
    // 백스윙 정점까지만 먹인다
    const up = makeThrow({ rise: 0.9 * SW, drop: 0, downFrames: 1 })
    const { last } = run(up.slice(0, LEAD + 8))
    expect(last.phase).toBe('back')
    expect(last.aimX).not.toBeNull()
  })

  it('한 번의 스윙으로 두 번 발사되지 않는다', () => {
    expect(run(strong(1.1)).fires).toHaveLength(1)
  })

  /**
   * 실기 지적(2026-07-31): "무효 던짐 뒤 다시 던지려고 손을 올리는 순간 대가 발사된다."
   *
   * 올리는 동안 랜드마크가 한 프레임 아래로 튀면 velSw가 순간적으로 치솟아 forward로 넘어가고,
   * 그 튐이 그대로 낙하로 측정돼 발사됐다. 튐은 다음 프레임에 원위치하므로 `holdBelowPeakSw`
   * (발사 시점에 손이 최고점 아래에 남아 있어야 한다)가 이 경로를 자른다.
   */
  it('올리는 중 한 프레임 튐은 발사되지 않는다', () => {
    const frames: { x: number; y: number }[] = []
    for (let i = 0; i < LEAD; i++) frames.push({ x: 320, y: REST_Y })
    // 손을 올린다 — 백스윙 게이트를 넘어 back에 들어간다
    const top = REST_Y - 1.2 * SW
    for (let i = 1; i <= 24; i++) frames.push({ x: 320, y: REST_Y - (1.2 * SW * i) / 24 })
    // 올린 자리에서 유지 — minBackMs 만료
    for (let i = 0; i < 10; i++) frames.push({ x: 320, y: top })
    // ★ 한 프레임만 크게 아래로 튄다(0.8sw) — 낙하 문턱(0.45)을 훌쩍 넘는 크기
    frames.push({ x: 320, y: top + 0.8 * SW })
    // 곧바로 원위치 — 진짜 던짐이면 손이 아래에 남아 있어야 한다
    for (let i = 0; i < 20; i++) frames.push({ x: 320, y: top })

    expect(run(frames).fires).toHaveLength(0)
  })

  it('연속 두 번 던지면 두 번 발사된다 — 두 번째 상승이 첫 스윙에 오염되지 않는다', () => {
    const { fires } = run([...strong(1.0), ...strong(1.0)])
    expect(fires).toHaveLength(2)
    // 같은 동작이면 같은 파워여야 한다. 첫 낙하가 두 번째 기준점에 섞이면 값이 튄다
    expect(Math.abs(fires[0]!.power - fires[1]!.power)).toBeLessThan(0.15)
  })
})

describe('캐스팅 — 오발 방지 (② 백스윙 없는 하향은 던짐이 아니다)', () => {
  it('백스윙 없이 팔만 빠르게 내리면 발사되지 않는다 — 실측에서 매 세션 1건씩 기록된 경로', () => {
    // 상승 ×0.12뿐인데 낙하는 ×1.2 — 실측 아티팩트(상승 27px / 낙하 160px)의 재현
    const startY = REST_Y - 20
    const frames: { x: number; y: number }[] = []
    for (let i = 0; i < LEAD; i++) frames.push({ x: 320, y: startY })
    // 3프레임 = 실측 던짐 속도대. 스윙 시작 게이트는 넘고 백스윙 조건에서 걸려야 한다
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: startY + (1.2 * SW * i) / 3 })
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: startY + 1.2 * SW - (0.1 * SW * i) / 3 })
    for (let i = 0; i < 10; i++) frames.push({ x: 320, y: startY + 1.2 * SW - 0.1 * SW })
    expect(run(frames).fires).toHaveLength(0)
  })

  it('백스윙은 했지만 낙하가 문턱 미만이면 발사되지 않는다', () => {
    // 낙하 ×0.3 < dropMinSw ×0.45. 1프레임 = ×9/s로 시작 게이트는 넘고 낙하에서 걸린다
    expect(run(strong(0.3, 1)).fires).toHaveLength(0)
  })

  it('백스윙만 하고 가만히 있으면 발사되지 않는다', () => {
    const up = makeThrow({ rise: 1.0 * SW, drop: 0, downFrames: 1 })
    const hold = Array.from({ length: 20 }, () => ({ x: 320, y: REST_Y - SW }))
    expect(run([...up.slice(0, LEAD + 8), ...hold]).fires).toHaveLength(0)
  })

  it('조준과 스윙이 같은 프레임이면 발사되지 않는다 — 문턱 경계 잡음', () => {
    /*
     * 실기 무효 1건의 재현(2026-07-30): `조준 시작 ×0.30` → 같은 프레임 `스윙 시작 ×0.30`
     * → `무효 낙하 ×0.05`. 게이트를 간신히 넘은 순간 곧바로 하향으로 뒤집히는 잡음이다.
     * 성공한 던짐 6회는 전부 조준→스윙이 1000ms 이상이었다.
     */
    const frames: { x: number; y: number }[] = []
    for (let i = 0; i < LEAD; i++) frames.push({ x: 320, y: REST_Y })
    // 게이트(×0.3)를 한 프레임에 넘기고 곧바로 급하강
    frames.push({ x: 320, y: REST_Y - 0.32 * SW })
    const top = REST_Y - 0.32 * SW
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: top + (1.2 * SW * i) / 3 })
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: top + 1.2 * SW - (0.1 * SW * i) / 3 })
    for (let i = 0; i < 10; i++) frames.push({ x: 320, y: top + 1.2 * SW - 0.1 * SW })
    expect(run(frames).fires).toHaveLength(0)
  })

  it('어깨 너비를 모르면 판정하지 않는다 — px 문턱으로 되돌아가지 않는다', () => {
    const { last, fires } = run(strong(1.2), 0)
    expect(fires).toHaveLength(0)
    expect(last.phase).toBe('idle')
  })
})

describe('캐스팅 — 파워 (① 최고 속도가 아니라 낙하 거리)', () => {
  it('깊게 던지면 파워가 크다', () => {
    expect(run(strong(1.25)).fires[0]!.power).toBeGreaterThan(run(weak(0.55)).fires[0]!.power)
  })

  it('실측 강·약 대역이 확실히 갈린다 — 겹치지 않는다', () => {
    /*
     * 최저점 기준으로 재측정한 대역(2026-07-30 후반, 강 6회 / 약 10회):
     *   약 최대낙하 ×0.64~1.22 / 강 최대낙하 ×1.28~1.92 — 갭 4.9%
     * dropFullSw 1.9에서 경계가 0.55에 떨어진다. 1.3이었을 때는 약 ×1.22가 파워 0.91까지
     * 올라가서 "약하게 던져도 멀리 간다"가 됐다.
     */
    const weakPowers = [0.64, 0.78, 1.22].map((d) => run(weak(d)).fires[0]!.power)
    const strongPowers = [1.28, 1.5, 1.92].map((d) => run(strong(d)).fires[0]!.power)
    expect(Math.max(...weakPowers)).toBeLessThan(0.55)
    expect(Math.min(...strongPowers)).toBeGreaterThan(0.55)
    expect(Math.min(...strongPowers)).toBeGreaterThan(Math.max(...weakPowers))
  })

  it('느리지만 깊은 스윙이 빠르지만 얕은 스윙보다 파워가 크다 — 이 설계 변경의 요점', () => {
    /*
     * 실측에서 속도가 유저 의도를 뒤집어 읽은 사례(강 ×6.49/s < 약 ×7.53/s)의 재현.
     * downFrames가 많을수록 느린 스윙이다.
     *
     * 두 스윙 모두 시작 게이트(startVelSw ×5.0) 위에 둔다 — 느린 쪽 ×6.0/s, 빠른 쪽 ×8.3/s.
     * 예전에는 느린 쪽을 12프레임(×3.0/s)으로 잡았는데, 그건 게이트 아래라 "느려서 파워가
     * 낮다"가 아니라 "던짐으로 인정되지 않는다"를 테스트하게 된다. 검증하려는 건 전자다.
     */
    const slowDeep = run(strong(1.2, 6))
    const fastShallow = run(weak(0.55, 2))
    expect(slowDeep.fires).toHaveLength(1)
    expect(fastShallow.fires).toHaveLength(1)
    expect(slowDeep.fires[0]!.power).toBeGreaterThan(fastShallow.fires[0]!.power)
  })

  it('파워는 0~1 범위를 벗어나지 않는다', () => {
    for (const dropSw of [0.46, 0.8, 1.3, 2.5]) {
      const p = run(strong(dropSw)).fires[0]!.power
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('카메라 거리가 바뀌어도 같은 동작이면 같은 파워다 — 정규화 회귀', () => {
    // 어깨너비 204px(가까이) vs 123px(멀리) — 2026-07-30 실측 두 거리.
    // 실측에서 동작 크기가 어깨너비에 비례해 줄었다(1.67배 vs 1.72배).
    const powerAt = (sw: number) => {
      const cast = createCast()
      let power: number | null = null
      makeThrow({ rise: 0.9 * sw, drop: 1.1 * sw }).forEach((f, i) => {
        const s = cast.feed(f.x, f.y, sw, i * DT)
        if (s.fired !== null) power = s.fired
      })
      return power
    }
    const near = powerAt(204)
    const far = powerAt(123)
    expect(near).not.toBeNull()
    expect(far).not.toBeNull()
    expect(Math.abs(near! - far!)).toBeLessThan(0.1)
  })
})

describe('캐스팅 — 조준', () => {
  it('백스윙 동안 손을 좌우로 옮기면 조준도 따라간다', () => {
    const cast = createCast()
    let t = 0
    const feed = (x: number, y: number) => cast.feed(x, y, SW, (t++ * 1000) / 30)
    for (let i = 0; i < LEAD; i++) feed(200, REST_Y)
    for (let i = 1; i <= 8; i++) feed(200, REST_Y - (0.9 * SW * i) / 8)
    // 정점에서 오른쪽으로 이동 — aimLagMs(150ms)보다 충분히 길게 유지한다
    let last = feed(200, REST_Y - 0.9 * SW)
    for (let i = 0; i < 12; i++) last = feed(520, REST_Y - 0.9 * SW)
    expect(last.phase).toBe('back')
    expect(last.aimX).toBeGreaterThan(400)
  })

  it('발사 조준은 내려꽂기 이전 위치를 쓴다 — 스윙 중 흔들림이 섞이지 않는다', () => {
    const { fires } = run(
      makeThrow({ rise: 0.9 * SW, drop: 1.1 * SW, x: 250, xDuringDrop: 560 }),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0]!.aimX).toBeLessThan(400)
  })
})

describe('캐스팅 — 잡은 직후 재던지기 (정착 구간)', () => {
  /**
   * 실기 버그(2026-07-30): 물고기를 잡은 직후 손은 릴을 감던 높이(위)에 있는데, 그 순간
   * 백스윙 기준점이 박혀서 거기서 또 riseGateSw만큼 더 올려야 조준이 걸렸다. 손을 한 번
   * 내리면 기준점이 따라 내려가 되는 바람에 "어깨 아래→위로 가야 한다"는 오해도 만들었다.
   */
  it('잡은 직후 손이 올라가 있으면 내리지 않고도 조준된다 — 이 버그의 회귀', () => {
    /*
     * 실기 증상(2026-07-30): ① 릴 감기로 손이 어깨 라인 → ② 그대로 젖혀도 작동 안 함
     * → ③ 어깨 아래로 내렸다 올려야 작동. 원인은 reset이 백스윙 기준점(restY)을 버려서
     * 릴 감던 높이가 새 기준이 된 것이었다. 기준점을 유지하면 ②에서 바로 조준돼야 한다.
     */
    const cast = createCast()
    let t = 0
    const feed = (y: number) => cast.feed(320, y, SW, (t++ * 1000) / 30)
    // 던지기 전 쉬는 높이를 기준점으로 만든다
    for (let i = 0; i < LEAD; i++) feed(REST_Y)
    // 힘겨루기 → 결과 → IDLE 전환. 게임은 이때 reset을 호출한다
    cast.reset()
    // 손은 릴을 감던 높이(어깨 라인)에 그대로 있다. 내리지 않는다
    const SHOULDER_LINE = REST_Y - 0.6 * SW
    let last = feed(SHOULDER_LINE)
    for (let i = 0; i < LEAD; i++) last = feed(SHOULDER_LINE)
    expect(last.phase).toBe('back')
    expect(last.aimX).not.toBeNull()
  })

  it('reset 후에도 파워가 부풀지 않는다 — 이전 백스윙 최고점이 낙하 기준으로 남지 않는다', () => {
    const cast = createCast()
    let t = 0
    const feed = (y: number) => cast.feed(320, y, SW, (t++ * 1000) / 30)
    // 높이 젖혔다가 그 상태로 페이즈가 바뀐다
    for (let i = 0; i < LEAD; i++) feed(REST_Y)
    for (let i = 1; i <= 8; i++) feed(REST_Y - (1.4 * SW * i) / 8)
    cast.reset()
    // 어깨 라인에서 약하게(낙하 ×0.6) 던진다 — 파워가 1.0이 되면 이전 최고점이 남은 것이다
    const START = REST_Y - 0.6 * SW
    for (let i = 0; i < LEAD; i++) feed(START)
    for (let i = 0; i < 6; i++) feed(START)
    let power: number | null = null
    // 2프레임 = ×9/s. 실측 속도대라 시작 게이트를 넘는다
    for (let i = 1; i <= 2; i++) {
      const s = feed(START + (0.6 * SW * i) / 2)
      if (s.fired !== null) power = s.fired
    }
    // 팔로스루 반동 — 판정 종료가 이걸 본다
    for (let i = 1; i <= 3; i++) {
      const s = feed(START + 0.6 * SW - (0.1 * SW * i) / 3)
      if (s.fired !== null) power = s.fired
    }
    for (let i = 0; i < 10; i++) {
      const s = feed(START + 0.6 * SW - 0.1 * SW)
      if (s.fired !== null) power = s.fired
    }
    expect(power).not.toBeNull()
    expect(power!).toBeLessThan(0.5)
  })

  it('손이 올라간 상태에서 시작해도, 내렸다 젖히면 정상 조준된다', () => {
    const HIGH = REST_Y - 1.0 * SW
    const frames: { x: number; y: number }[] = []
    // 릴 감던 높이에서 IDLE 진입 — 정착 구간이 이 위치를 기준으로 삼지 않게 해야 한다
    for (let i = 0; i < LEAD; i++) frames.push({ x: 320, y: HIGH })
    // 손을 내린다 → 기준점이 여기로
    for (let i = 1; i <= 8; i++) frames.push({ x: 320, y: HIGH + (1.0 * SW * i) / 8 })
    for (let i = 0; i < 6; i++) frames.push({ x: 320, y: REST_Y })
    // 젖히고 던진다
    for (let i = 1; i <= 8; i++) frames.push({ x: 320, y: REST_Y - (0.9 * SW * i) / 8 })
    for (let i = 0; i < 6; i++) frames.push({ x: 320, y: REST_Y - 0.9 * SW })
    // 강한 던짐 대역(최대낙하 ×1.5)으로 던진다 — 파워가 강 구간에 들어와야 한다
    const top = REST_Y - 0.9 * SW
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: top + (1.5 * SW * i) / 3 })
    for (let i = 1; i <= 3; i++) frames.push({ x: 320, y: top + 1.5 * SW - (0.1 * SW * i) / 3 })
    for (let i = 0; i < 10; i++) frames.push({ x: 320, y: top + 1.5 * SW - 0.1 * SW })
    const { fires } = run(frames)
    expect(fires).toHaveLength(1)
    expect(fires[0]!.power).toBeGreaterThan(0.5)
  })

  it('정착 구간 안에서는 완전한 던짐 동작도 발사되지 않는다', () => {
    // 정착 구간(700ms)보다 짧은 리드로 던진다 — 릴 감기 잔여 동작이 여기 해당한다
    const frames: { x: number; y: number }[] = []
    for (let i = 0; i < 3; i++) frames.push({ x: 320, y: REST_Y })
    for (let i = 1; i <= 6; i++) frames.push({ x: 320, y: REST_Y - (0.9 * SW * i) / 6 })
    for (let i = 1; i <= 6; i++)
      frames.push({ x: 320, y: REST_Y - 0.9 * SW + (1.2 * SW * i) / 6 })
    for (let i = 0; i < 4; i++) frames.push({ x: 320, y: REST_Y - 0.9 * SW + 1.2 * SW })
    // 총 19프레임 = 633ms < settleMs 700ms
    expect(frames.length * DT).toBeLessThan(DEFAULT_CAST.settleMs)
    expect(run(frames).fires).toHaveLength(0)
  })

  it('reset하면 정착 구간이 다시 시작된다 — 페이즈 전환마다 기준점을 새로 잡는다', () => {
    const cast = createCast()
    let t = 0
    const feed = (x: number, y: number) => cast.feed(x, y, SW, (t++ * 1000) / 30)
    // 한 번 던져서 정착을 끝내둔다
    strong(1.0).forEach((f) => feed(f.x, f.y))
    cast.reset()
    // reset 직후 곧바로 완전한 던짐 동작 — 정착 구간이 막아야 한다
    let fired = false
    for (let i = 0; i < 3; i++) feed(320, REST_Y)
    for (let i = 1; i <= 6; i++) feed(320, REST_Y - (0.9 * SW * i) / 6)
    for (let i = 1; i <= 6; i++) {
      const s = feed(320, REST_Y - 0.9 * SW + (1.2 * SW * i) / 6)
      if (s.fired !== null) fired = true
    }
    expect(fired).toBe(false)
  })
})

describe('캐스팅 — 상태 관리', () => {
  it('reset이 상태를 되돌린다', () => {
    const cast = createCast()
    strong(1.1)
      .slice(0, 12)
      .forEach((f, i) => cast.feed(f.x, f.y, SW, i * DT))
    cast.reset()
    const after = cast.feed(320, REST_Y, SW, 10_000)
    expect(after.phase).toBe('idle')
    expect(after.riseSw).toBe(0)
  })

  it('기본 설정의 문턱이 실측 대역 안에 있다', () => {
    // 약 낙하 하한 ×0.52보다 문턱이 낮아야 약한 던짐이 살아난다
    expect(DEFAULT_CAST.dropMinSw).toBeLessThan(0.52)
    // 강 낙하 상한 ×1.28에서 파워가 1.0에 닿아야 상단이 포화되지 않는다
    expect(DEFAULT_CAST.dropFullSw).toBeGreaterThanOrEqual(1.28)
    // 백스윙 게이트는 약한 던짐 상승 하한 ×0.34보다 낮아야 한다
    expect(DEFAULT_CAST.riseGateSw).toBeLessThan(0.34)
  })
})
