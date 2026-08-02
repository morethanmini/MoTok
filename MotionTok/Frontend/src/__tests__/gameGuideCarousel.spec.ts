/**
 * 설명 캐러셀의 "밖에서 페이지를 쥔다" 계약 테스트.
 *
 * 방 안 함께 보기는 이 계약 위에 서 있다 — 방장 화면은 넘기면서 값을 올려보내고(update:page),
 * 참가자 화면은 받은 값만 따르고 스스로 넘기지 못한다(readonly). 둘 중 하나라도 깨지면
 * "방장이 넘겼는데 남의 화면은 그대로"거나 "각자 다른 장을 보는" 상태가 된다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import GameGuideCarousel from '@/features/games-catalog/guide/GameGuideCarousel.vue'
import type { GuidePage } from '@/features/games-catalog/guide/pages'

const Art = defineComponent({ render: () => h('svg') })
const pages: GuidePage[] = ['첫째', '둘째', '셋째'].map((caption) => ({ caption, art: Art }))

const captionOf = (w: ReturnType<typeof mount>) => w.find('.gg-caption span').text()

/** jsdom은 레이아웃이 없어 0을 돌려준다 — 누른 자리 판정에 폭이 필요하므로 심어 준다. */
const STAGE_WIDTH = 400
function stubStageBox() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: STAGE_WIDTH,
  } as DOMRect)
}
/**
 * 끌지 않고 그 자리에서 눌렀다 뗀다(= 탭).
 * VTU의 trigger는 생성 후 clientX를 대입하는데 jsdom의 MouseEvent는 getter뿐이라 막힌다 —
 * 좌표가 판정의 전부인 테스트라 이벤트를 직접 만들어 보낸다.
 */
async function tapAt(w: ReturnType<typeof mount>, x: number) {
  const stage = w.find('.gg-stage').element
  for (const type of ['pointerdown', 'pointerup']) {
    stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 0, bubbles: true }))
  }
  await nextTick()
}

afterEach(() => vi.restoreAllMocks())

describe('GameGuideCarousel', () => {
  it('page를 주지 않으면 스스로 페이지를 들고 넘긴다', async () => {
    const w = mount(GameGuideCarousel, { props: { pages } })

    expect(captionOf(w)).toBe('첫째')
    await w.find('.gg-nav.next').trigger('click')
    expect(captionOf(w)).toBe('둘째')
  })

  it('page를 주면 그 값을 따르고, 넘기면 새 값을 올려보낸다', async () => {
    const w = mount(GameGuideCarousel, { props: { pages, page: 1 } })

    expect(captionOf(w)).toBe('둘째')

    await w.find('.gg-nav.next').trigger('click')
    const sent = w.emitted('update:page') ?? []
    expect(sent[sent.length - 1]).toEqual([2])
    // 부모가 값을 내려주기 전까지는 그대로 — 상태를 두 군데서 들고 있으면 어긋난다.
    await w.setProps({ page: 2 })
    expect(captionOf(w)).toBe('셋째')
  })

  it('readonly면 조작할 수단이 없고 값도 올려보내지 않는다', async () => {
    const w = mount(GameGuideCarousel, { props: { pages, page: 1, readonly: true } })

    expect(w.find('.gg-nav.next').exists()).toBe(false)
    expect(w.find('.gg-nav.prev').exists()).toBe(false)
    // 점은 남지만 버튼이 아니라 진행 표시다
    expect(w.findAll('.gg-dot')).toHaveLength(3)
    expect(w.findAll('button.gg-dot')).toHaveLength(0)

    await w.find('.gg-stage').trigger('keydown.right')
    expect(w.emitted('update:page')).toBeUndefined()
    expect(captionOf(w)).toBe('둘째')
  })

  it('화살표를 정확히 누르지 않아도 그림 좌우 끝을 누르면 넘어간다', async () => {
    stubStageBox()
    const w = mount(GameGuideCarousel, { props: { pages } })
    // 컴포넌트가 setPointerCapture를 부르는데 jsdom에는 없다.
    Element.prototype.setPointerCapture = () => {}

    await tapAt(w, STAGE_WIDTH * 0.9)
    expect(captionOf(w)).toBe('둘째')

    await tapAt(w, STAGE_WIDTH * 0.1)
    expect(captionOf(w)).toBe('첫째')
  })

  it('그림 한가운데를 누르는 건 넘김이 아니다 — 그림을 보려고 누른 것일 수 있다', async () => {
    stubStageBox()
    const w = mount(GameGuideCarousel, { props: { pages } })
    Element.prototype.setPointerCapture = () => {}

    await tapAt(w, STAGE_WIDTH * 0.5)
    expect(captionOf(w)).toBe('첫째')
  })

  it('장수가 줄어든 게임으로 바뀌어도 범위 밖 페이지에서 빈 화면이 되지 않는다', () => {
    const w = mount(GameGuideCarousel, {
      props: { pages: pages.slice(0, 2), page: 4, readonly: true },
    })

    expect(captionOf(w)).toBe('둘째')
  })
})
