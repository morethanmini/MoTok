/**
 * 랭킹 보드 닉네임 검색 — 정확히 같은 닉네임만 찾는다.
 *
 * 여기서 고정하는 건 두 가지다.
 *
 * 1) **부분 일치가 아니다.** 관리자 회원 검색(`/v1/admin/users`)은 오타를 감안해 부분 일치인데
 *    이쪽은 반대라, 둘을 헷갈려 자동완성 검색으로 되돌리기 쉽다. 앞뒤 공백만 봐준다 —
 *    붙여 넣은 닉네임에 공백이 끼는 건 사용자가 의도한 차이가 아니다.
 *
 * 2) **옮겨 가는 조건.** 지금 순위표에 없으면 다른 게임에서 가장 높은 순위를 찾아 그리로 옮기는데,
 *    이건 검색 버튼을 눌렀을 때만이다. 사용자가 직접 고른 게임을 검색이 다시 덮어쓰면 게임을
 *    고를 수가 없다(그리고 그 재귀가 무한 루프가 된다).
 *
 * 페이지 이동도 같이 본다. 찾아 놓고 다른 페이지에 있으면 화면에는 아무 일도 안 일어난 것처럼 보인다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import RankingView from '@/features/ranking/RankingView.vue'
import { routes } from '@/router/routes'
import { useSessionStore } from '@/stores/session'
import type { Game, LeaderboardEntry, LeaderboardMode, LeaderboardResponse, PublicUserProfile } from '@/api'

const { leaderboard, getProfile } = vi.hoisted(() => ({
  leaderboard: vi.fn<(gameId: number, mode: LeaderboardMode, limit?: number) => Promise<LeaderboardResponse>>(),
  getProfile: vi.fn<() => Promise<PublicUserProfile>>(),
}))

const game = (id: number, name: string): Game => ({
  id, name, description: '', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8,
  supportsBot: true, category: '모션', thumbnailUrl: '', playable: true, active: true,
})
const GAMES = [game(1, '핑거 스타'), game(3, '리듬 터치'), game(11, '모션 낚시')]

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    gamesApi: { list: () => Promise.resolve(GAMES), leaderboard },
    usersApi: { ...actual.usersApi, getProfile },
  }
})

const entry = (rank: number, nickname: string): LeaderboardEntry => ({
  rank, nickname, userId: 1000 + rank, bestScore: 1000 - rank * 10, playCount: 3,
})

/** 기본 순위표(핑거 스타·멀티) 11명 — PAGE_SIZE(10)를 넘겨 마지막 사람이 2페이지로 밀린다. */
const HOME: LeaderboardEntry[] = [
  entry(1, '유저1'),
  entry(2, 'Alex'), // 대소문자만 다른 짝 — 정확 일치 검증용
  ...Array.from({ length: 8 }, (_, i) => entry(i + 3, `유저${i + 3}`)),
  entry(11, '꼴찌'),
]

/**
 * 게임·모드별 순위표. `떠돌이`는 멀티 두 곳에 있고 모션 낚시(3위)가 리듬 터치(7위)보다 높다.
 * `솔로전용`은 멀티 어디에도 없어 반대 모드까지 넓혀야 나온다.
 */
const BOARDS: Record<string, LeaderboardEntry[]> = {
  '1:MULTI': HOME,
  '3:MULTI': [entry(1, '남'), entry(7, '떠돌이')],
  '11:MULTI': [entry(1, '남'), entry(3, '떠돌이')],
  '1:SOLO': [entry(4, '솔로전용')],
  '3:SOLO': [],
  '11:SOLO': [],
}

