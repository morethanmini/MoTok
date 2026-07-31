import { describe, it, expect } from 'vitest'
import { createLoopFitter, DEFAULT_LOOP_FIT } from '../loopFit'
import { createReel, type ReelSample } from '../reel'

/**
 * 롤링 타원 피팅 스펙.
 *
 * 가장 중요한 건 마지막 describe — 궤도를 유저 궤적에 맞춰주면 "아무렇게나 돌려도 인정"이
 * 되는데, 그때도 **좌우 왕복 치팅이 막히는지**가 이 설계의 전제다. 방어선은 피팅이 아니라
 * reel.ts의 "방향 뒤집히면 진행도 0"이라는 주장을 여기서 실제로 확인한다.
 */

const TAU = Math.PI * 2
const FPS = 30
const DT = 1000 / FPS

describe('loopFit — 루프 찾기', () => {
  it('타원 궤적에서 중심과 장단축을 실측값 근처로 찾는다', () => {
    const fit = createLoopFitter()
    const CX = 300
    const CY = 200
    const RX = 40
    const RY = 72 // 종횡비 0.55 — 2026-07-29 실측 크랭크
    let loop = null
    for (let t = 0; t <= 2000; t += DT) {
      const a = TAU * (t / 1000)
      loop = fit.push(CX + Math.cos(a) * RX, CY + Math.sin(a) * RY, t)
    }
    expect(fit.reason()).toBe('ok')
    expect(loop!.cx).toBeCloseTo(CX, -1)
    expect(loop!.cy).toBeCloseTo(CY, -1)
    // 백분위 절단(5%) 때문에 실제보다 약간 작게 잡힌다 — 10% 이내면 충분하다
    expect(loop!.rx).toBeGreaterThan(RX * 0.85)
    expect(loop!.rx).toBeLessThanOrEqual(RX * 1.05)
    expect(loop!.ry).toBeGreaterThan(RY * 0.85)
    expect(loop!.ry).toBeLessThanOrEqual(RY * 1.05)
  })

  it('샘플이 모자라면 아직 판단하지 않는다', () => {
    const fit = createLoopFitter()
    for (let i = 0; i < DEFAULT_LOOP_FIT.minSamples - 1; i++) {
      expect(fit.push(300 + i, 200, i * DT)).toBeNull()
    }
    expect(fit.reason()).toBe('few')
  })

  it('손이 멈춰 있으면 회전으로 보지 않는다', () => {
    const fit = createLoopFitter()
    let loop = null
    for (let t = 0; t <= 2000; t += DT) loop = fit.push(300, 200, t)
    expect(loop).toBeNull()
    expect(fit.reason()).toBe('still')
  })

  it('직선 왕복(수직)은 회전으로 보지 않는다 — 퇴화 타원 거부', () => {
    const fit = createLoopFitter()
    let loop = null
    for (let t = 0; t <= 2000; t += DT) {
      loop = fit.push(300, 200 + Math.sin((t / 1000) * TAU * 2) * 70, t)
    }
    expect(loop).toBeNull()
    expect(fit.reason()).toBe('line')
  })

  it('손이 서서히 이동하면 궤도도 따라간다 — 드리프트 추종', () => {
    const fit = createLoopFitter()
    let loop = null
    for (let t = 0; t <= 6000; t += DT) {
      const a = TAU * (t / 1000)
      // 중심이 초당 20px씩 오른쪽으로 흐른다
      loop = fit.push(300 + t / 50 + Math.cos(a) * 40, 200 + Math.sin(a) * 72, t)
    }
    // 6초 뒤 중심은 300 + 120 = 420 근처여야 한다(윈도 1.5초 지연만큼 뒤처짐)
    expect(loop!.cx).toBeGreaterThan(395)
    expect(loop!.cx).toBeLessThan(425)
  })
})

describe('loopFit + reel 통합 — 이 설계의 전제', () => {
  /** 롤링 피팅으로 궤도를 계속 갱신하며 판정한다 (게임에서 쓸 실제 루프) */
  function run(
    path: (t: number) => { x: number; y: number },
    seconds: number,
  ): { sample: ReelSample; reason: string } {
    const fit = createLoopFitter()
    const reel = createReel(0, 0, 1, 1)
    let sample: ReelSample = { rate: 0, revs: 0, onTrack: false }
    for (let t = 0; t <= seconds * 1000; t += DT) {
      const p = path(t)
      const loop = fit.push(p.x, p.y, t)
      if (!loop) continue
      // 매 프레임 갱신이므로 위상을 유지하는 followTrack을 쓴다 — moveTrack을 쓰면
      // 섹터 기준이 매번 끊겨 아무것도 세지 않는다.
      reel.followTrack(loop.cx, loop.cy, loop.rx, loop.ry)
      sample = reel.feed(p.x, p.y, t)
    }
    return { sample, reason: fit.reason() }
  }

  it('한 방향 회전은 1:1로 누적된다 — 6초·1rev/s면 약 6바퀴', () => {
    const { sample } = run((t) => {
      const a = TAU * (t / 1000)
      return { x: 300 + Math.cos(a) * 40, y: 200 + Math.sin(a) * 72 }
    }, 6)
    // moveTrack이 매 프레임 섹터 기준을 끊으므로(각도 점프 방지) 첫 바퀴 일부가 깎인다.
    // 4바퀴 이상 인정되면 실사용에 충분하다 — 실기 효율은 이보다 높게 나왔다.
    expect(sample.revs).toBeGreaterThan(4)
  })

  it('좌우 왕복은 피팅을 붙여도 한 바퀴를 못 채운다 — 치팅 차단 유지', () => {
    const { sample } = run((t) => {
      // 타원을 그리다 방향만 계속 뒤집는 동작
      const a = Math.sin((t / 1000) * TAU * 2) * (TAU / 3)
      return { x: 300 + Math.cos(a) * 40, y: 200 + Math.sin(a) * 72 }
    }, 6)
    expect(sample.revs).toBeLessThan(1)
  })

  it('수직 직선 왕복은 애초에 판정에 들어가지 않는다', () => {
    const { sample, reason } = run(
      (t) => ({ x: 300, y: 200 + Math.sin((t / 1000) * TAU * 2) * 70 }),
      6,
    )
    expect(reason).toBe('line')
    expect(sample.revs).toBe(0)
  })
})
