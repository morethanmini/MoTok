/**
 * 스코어보드 끌어 옮기기.
 *
 * 게임마다 화면이 달라 기본 자리가 무언가를 가리므로 직접 치울 수 있어야 한다.
 * 여기서 못박는 건 세 가지 — 잡는 순간 튀지 않을 것, 무대 밖으로 나가지 않을 것,
 * 옮긴 자리가 다음 판에도 남을 것. 특히 무대 밖으로 나가면 다시 잡을 수가 없어 되돌릴
 * 방법이 사라진다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useDraggablePanel } from '@/features/game-room/useDraggablePanel'

const KEY = 'test:panel-pos'
const STAGE = { w: 800, h: 600 }
const PANEL = { w: 170, h: 120 }
/** 기본 자리 — CSS의 top:8 / right:8 로 놓인 자리(왼쪽 기준 800-170-8 = 622) */
const DEFAULT_LEFT = STAGE.w - PANEL.w - 8
const DEFAULT_TOP = 8

/** jsdom에는 레이아웃이 없어 무대·패널 크기를 직접 심어 준다. */
function makePanel() {
  const stage = document.createElement('div')
  Object.defineProperty(stage, 'clientWidth', { value: STAGE.w })
  Object.defineProperty(stage, 'clientHeight', { value: STAGE.h })
  stage.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect

  const panel = document.createElement('div')
  Object.defineProperty(panel, 'offsetParent', { value: stage })
  Object.defineProperty(panel, 'offsetWidth', { value: PANEL.w })
  Object.defineProperty(panel, 'offsetHeight', { value: PANEL.h })
  panel.getBoundingClientRect = () => ({ left: DEFAULT_LEFT, top: DEFAULT_TOP }) as DOMRect
  return panel
}

function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
  Object.defineProperty(e, 'currentTarget', { value: document.createElement('div') })
  return e as unknown as PointerEvent
}

let scope: ReturnType<typeof effectScope>

beforeEach(() => localStorage.clear())
afterEach(() => scope?.stop())

function mount() {
  scope = effectScope()
  return scope.run(() => useDraggablePanel(KEY))!
}

describe('useDraggablePanel', () => {
  it('잡는 순간 튀지 않는다 — 지금 보이는 자리에서 이어서 움직인다', async () => {
    const p = mount()
    p.el.value = makePanel()
    await nextTick()

    p.onHandleDown(pointer('pointerdown', 400, 300))
    p.onHandleMove(pointer('pointermove', 380, 340))

    // 옮긴 적 없으면 CSS로 놓인 자리가 출발점이다(0,0이 아니라)
    expect(p.pos.value).toEqual({ x: DEFAULT_LEFT - 20, y: DEFAULT_TOP + 40 })
  })

  it('무대 밖으로 나가지 않는다 — 나가면 다시 잡을 수 없다', async () => {
    const p = mount()
    p.el.value = makePanel()
    await nextTick()

    p.onHandleDown(pointer('pointerdown', 400, 300))
    p.onHandleMove(pointer('pointermove', -9999, -9999))
    expect(p.pos.value).toEqual({ x: 0, y: 0 })

    p.onHandleMove(pointer('pointermove', 9999, 9999))
    expect(p.pos.value).toEqual({ x: STAGE.w - PANEL.w, y: STAGE.h - PANEL.h })
  })

  it('놓으면 자리를 기억하고 다음 판에도 그대로 쓴다', async () => {
    const first = mount()
    first.el.value = makePanel()
    await nextTick()
    first.onHandleDown(pointer('pointerdown', 400, 300))
    first.onHandleMove(pointer('pointermove', 300, 400))
    first.onHandleUp()
    const moved = { ...first.pos.value! }
    scope.stop()

    expect(mount().pos.value).toEqual(moved)
  })

  it('놓기 전에는 저장하지 않는다 — 끌다 만 위치가 남으면 안 된다', async () => {
    const p = mount()
    p.el.value = makePanel()
    await nextTick()
    p.onHandleDown(pointer('pointerdown', 400, 300))
    p.onHandleMove(pointer('pointermove', 300, 400))

    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('더블클릭(reset)하면 기본 자리로 돌아간다', async () => {
    const p = mount()
    p.el.value = makePanel()
    await nextTick()
    p.onHandleDown(pointer('pointerdown', 400, 300))
    p.onHandleMove(pointer('pointermove', 300, 400))
    p.onHandleUp()

    p.reset()
    // style이 없으면 CSS의 기본 자리(top/right)가 그대로 산다
    expect(p.pos.value).toBeNull()
    expect(p.style.value).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('창이 줄어 저장된 자리가 밖이면 붙을 때 되돌린다', async () => {
    localStorage.setItem(KEY, JSON.stringify({ x: 5000, y: 5000 }))
    const p = mount()
    p.el.value = makePanel()
    await nextTick()

    expect(p.pos.value).toEqual({ x: STAGE.w - PANEL.w, y: STAGE.h - PANEL.h })
  })
})
