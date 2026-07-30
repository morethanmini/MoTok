import { describe, expect, it } from 'vitest'
import { createLoop, DEFAULT_LOOP, type LoopState } from '../loop'
import { drawFrame } from '../render/drawFrame'
import type { FishingSkin, FishingView } from '../render/types'

/**
 * 스킨 호출 순서·조건만 검사한다 — 캔버스에 실제로 무엇이 그려지는지는 눈으로 봐야 한다.
 *
 * 이 테스트가 지키는 건 "조건부 호출"이다. 찌가 안 보일 때 찌를 그리거나, 던진 뒤에도 조준선이
 * 남으면 화면이 거짓 정보를 준다. 순서가 깨지면 배경이 물고기를 덮는다.
 */
function recordingSkin(withOptional: boolean) {
  const calls: string[] = []
  const skin: FishingSkin = {
    id: 'test',
    label: 'test',
    drawBackground: () => void calls.push('bg'),
    drawFish: () => void calls.push('fish'),
    drawSplashes: () => void calls.push('splash'),
    drawBobber: () => void calls.push('bobber'),
    drawAim: () => void calls.push('aim'),
    drawGauges: () => void calls.push('gauge'),
    ...(withOptional
      ? {
          drawMarker: () => void calls.push('marker'),
          drawHud: () => void calls.push('hud'),
        }
      : {}),
  }
  return { skin, calls }
}

function view(state: LoopState, over: Partial<FishingView> = {}): FishingView {
  return {
    state,
    aim: { locked: false, x: 0 },
    marker: null,
    splashes: [],
    video: null,
    tMs: 0,
    hud: '문구',
    ...over,
  }
}

/** ctx는 쓰이지 않는다 — 스킨을 전부 대역으로 바꿨기 때문 */
const ctx = {} as CanvasRenderingContext2D

describe('drawFrame', () => {
  it('배경을 먼저, 게이지를 나중에 그린다', () => {
    const { skin, calls } = recordingSkin(false)
    const s = createLoop().state()
    drawFrame(ctx, skin, DEFAULT_LOOP, view(s))
    expect(calls[0]).toBe('bg')
    expect(calls[calls.length - 1]).toBe('gauge')
    // 물고기가 배경 뒤에 숨지 않는다
    expect(calls.indexOf('fish')).toBeGreaterThan(calls.indexOf('bg'))
  })

  it('물고기 수만큼 drawFish를 부른다', () => {
    const { skin, calls } = recordingSkin(false)
    const s = createLoop().state()
    drawFrame(ctx, skin, DEFAULT_LOOP, view(s))
    expect(calls.filter((c) => c === 'fish')).toHaveLength(s.fishes.length)
    expect(s.fishes.length).toBe(DEFAULT_LOOP.fishCount)
  })

  it('찌가 안 보이면 찌를 그리지 않는다', () => {
    const { skin, calls } = recordingSkin(false)
    const s = createLoop().state()
    expect(s.bobber.visible).toBe(false)
    drawFrame(ctx, skin, DEFAULT_LOOP, view(s))
    expect(calls).not.toContain('bobber')
  })

  it('던진 뒤에는 조준선을 그리지 않는다 — 조준은 백스윙 중에만', () => {
    const loop = createLoop()
    const { skin, calls } = recordingSkin(false)

    // IDLE + 백스윙 중 → 조준선 있다
    drawFrame(ctx, skin, DEFAULT_LOOP, view(loop.state(), { aim: { locked: true, x: 100 } }))
    expect(calls).toContain('aim')

    // 던지면 phase가 casting이 되므로 locked가 남아 있어도 안 그린다
    loop.cast(100, 0.5)
    const after = recordingSkin(false)
    drawFrame(ctx, after.skin, DEFAULT_LOOP, view(loop.state(), { aim: { locked: true, x: 100 } }))
    expect(loop.state().phase).toBe('casting')
    expect(after.calls).not.toContain('aim')
    // 찌는 날아가는 중이라 보인다
    expect(after.calls).toContain('bobber')
  })

  it('marker·hud를 구현하지 않은 스킨에서는 그냥 건너뛴다 (정식 스킨이 계측 마커를 안 그리는 근거)', () => {
    const bare = recordingSkin(false)
    const s = createLoop().state()
    const v = view(s, { marker: { x: 10, y: 20 } })
    expect(() => drawFrame(ctx, bare.skin, DEFAULT_LOOP, v)).not.toThrow()
    expect(bare.calls).not.toContain('marker')
    expect(bare.calls).not.toContain('hud')

    const full = recordingSkin(true)
    drawFrame(ctx, full.skin, DEFAULT_LOOP, v)
    expect(full.calls).toContain('marker')
    expect(full.calls).toContain('hud')
  })

  it('marker가 null이면 구현이 있어도 부르지 않는다 — 손을 놓친 프레임', () => {
    const { skin, calls } = recordingSkin(true)
    drawFrame(ctx, skin, DEFAULT_LOOP, view(createLoop().state(), { marker: null }))
    expect(calls).not.toContain('marker')
    expect(calls).toContain('hud')
  })
})
