import { describe, it, expect } from 'vitest'
import { createLoopFitter, DEFAULT_LOOP_FIT } from '../loopFit'
import { createReel, DEFAULT_REEL } from '../reel'

/**
 * loopFit + reel 파이프라인 효율 — 게임에서 쓸 실제 조합.
 *
 * 실기 궤적(장축 67px·종횡비 0.55·0.89 rev/s, 2026-07-29 실측)을 10바퀴 흘려보내고 몇 바퀴가
 * 인정되는지 본다. 첫 1.5초는 피팅 워밍업이라 구조적으로 깎이므로 100%는 나오지 않는다.
 *
 * 이 테스트가 존재하는 이유: 실기에서 10바퀴에 6.38(64%)이 나왔을 때 "섹터 양자화 때문에
 * 전이가 버려진다"고 의심했는데, 섹터 수·점프 한계를 어떻게 바꿔도 91~93%로 동일했다.
 * 실제로 효율을 움직인 유일한 변수는 loopFit의 저역통과(smooth)였다 — 필터가 세면 궤도가
 * 손을 늦게 따라가 중심이 루프 밖으로 밀리고, 각도가 winding 대신 진동한다.
 * 그 관계가 깨지면(= 필터를 세게 해도 효율이 안 떨어지면) 이 진단 결론이 무효가 된 것이다.
 */

const TAU = Math.PI * 2
const FPS = 30
const DT = 1000 / FPS
const RY = 67
const RX = 37
const REV_PER_SEC = 0.89
const LAPS = 10

/** 결정적 의사난수 — Math.random을 쓰면 실행마다 결과가 흔들려 비교가 안 된다 */
function makeRnd(seed = 12345) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff - 0.5
  }
}

function efficiency(opts: { smooth?: number; jitterPx?: number } = {}): number {
  const fit = createLoopFitter({ ...DEFAULT_LOOP_FIT, smooth: opts.smooth ?? DEFAULT_LOOP_FIT.smooth })
  const reel = createReel(0, 0, 1, 1, DEFAULT_REEL)
  const rnd = makeRnd()
  const jit = opts.jitterPx ?? 0
  let revs = 0
  for (let t = 0; t <= (LAPS / REV_PER_SEC) * 1000; t += DT) {
    const a = TAU * REV_PER_SEC * (t / 1000)
    const x = 320 + Math.cos(a) * RX + rnd() * jit
    const y = 240 + Math.sin(a) * RY + rnd() * jit
    const loop = fit.push(x, y, t)
    if (!loop) continue
    reel.followTrack(loop.cx, loop.cy, loop.rx, loop.ry)
    revs = reel.feed(x, y, t).revs
  }
  return revs / LAPS
}

describe('loopFit + reel 파이프라인 효율', () => {
  it('깨끗한 10바퀴는 85% 이상 인정된다 (워밍업 손실만)', () => {
    expect(efficiency()).toBeGreaterThan(0.85)
  })

  it('6px 랜드마크 지터가 있어도 효율이 떨어지지 않는다 — flipTolerance가 흡수한다', () => {
    expect(efficiency({ jitterPx: 6 })).toBeGreaterThan(0.85)
  })

  it('저역통과를 세게 걸면 효율이 떨어진다 — 지연이 손실의 원인이라는 진단 근거', () => {
    const weak = efficiency({ jitterPx: 6, smooth: 1 }) // 필터 없음
    const strong = efficiency({ jitterPx: 6, smooth: 0.05 }) // 아주 느린 추종
    expect(strong).toBeLessThan(weak)
  })
})
