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

    // IDLE + 백스윙 중 → 착수점 미리보기 있다
    drawFrame(ctx, skin, DEFAULT_LOOP, view(loop.state(), { aim: { locked: true, x: 100 } }))
    expect(calls).toContain('aim')

    // 던지면 phase가 casting이 되므로 locked가 남아 있어도 안 그린다
    loop.cast(100)
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

/**
 * 흔들림은 무대에만 걸려야 한다.
 *
 * HUD까지 흔들리면 정작 타격이 온 순간에 문구를 못 읽고, 배경까지 옮기면 이동한 만큼 캔버스
 * 가장자리에 이전 프레임이 남는다. 둘 다 눈으로는 "뭔가 이상한데" 정도로만 보여서 놓치기 쉽다.
 */
describe('drawFrame 흔들림', () => {
  function tracingCtx() {
    const calls: string[] = []
    const stub = {
      save: () => void calls.push('save'),
      restore: () => void calls.push('restore'),
      translate: (x: number, y: number) => void calls.push(`translate(${x !== 0 || y !== 0})`),
    }
    return { calls, ctx: stub as unknown as CanvasRenderingContext2D }
  }

  function skinTracing(calls: string[]) {
    const rec = (n: string) => () => void calls.push(n)
    const skin: FishingSkin = {
      id: 't',
      label: 't',
      drawBackground: rec('bg'),
      drawFish: rec('fish'),
      drawSplashes: rec('splash'),
      drawBobber: rec('bobber'),
      drawAim: rec('aim'),
      drawGauges: rec('gauge'),
      drawHud: rec('hud'),
    }
    return skin
  }

  it('shake가 0이면 캔버스를 건드리지 않는다', () => {
    const { calls, ctx: c } = tracingCtx()
    drawFrame(c, skinTracing(calls), DEFAULT_LOOP, view(createLoop().state(), { shake: 0 }))
    expect(calls.filter((x) => x.startsWith('translate'))).toHaveLength(0)
  })

  it('shake가 있으면 배경 뒤에서 시작하고 게이지 앞에서 끝난다', () => {
    const { calls, ctx: c } = tracingCtx()
    drawFrame(c, skinTracing(calls), DEFAULT_LOOP, view(createLoop().state(), { shake: 1, tMs: 40 }))

    const bg = calls.indexOf('bg')
    const tr = calls.findIndex((x) => x.startsWith('translate'))
    const fish = calls.indexOf('fish')
    const restore = calls.lastIndexOf('restore')
    const gauge = calls.indexOf('gauge')
    const hud = calls.indexOf('hud')

    // 배경은 흔들리지 않는다 (가장자리에 이전 프레임이 남는다)
    expect(bg).toBeLessThan(tr)
    // 무대는 흔들린다
    expect(tr).toBeLessThan(fish)
    // UI는 흔들리지 않는다
    expect(restore).toBeLessThan(gauge)
    expect(restore).toBeLessThan(hud)
  })

  it('shake는 실제로 0이 아닌 값으로 이동한다', () => {
    const { calls, ctx: c } = tracingCtx()
    drawFrame(c, skinTracing(calls), DEFAULT_LOOP, view(createLoop().state(), { shake: 1, tMs: 40 }))
    expect(calls).toContain('translate(true)')
  })
})
