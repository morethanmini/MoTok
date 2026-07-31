import { describe, it, expect } from 'vitest'
import { createReel, DEFAULT_REEL, type ReelConfig, type ReelSample } from '../reel'

/**
 * 게임⑤ 낚시 릴 감기 판정 스펙.
 *
 * 핵심은 ④⑤ — "좌우로 흔들기만 해도 감긴다"가 데모의 치팅 경로였고, 이 판정기의
 * 존재 이유가 그걸 막는 것이다. 그 두 개가 깨지면 판정 방식을 다시 설계해야 한다.
 */

const TAU = Math.PI * 2
const CX = 320
const CY = 240
const R = 90

interface TraceOpts {
  revs: number
  revPerSec: number
  fps: number
  radius?: number
  dir?: 1 | -1
  config?: ReelConfig
}

/** 원 궤도를 dir 방향으로 revs 바퀴 돌린 뒤 마지막 샘플을 돌려준다 */
function trace(opts: TraceOpts): ReelSample {
  const { revs, revPerSec, fps, radius = R, dir = 1, config = DEFAULT_REEL } = opts
  const reel = createReel(CX, CY, R, R, config)
  const dt = 1000 / fps
  const durMs = (revs / revPerSec) * 1000
  let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
  for (let t = 0; t <= durMs; t += dt) {
    const a = dir * TAU * revPerSec * (t / 1000)
    last = reel.feed(CX + Math.cos(a) * radius, CY + Math.sin(a) * radius, t)
  }
  return last
}

/** 궤도 위에서 좌우로 왕복 — ampSectors 섹터 폭, freqHz 빈도 */
function shake(opts: { ampSectors: number; freqHz: number; fps: number; seconds?: number }): ReelSample {
  const { ampSectors, freqHz, fps, seconds = 5 } = opts
  const reel = createReel(CX, CY, R, R)
  const dt = 1000 / fps
  const amp = (TAU / DEFAULT_REEL.sectors) * ampSectors
  let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
  for (let t = 0; t <= seconds * 1000; t += dt) {
    const a = Math.sin((t / 1000) * TAU * freqHz) * amp
    last = reel.feed(CX + Math.cos(a) * R, CY + Math.sin(a) * R, t)
  }
  return last
}

describe('릴 감기 — 정상 회전', () => {
  it('30fps · 1 rev/s — 8바퀴가 누적된다', () => {
    const r = trace({ revs: 8, revPerSec: 1, fps: 30 })
    expect(r.revs).toBeCloseTo(8, 0)
    expect(r.rate).toBeGreaterThan(0.75)
    expect(r.rate).toBeLessThan(1.25)
  })

  it('최악 조건(15fps · 1.2 rev/s)에서도 누적된다 — 어두운 방 자동노출 하락 대비', () => {
    const r = trace({ revs: 8, revPerSec: 1.2, fps: 15 })
    expect(r.revs).toBeGreaterThan(7.4)
    expect(r.rate).toBeGreaterThan(0.8)
  })

  it('반시계 방향도 똑같이 동작한다 — 왼손잡이·거울 반전 대비', () => {
    const r = trace({ revs: 6, revPerSec: 1, fps: 30, dir: -1 })
    expect(r.revs).toBeCloseTo(6, 0)
  })

  it('링 안쪽(0.9R)은 밴드 안이라 정상 인정된다', () => {
    const r = trace({ revs: 6, revPerSec: 1, fps: 30, radius: R * 0.9 })
    expect(r.revs).toBeGreaterThan(5.5)
  })
})

