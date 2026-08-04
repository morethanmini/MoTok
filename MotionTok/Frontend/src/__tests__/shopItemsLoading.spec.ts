/**
 * 상점 목록은 서버 응답 전에 <b>예시 아이템을 보여 주지 않는다</b>.
 *
 * 전에는 `MOCK_ITEMS` 9개를 먼저 그리고 서버 목록(7개)으로 갈아치웠다. 개수·순서·썸네일이 모두
 * 달라 그 순간 그리드가 통째로 재배열됐고(순서가 튐), 목데이터에는 DB에 없는 아이템
 * ("별 가면"·"무지개 효과"·"우주 배경"·"반짝임 효과")이 섞여 있어 <b>잠깐이지만 살 수 없는 것을
 * 살 수 있게 보여 줬다</b> — 누르면 404다.
 *
 * 조회 실패 때 구매를 막는 장치는 있었지만 성공 <b>직전</b>의 이 구간은 막지 못했다. 그래서
 * 여기서 고정하는 건 "로딩 중에는 아이템 이름이 하나도 없다"와 "실패는 예시로 덮지 않고 드러낸다"다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ShopView from '@/features/shop/ShopView.vue'
import { routes } from '@/router/routes'
import type { Item } from '@/api'

const { listItems, getMe } = vi.hoisted(() => ({ listItems: vi.fn(), getMe: vi.fn() }))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    shopApi: { ...actual.shopApi, listItems },
    usersApi: { ...actual.usersApi, getMe },
  }
})

const item = (id: number, name: string, category: Item['category']): Item => ({
  id, name, category, itemType: 'SHOP', pricePoint: 100, imageUrl: '', owned: false,
})

/** 시더가 넣는 순서 그대로(분류 → id) — 서버가 이 순서로 준다. */
const SERVER_ITEMS = [
  item(7, '몽이 가면', 'MASK'),
  item(5, '뽀샤시 효과', 'EFFECT'),
  item(6, '흑백 효과', 'EFFECT'),
  item(1, '하트 스티커', 'STICKER'),
  item(2, '음표 스티커', 'STICKER'),
]

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/shop')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(ShopView, { global: { plugins: [pinia, router] } })
}

const cardNames = (w: Awaited<ReturnType<typeof mountView>>) =>
  w.findAll('.item:not(.skeleton):not(.ai-avatar-item) .name').map((n) => n.text())

beforeEach(() => {
  vi.clearAllMocks()
  getMe.mockResolvedValue({ pointBalance: 5000 })
})

describe('상점 목록 로딩', () => {
  it('응답 전에는 자리표시자만 — 아이템 이름이 하나도 보이지 않는다', async () => {
    let release: (items: Item[]) => void = () => {}
    listItems.mockReturnValue(new Promise<Item[]>((resolve) => { release = resolve }))

    const w = await mountView()

    expect(w.findAll('.item.skeleton').length).toBeGreaterThan(0)
    expect(cardNames(w)).toEqual([])
    // 없는 아이템이 새어 나오지 않는지 — 예전 목데이터의 이름으로 직접 확인한다
    for (const gone of ['별 가면', '무지개 효과', '우주 배경', '반짝임 효과']) {
      expect(w.text()).not.toContain(gone)
    }

    release(SERVER_ITEMS)
    await flushPromises()

    expect(w.findAll('.item.skeleton')).toHaveLength(0)
    expect(cardNames(w)).toEqual(SERVER_ITEMS.map((i) => i.name))
  })

  it('서버가 준 순서를 바꾸지 않는다 — 프론트가 다시 정렬하면 서버와 어긋난다', async () => {
    listItems.mockResolvedValue(SERVER_ITEMS)

    const w = await mountView()
    await flushPromises()

    expect(cardNames(w)).toEqual(['몽이 가면', '뽀샤시 효과', '흑백 효과', '하트 스티커', '음표 스티커'])
  })

  it('조회가 실패하면 예시로 덮지 않고 실패와 다시 시도를 보여 준다', async () => {
    listItems.mockRejectedValue(new Error('서버가 죽었다'))

    const w = await mountView()
    await flushPromises()

    expect(w.find('.load-error').exists()).toBe(true)
    expect(cardNames(w)).toEqual([])
    expect(w.findAll('.item.skeleton')).toHaveLength(0)

    listItems.mockResolvedValue(SERVER_ITEMS)
    await w.find('.load-error button').trigger('click')
    await flushPromises()

    expect(w.find('.load-error').exists()).toBe(false)
    expect(cardNames(w)).toEqual(SERVER_ITEMS.map((i) => i.name))
  })

  it('AI 아바타 만들기 카드는 목록과 무관하게 언제나 있다 — 서버 아이템이 아니다', async () => {
    listItems.mockRejectedValue(new Error('서버가 죽었다'))

    const w = await mountView()
    await flushPromises()

    expect(w.find('.ai-avatar-item').exists()).toBe(true)
  })
})
