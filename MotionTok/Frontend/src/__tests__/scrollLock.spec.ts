/**
 * 팝업이 떠 있는 동안 뒤 페이지 스크롤 잠금.
 *
 * 여기서 못박는 건 <b>되돌리기</b>다. 잠그는 건 눈에 잘 보이지만, 안 풀리는 고장은 팝업을 닫은
 * 다음에야 드러나고 원인이 화면 밖에 있어 찾기 어렵다. 그래서 겹쳐 뜬 경우·화면을 떠난 경우·
 * 페이지가 스스로 걸어 둔 overflow가 있는 경우를 모두 본다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import PixelModal from '@/components/common/PixelModal.vue'
import { __resetScrollLock, useScrollLockWhen } from '@/composables/useScrollLock'

const html = () => document.documentElement.style.overflow
const bodyPos = () => document.body.style.position
const bodyTop = () => document.body.style.top

/** jsdom에는 실제 스크롤이 없다 — 되돌릴 때 어디로 돌려보내는지만 기록해 둔다. */
let scrolledTo: number | null = null

beforeEach(() => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.paddingRight = ''
  scrolledTo = null
  window.scrollTo = ((_x: number, y: number) => {
    scrolledTo = y
  }) as typeof window.scrollTo
  Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
})
afterEach(() => __resetScrollLock())

describe('팝업 스크롤 잠금', () => {
  it('모달이 떠 있는 동안 잠그고 닫으면 되돌린다', () => {
    const wrapper = mount(PixelModal)
    expect(html()).toBe('hidden')
    expect(bodyPos()).toBe('fixed')

    wrapper.unmount()
    expect(html()).toBe('')
    expect(bodyPos()).toBe('')
    expect(bodyTop()).toBe('')
  })

  it('보고 있던 자리를 잃지 않는다 — 열 때 화면이 튀지 않고 닫으면 그 자리로 돌아온다', () => {
    const wrapper = mount(PixelModal)
    // 스크롤한 만큼 body를 끌어올려 고정하므로 화면은 그대로다.
    // (overflow:hidden만 걸면 뷰포트가 0으로 튀고 되돌릴 수도 없다)
    expect(bodyTop()).toBe('-640px')

    wrapper.unmount()
    expect(scrolledTo).toBe(640)
  })

  it('겹쳐 떠 있으면 마지막 하나가 닫힐 때 풀린다', () => {
    const first = mount(PixelModal)
    const second = mount(PixelModal)

    second.unmount()
    expect(html()).toBe('hidden') // 아직 첫 번째가 떠 있다

    first.unmount()
    expect(html()).toBe('')
  })

  it('페이지가 걸어 둔 스타일을 지우지 않는다 — 원래 값으로 되돌린다', () => {
    document.documentElement.style.overflow = 'clip'
    document.body.style.position = 'relative'

    const wrapper = mount(PixelModal)
    wrapper.unmount()

    expect(html()).toBe('clip')
    expect(bodyPos()).toBe('relative')
  })

  it('화면 안 v-if 확인창도 켜질 때 잠그고 꺼질 때 푼다', async () => {
    const open = ref(false)
    const Host = defineComponent({
      setup() {
        useScrollLockWhen(open)
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    expect(html()).toBe('')

    open.value = true
    await wrapper.vm.$nextTick()
    expect(html()).toBe('hidden')

    open.value = false
    await wrapper.vm.$nextTick()
    expect(html()).toBe('')
    wrapper.unmount()
  })

  it('확인창이 켜진 채 화면을 떠나도 풀린다 — 다음 화면이 안 잠기게', async () => {
    const open = ref(true)
    const Host = defineComponent({
      setup() {
        useScrollLockWhen(open)
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    expect(html()).toBe('hidden')

    wrapper.unmount()

    expect(html()).toBe('')
  })
})