describe('릴 감기 — 실제 릴 크랭크(세로로 납작한 타원)', () => {
  /**
   * 2026-07-29 실기: 화면과 평행하게 크게 돌리면 잘 인식되는데, 실제 릴 크랭크처럼
   * 돌리면 안 됐다. 크랭크 회전면이 비스듬해 화면에는 세로로 납작한 타원으로 찍히고,
   * 원 궤도로 판정하면 손이 좌우 극점에서 밴드를 벗어나 진행도가 매번 리셋된다.
   */
  const RY = 90
  const RX = 22 // 종횡비 0.24 — 오른쪽 스케치의 납작한 타원

  /** 타원 궤적을 그린다. 궤도(trackRx, trackRy)와 동작(RX, RY)을 따로 준다 */
  function traceEllipse(trackRx: number, trackRy: number, revs = 6): ReelSample {
    const reel = createReel(CX, CY, trackRx, trackRy)
    const dt = 1000 / 30
    let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let t = 0; t <= (revs / 1) * 1000; t += dt) {
      const a = TAU * (t / 1000)
      last = reel.feed(CX + Math.cos(a) * RX, CY + Math.sin(a) * RY, t)
    }
    return last
  }

  it('원 궤도에서는 크랭크 동작의 대부분이 새어나간다 — 실기에서 겪은 증상', () => {
    // 6바퀴를 돌려도 1~2바퀴만 인정된다(측정값 1.5). 손이 좌우 극점에서 밴드를 벗어나
    // 진행도가 리셋되기 때문. "완전히 안 됨"이 아니라 "심하게 새는" 것이 실제 증상이었다.
    const r = traceEllipse(RY, RY)
    expect(r.revs).toBeLessThan(3)
  })

  it('궤도를 같은 종횡비 타원으로 맞추면 거의 전부 인정된다 — 이 수정의 핵심', () => {
    const r = traceEllipse(RX, RY)
    expect(r.revs).toBeCloseTo(6, 0)
    expect(r.rate).toBeGreaterThan(0.75)
  })

  it('타원 궤도가 원 궤도보다 3배 이상 많이 인정한다 — 개선 폭을 고정한다', () => {
    const circle = traceEllipse(RY, RY)
    const ellipse = traceEllipse(RX, RY)
    expect(ellipse.revs).toBeGreaterThan(circle.revs * 3)
  })

  it('타원 궤도에서도 좌우 흔들기는 막힌다 — 종횡비를 풀어줘도 치팅은 안 열린다', () => {
    const reel = createReel(CX, CY, RX, RY)
    let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let t = 0; t <= 5000; t += 1000 / 30) {
      // 타원 위에서 위아래로만 왕복(각도가 뒤집힌다)
      const a = Math.sin((t / 1000) * TAU * 2) * (TAU / 4)
      last = reel.feed(CX + Math.cos(a) * RX, CY + Math.sin(a) * RY, t)
    }
    expect(last.revs).toBeLessThan(1)
  })
})

describe('릴 감기 — 치팅 차단 (이 판정기의 존재 이유)', () => {
  it('작은 폭 좌우 흔들기(1.5섹터 · 3Hz)는 한 바퀴도 못 채운다', () => {
    const r = shake({ ampSectors: 1.5, freqHz: 3, fps: 30 })
    expect(r.revs).toBeLessThan(0.5)
    expect(r.rate).toBeLessThan(0.3)
  })

  it('큰 폭 좌우 흔들기(3섹터 · 2Hz)도 한 바퀴를 못 채운다', () => {
    const r = shake({ ampSectors: 3, freqHz: 2, fps: 30 })
    expect(r.revs).toBeLessThan(1)
  })

  it('링 밖(1.8R)에서 돌리면 onTrack false, 누적 0', () => {
    const r = trace({ revs: 8, revPerSec: 1, fps: 30, radius: R * 1.8 })
    expect(r.onTrack).toBe(false)
    expect(r.revs).toBe(0)
  })

  it('랜드마크가 반대편으로 순간이동하면(4섹터 점프) 무시된다', () => {
    const reel = createReel(CX, CY, R, R)
    let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let i = 0; i < 60; i++) {
      const a = i % 2 === 0 ? 0 : Math.PI
      last = reel.feed(CX + Math.cos(a) * R, CY + Math.sin(a) * R, i * 33)
    }
    expect(last.revs).toBe(0)
  })

  it('링 위에 가만히 있으면 rate 0 — 정지는 감기가 아니다', () => {
    const reel = createReel(CX, CY, R, R)
    let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let i = 0; i < 60; i++) last = reel.feed(CX + R, CY, i * 33)
    expect(last.rate).toBe(0)
    expect(last.onTrack).toBe(true)
  })
})

