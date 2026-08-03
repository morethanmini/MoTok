/**
 * 게임 목록은 서버 응답 전에 <b>예시 게임을 보여주지 않는다</b>.
 *
 * 전에는 목데이터 5개를 먼저 그리고 서버 목록으로 갈아치웠다. 두 목록의 내용·순서·카드 종류가
 * 모두 달라서 그 순간 그리드가 통째로 다시 그려졌고(id가 바뀌며 `:key` 재마운트 + 전용 썸네일 ↔
 * 일반 이미지로 카드 높이까지 변경), 목데이터에는 백엔드에 없는 게임("리듬 터치"·"자세 매치")이
 * 섞여 있어 잠깐이지만 존재하지 않는 게임을 고를 수 있게 보여 주고 있었다.
 *
 * 그래서 여기서 고정하는 건 두 가지다 — <b>로딩 중에 게임 이름이 하나도 없을 것</b>(자리표시자만),
 * 그리고 <b>조회가 실패하면 빈 화면이 아니라 실패를 드러낼 것</b>(폴백을 없앤 대가를 치르는 자리).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import GamesCatalogView from '@/features/games-catalog/GamesCatalogView.vue'
import { __resetGameCatalogCache } from '@/composables/useGameCatalog'
import { routes } from '@/router/routes'
import { useSessionStore } from '@/stores/session'
import type { Game } from '@/api'

const { list, detail } = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, gamesApi: { ...actual.gamesApi, list, detail } }
})

const game = (id: number, name: string, minPlayers = 1): Game => ({
  id, name, description: `${name} 설명`, mode: 'VERSUS', minPlayers, maxPlayers: 8,
  supportsBot: false, category: '모션', thumbnailUrl: '', playable: true, active: true,
})

/** 백엔드 시더에 실제로 존재하는 5개(GameCatalogSeeder·RhythmGameSeeder 기준) */
const SERVER_GAMES = [
  game(1, '핑거 스타'),
  game(2, '캐치캐치리듬'),
  game(4, '몸 끼워 맞추기'),
  game(10, '그림으로 말해요', 3),
  game(11, '모션 낚시'),
]

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/games')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  useSessionStore().role = 'member'
  return mount(GamesCatalogView, { global: { plugins: [pinia, router] } })
}

const cardNames = (w: Awaited<ReturnType<typeof mountView>>) =>
  w.findAll('.game-card:not(.skeleton) .game-title-row h3').map((n) => n.text())

beforeEach(() => {
  vi.clearAllMocks()
  // 카탈로그 캐시는 모듈 수명이다 — 비우지 않으면 앞 테스트가 받아 둔 목록이 다음 테스트의
  // 폴백으로 쓰여, 실패를 보여 줘야 하는 테스트가 조용히 통과한다(실제로 그랬다).
  __resetGameCatalogCache()
  detail.mockRejectedValue(new Error('상세는 이 테스트의 관심사가 아니다'))
})

describe('게임 목록 로딩', () => {
  it('응답 전에는 자리표시자만 — 게임 이름이 하나도 보이지 않는다', async () => {
    // 응답을 붙잡아 둔다. 이 순간이 전에 목데이터가 보였던 구간이다.
    let release: (games: Game[]) => void = () => {}
    list.mockReturnValue(new Promise<Game[]>((resolve) => { release = resolve }))

    const w = await mountView()

    expect(w.findAll('.game-card.skeleton').length).toBeGreaterThan(0)
    expect(cardNames(w)).toEqual([])
    // 없는 게임이 새어 나오지 않는지 — 예전 목데이터의 이름으로 직접 확인한다
    expect(w.text()).not.toContain('리듬 터치')
    expect(w.text()).not.toContain('자세 매치')

    release(SERVER_GAMES)
    await flushPromises()

    expect(w.findAll('.game-card.skeleton')).toHaveLength(0)
    expect(cardNames(w)).toEqual(['핑거 스타', '캐치캐치리듬', '몸 끼워 맞추기', '그림으로 말해요', '모션 낚시'])
  })

  it('서버 목록을 받은 순서 그대로 그린다 — 프론트가 다시 정렬하지 않는다', async () => {
    list.mockResolvedValue(SERVER_GAMES)

    const w = await mountView()
    await flushPromises()

    expect(cardNames(w)).toEqual(SERVER_GAMES.map((g) => g.name))
  })

  it('조회가 실패하면 빈 화면이 아니라 실패와 다시 시도를 보여 준다', async () => {
    list.mockRejectedValue(new Error('서버가 죽었다'))

    const w = await mountView()
    await flushPromises()

    expect(w.find('.list-error').exists()).toBe(true)
    expect(cardNames(w)).toEqual([])
    expect(w.findAll('.game-card.skeleton')).toHaveLength(0)

    // 다시 시도로 되살아난다 — 폴백이 없으니 이 버튼이 유일한 복구 수단이다
    list.mockResolvedValue(SERVER_GAMES)
    await w.find('.list-error button').trigger('click')
    await flushPromises()

    expect(w.find('.list-error').exists()).toBe(false)
    expect(cardNames(w)).toEqual(SERVER_GAMES.map((g) => g.name))
  })

  it('한 번 받은 뒤 실패하면 직전 목록으로 버틴다 — 예시를 꾸며내지 않는다', async () => {
    list.mockResolvedValue(SERVER_GAMES)
    const first = await mountView()
    await flushPromises()
    expect(cardNames(first)).toEqual(SERVER_GAMES.map((g) => g.name))

    // 두 번째 방문에서 조회가 죽는다. 게임 시작은 STOMP로 나가므로 놀 수 있는 상태인데,
    // 여기서 오류 화면을 띄우면 목록을 못 그린 것만으로 못 놀게 만든다.
    list.mockRejectedValue(new Error('서버가 죽었다'))
    const second = await mountView()
    await flushPromises()

    expect(second.find('.list-error').exists()).toBe(false)
    expect(cardNames(second)).toEqual(SERVER_GAMES.map((g) => g.name))
    // 자리표시자도 안 보인다 — 보여 줄 진짜 목록이 이미 있다
    expect(second.findAll('.game-card.skeleton')).toHaveLength(0)
  })

  it('게스트에게는 1인 플레이 게임만 — 자리표시자 단계에서 개수가 흔들리지 않는다', async () => {
    list.mockResolvedValue(SERVER_GAMES)

    const router = createRouter({ history: createMemoryHistory(), routes })
    router.push('/games')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    useSessionStore().role = 'guest'
    const w = mount(GamesCatalogView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    // 그림으로 말해요(3명부터)만 빠진다
    expect(cardNames(w)).toEqual(['핑거 스타', '캐치캐치리듬', '몸 끼워 맞추기', '모션 낚시'])
  })
})