beforeEach(() => {
  leaderboard.mockReset()
  leaderboard.mockImplementation((gameId, mode) =>
    Promise.resolve({ gameId, entries: BOARDS[`${gameId}:${mode}`] ?? [] }),
  )
  getProfile.mockReset()
  getProfile.mockResolvedValue({ id: 1003, nickname: '유저3', createdAt: '2026-01-01T00:00:00Z', totalConnectSeconds: 0 })
})

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/ranking')
  await router.isReady()
  const pinia = createPinia()
  // 공개 프로필은 회원 전용이다 — 게스트로 두면 프로필 대신 로그인 유도가 뜬다
  setActivePinia(pinia)
  useSessionStore().role = 'member'
  const wrapper = mount(RankingView, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

type View = Awaited<ReturnType<typeof mountView>>

async function search(wrapper: View, text: string) {
  await wrapper.find('.search-box input').setValue(text)
  await wrapper.find('.search-box button').trigger('click')
  // 두 번 — 다른 게임을 훑은 뒤 watch가 순위표를 새로 받는 것까지 기다린다
  await flushPromises()
  await flushPromises()
}

async function pickGame(wrapper: View, name: string) {
  await wrapper.find('.game-picker-trigger').trigger('click')
  const item = wrapper.findAll('.game-menu button').find((b) => b.text().includes(name))!
  await item.trigger('click')
  await flushPromises()
}

const result = (wrapper: View) =>
  wrapper.find('.search-result').exists() ? wrapper.find('.search-result').text() : null
const foundRow = (wrapper: View) =>
  wrapper.find('.score-row.found').exists() ? wrapper.find('.score-row.found .player b').text() : null
const moved = (wrapper: View) =>
  wrapper.find('.search-moved').exists() ? wrapper.find('.search-moved').text() : null
const shownGame = (wrapper: View) => wrapper.find('.game-picker-trigger b').text()

describe('랭킹 닉네임 검색', () => {
  it('정확히 같은 닉네임이면 순위와 점수를 알려 주고 그 줄을 표시한다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유저3')

    expect(foundRow(wrapper)).toBe('유저3')
    expect(result(wrapper)).toContain('3위')
    expect(result(wrapper)).toContain('970')
    expect(moved(wrapper)).toBeNull() // 옮기지 않았으므로 안내가 없다
  })

  it('부분만 맞으면 찾지 않는다 — 관리자 검색과 달리 여기는 정확 일치다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유저')

    expect(foundRow(wrapper)).toBeNull()
    expect(result(wrapper)).toContain('없어요')
  })

  it('대소문자가 다르면 찾지 않는다', async () => {
    const wrapper = await mountView()
    await search(wrapper, 'alex')
    expect(foundRow(wrapper)).toBeNull()

    await search(wrapper, 'Alex')
    expect(foundRow(wrapper)).toBe('Alex')
  })

  it('앞뒤 공백은 무시한다 — 붙여 넣은 닉네임이 안 걸리면 안 된다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '  유저3  ')

    expect(foundRow(wrapper)).toBe('유저3')
  })

  it('다른 페이지에 있는 사람을 찾으면 그 페이지로 넘긴다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.pager span').text()).toBe('1 / 2')

    await search(wrapper, '꼴찌')

    expect(wrapper.find('.pager span').text()).toBe('2 / 2')
    expect(foundRow(wrapper)).toBe('꼴찌')
  })

  it('결과 박스를 누르면 그 사람 프로필이 열린다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유저3')
    expect(wrapper.find('.up').exists()).toBe(false)

    await wrapper.find('button.search-result').trigger('click')
    await flushPromises()

    expect(wrapper.find('.up').exists()).toBe(true)
  })

  it('못 찾은 결과는 누를 수 없다 — 열어 줄 프로필이 없다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '없는사람')

    expect(wrapper.find('.search-result').exists()).toBe(true)
    expect(wrapper.find('button.search-result').exists()).toBe(false)
  })

  it('검색어를 비우면 결과 표시가 사라진다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유저3')
    expect(foundRow(wrapper)).not.toBeNull()

    await search(wrapper, '')
    expect(result(wrapper)).toBeNull()
    expect(foundRow(wrapper)).toBeNull()
  })

  it('지금 순위표에 없으면 그 사람 최고 순위 게임으로 옮긴다', async () => {
    const wrapper = await mountView()
    expect(shownGame(wrapper)).toBe('핑거 스타')

    // 리듬 터치 7위 · 모션 낚시 3위 — 높은 쪽으로 간다
    await search(wrapper, '떠돌이')

    expect(shownGame(wrapper)).toBe('모션 낚시')
    expect(foundRow(wrapper)).toBe('떠돌이')
    expect(result(wrapper)).toContain('3위')
    expect(moved(wrapper)).toContain('모션 낚시')
  })

  it('지금 모드에 아무도 없으면 반대 모드까지 넓힌다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.mode-switch button.active').text()).toBe('멀티 플레이')

    await search(wrapper, '솔로전용')

    expect(wrapper.find('.mode-switch button.active').text()).toBe('혼자 플레이')
    expect(shownGame(wrapper)).toBe('핑거 스타')
    expect(foundRow(wrapper)).toBe('솔로전용')
    expect(moved(wrapper)).toContain('혼자 플레이')
  })

  it('모드를 넘겨도 없으면 그때 못 찾았다고 한다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유령')

    expect(foundRow(wrapper)).toBeNull()
    expect(result(wrapper)).toContain('어느 순위표에도 없어요')
    expect(shownGame(wrapper)).toBe('핑거 스타') // 고른 게임을 건드리지 않는다
  })

  it('내가 직접 게임을 바꿀 때는 옮기지 않는다 — 고른 게임이 검색에 덮이면 안 된다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '떠돌이')
    expect(shownGame(wrapper)).toBe('모션 낚시')

    // 리듬 터치에도 떠돌이가 있지만(7위) 더 높은 곳으로 되돌아가면 안 된다
    await pickGame(wrapper, '리듬 터치')

    expect(shownGame(wrapper)).toBe('리듬 터치')
    expect(foundRow(wrapper)).toBe('떠돌이')
    expect(result(wrapper)).toContain('7위')
  })

  it('직접 고른 게임에 그 사람이 없으면 옮기지 않고 못 찾았다고 한다', async () => {
    const wrapper = await mountView()
    await search(wrapper, '유저3') // 핑거 스타에만 있다

    await pickGame(wrapper, '리듬 터치')

    expect(shownGame(wrapper)).toBe('리듬 터치')
    expect(foundRow(wrapper)).toBeNull()
    expect(result(wrapper)).toContain('없어요')
  })

  it('훑는 중에 Enter를 또 눌러도 검색이 겹쳐 돌지 않는다', async () => {
    const wrapper = await mountView()
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => (release = r))
    // 다른 게임 조회를 붙잡아 둬서 "훑는 중" 상태를 만든다
    leaderboard.mockImplementation(async (gameId, mode) => {
      if (!(gameId === 1 && mode === 'MULTI')) await gate
      return { gameId, entries: BOARDS[`${gameId}:${mode}`] ?? [] }
    })

    await wrapper.find('.search-box input').setValue('떠돌이')
    await wrapper.find('.search-box input').trigger('keydown.enter')
    await flushPromises()
    const firstWave = leaderboard.mock.calls.length
    expect(firstWave).toBeGreaterThan(0)
    expect(wrapper.find('.search-box button').attributes('disabled')).toBeDefined()

    // 버튼은 잠기지만 Enter는 그대로 들어온다 — 여기서 두 번째 훑기가 돌면 안 된다
    await wrapper.find('.search-box input').trigger('keydown.enter')
    await flushPromises()
    expect(leaderboard.mock.calls.length).toBe(firstWave)

    release!()
    await flushPromises()
    await flushPromises()
    expect(shownGame(wrapper)).toBe('모션 낚시')
    expect(foundRow(wrapper)).toBe('떠돌이')
  })

  it('옮겼는데 그 사람이 없으면 그 안내가 다음 검색에 남지 않는다', async () => {
    const wrapper = await mountView()
    // 훑을 때는 모션 낚시에 떠돌이가 있는데, 옮겨서 다시 받을 때는 이미 빠져 있다
    // (훑기와 재조회 사이에 순위가 바뀐 경우)
    let elevenCalls = 0
    leaderboard.mockImplementation((gameId, mode) => {
      if (gameId === 11 && mode === 'MULTI') {
        elevenCalls += 1
        return Promise.resolve({
          gameId,
          entries: elevenCalls === 1 ? BOARDS['11:MULTI']! : [entry(1, '남')],
        })
      }
      return Promise.resolve({ gameId, entries: BOARDS[`${gameId}:${mode}`] ?? [] })
    })

    await search(wrapper, '떠돌이')
    // 옮겨 갔지만 거기 없으니 못 찾았고, 쓸 자리가 없어진 안내도 남지 않는다
    expect(shownGame(wrapper)).toBe('모션 낚시')
    expect(foundRow(wrapper)).toBeNull()
    expect(moved(wrapper)).toBeNull()

    // 이 순위표에 있는 사람으로 검색을 성공시킨다 — 여기에 "옮겼어요"가 붙으면 안 된다
    await search(wrapper, '남')

    expect(foundRow(wrapper)).toBe('남')
    expect(moved(wrapper)).toBeNull()
  })

  it('조회가 실패해 폴백 순위표를 보고 있으면 검색 대상으로 삼지 않는다', async () => {
    const wrapper = await mountView()
    // 모든 조회를 실패시켜 폴백(MOCK_BOARD)만 남긴다
    leaderboard.mockImplementation(() => Promise.reject(new Error('boom')))
    await pickGame(wrapper, '리듬 터치')
    // 폴백에 실제로 들어 있는 이름이다 — 그런데 실제 회원이 아니라 찾아 주면 안 된다
    expect(wrapper.findAll('.score-row .player b').map((b) => b.text())).toContain('민수')

    await search(wrapper, '민수')

    expect(foundRow(wrapper)).toBeNull()
    expect(wrapper.find('button.search-result').exists()).toBe(false)
    expect(result(wrapper)).toContain('없어요')
  })

  it('한 게임 조회가 실패해도 나머지에서 찾은 순위로 답한다', async () => {
    const wrapper = await mountView()
    leaderboard.mockImplementation((gameId, mode) =>
      gameId === 11
        ? Promise.reject(new Error('boom')) // 최고 순위였던 곳이 죽었다
        : Promise.resolve({ gameId, entries: BOARDS[`${gameId}:${mode}`] ?? [] }),
    )

    await search(wrapper, '떠돌이')

    expect(shownGame(wrapper)).toBe('리듬 터치')
    expect(foundRow(wrapper)).toBe('떠돌이')
  })
})