describe('릴 감기 — 지터 내성 (flipTolerance)', () => {
  /**
   * 2026-07-29 실기: 자동 추적에서 효율 53%, `연속`이 2에서 계속 끊겼다. 원인은 역방향
   * 전이 한 번에 진행도를 전부 버린 것 — 지터나 궤도 추종으로 한 칸 되돌아가는 일이
   * 흔한데 7바퀴 쌓은 게 그 한 번에 날아갔다.
   */
  /** 한 방향으로 돌다가 지정한 프레임에서 한 칸 되돌아가는 궤적 */
  function traceWithGlitch(glitchAt: number[]): ReelSample {
    const reel = createReel(CX, CY, R, R)
    const dt = 1000 / 30
    let sectorPos = 0
    let last: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let i = 0; i < 120; i++) {
      // 섹터를 1칸씩 전진, glitchAt 프레임에서만 1칸 후퇴
      sectorPos += glitchAt.includes(i) ? -1 : 1
      const a = ((sectorPos + 0.5) * TAU) / DEFAULT_REEL.sectors
      last = reel.feed(CX + Math.cos(a) * R, CY + Math.sin(a) * R, i * dt)
    }
    return last
  }

  it('지터 없이 120전이면 15바퀴가 쌓인다 (기준선)', () => {
    const r = traceWithGlitch([])
    expect(r.revs).toBeCloseTo(15, 0)
  })

  it('한 프레임 역방향이 섞여도 진행도를 잃지 않는다', () => {
    const r = traceWithGlitch([20, 55, 90])
    // 되돌아간 3칸만큼만 손실 — 바퀴가 리셋되지 않는다
    expect(r.revs).toBeGreaterThan(14)
  })

  it('연속 역방향은 진행 중인 소수분만 버리고 완주한 바퀴는 유지한다', () => {
    const reel = createReel(CX, CY, R, R)
    const dt = 1000 / 30
    let sectorPos = 0
    let n = 0
    const stepTo = (delta: number) => {
      sectorPos += delta
      const a = ((sectorPos + 0.5) * TAU) / DEFAULT_REEL.sectors
      return reel.feed(CX + Math.cos(a) * R, CY + Math.sin(a) * R, n++ * dt)
    }

    // 첫 feed는 기준만 잡고 전이를 세지 않으므로 44프레임 = 43전이 = 5바퀴 + 3섹터
    let s: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let i = 0; i < 44; i++) s = stepTo(1)
    expect(s.revs).toBeCloseTo(5.375, 3)
    expect(reel.debug().laps).toBe(5)

    // 역방향 1회 — 관용 범위라 무시된다(카운트도 안 되고 진행도도 안 버린다)
    s = stepTo(-1)
    expect(s.revs).toBeCloseTo(5.375, 3)

    // 역방향 2회째 — 여기서 진짜 역회전으로 인정: 소수분(4섹터)이 버려지고 방향이 뒤집힌다
    s = stepTo(-1)
    expect(reel.debug().dir).toBe(-1)
    expect(reel.debug().laps).toBe(5) // 완주한 5바퀴는 그대로
    expect(s.revs).toBeCloseTo(5.125, 3) // 5바퀴 + 새 방향 1섹터
  })
})

describe('릴 감기 — 검출 상한', () => {
  // 상한 = maxStep × fps ÷ sectors. 30fps·8섹터·maxStep2 → 7.5 rev/s.
  // 사람이 낼 수 있는 속도(~2 rev/s)보다 훨씬 위라 실사용에서 닿지 않는다.
  it('상한 이내(30fps · 5 rev/s)는 정상 카운트된다', () => {
    const r = trace({ revs: 10, revPerSec: 5, fps: 30 })
    expect(r.revs).toBeCloseTo(10, 0)
  })

  // 프레임당 sectors/2를 넘으면 랩어라운드가 방향을 반대로 읽는다(에일리어싱).
  // 30fps·8섹터면 15 rev/s — 물리적으로 불가능한 속도다.
  it('에일리어싱 한계 초과(30fps · 20 rev/s)에서는 카운트가 무너진다', () => {
    const r = trace({ revs: 20, revPerSec: 20, fps: 30 })
    expect(r.revs).toBeLessThan(15)
  })
})

describe('릴 감기 — 상태 관리', () => {
  it('reset이 누적 회전수와 방향을 지운다', () => {
    const reel = createReel(CX, CY, R, R)
    for (let t = 0; t <= 3000; t += 33) {
      const a = TAU * (t / 1000)
      reel.feed(CX + Math.cos(a) * R, CY + Math.sin(a) * R, t)
    }
    expect(reel.debug().laps).toBeGreaterThan(1)
    reel.reset()
    expect(reel.debug()).toMatchObject({ dir: 0, runLen: 0, progress: 0, laps: 0, sector: -1 })
  })

  it('궤도를 옮기면 이전 섹터 기준이 끊긴다 — 어종 교체 시 각도 점프 방지', () => {
    const reel = createReel(CX, CY, R, R)
    reel.feed(CX + R, CY, 0)
    expect(reel.debug().sector).toBeGreaterThanOrEqual(0)
    reel.moveTrack(100, 100, 40, 40)
    expect(reel.debug().sector).toBe(-1)
  })
})
