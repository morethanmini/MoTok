/**
 * 관리자 페이지의 새 세 탭 — 제재 내역 · 포인트 내역 · 게임 관리 (-106).
 *
 * <p>순수 로직은 adminGames·adminPoints spec이 고정한다. 여기서 보는 건 <b>화면이 서버 응답으로
 * 실제 무엇을 그리는가</b>다 — 특히 회원을 지정하지 않은 기본 상태에서 목록이 나오는지(이 화면의
 * 원래 문제가 "회원 id를 알아야만 아무것도 안 보인다"였다), 닫힌 게임이 목록에 남는지, 그리고
 * 토글이 서버 응답으로 상태를 맞추는지.</p>
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminView from '@/features/admin/AdminView.vue'
import { routes } from '@/router/routes'

const { setActive, gamesList, sanctionsList, pointsList, sanctionStatus } = vi.hoisted(() => ({
  setActive: vi.fn<(gameId: number, isActive: boolean) => Promise<unknown>>(),
  gamesList: vi.fn<() => Promise<unknown>>(),
  sanctionsList: vi.fn<(p?: object) => Promise<unknown>>(),
  pointsList: vi.fn<(p?: object) => Promise<unknown>>(),
  sanctionStatus: vi.fn<(userId: number) => Promise<unknown>>(),
}))

const GAMES = [
  {
    id: 1, name: '핑거 스타', mode: 'VERSUS', category: 'MOTION',
    minPlayers: 1, maxPlayers: 8, roundDurationSec: 30,
    supportsBot: true, soloCapable: true, active: true,
  },
  {
    id: 10, name: '그림으로 말해요', mode: 'COOP', category: 'PARTY',
    minPlayers: 3, maxPlayers: 8, roundDurationSec: 90,
    supportsBot: false, soloCapable: false, active: false,
  },
]

const SANCTIONS = {
  sanctions: [
    {
      id: 5, userId: 42, userNickname: '민지', adminUserId: 1, adminNickname: '운영자',
      type: 'SUSPEND', days: 3, reason: '욕설 반복',
      refReportId: 7, refReportType: 'CHAT_REPORT', createdAt: '2026-07-30T09:00:00',
    },
  ],
  page: 0, size: 20, totalElements: 1, totalPages: 1,
}

const POINTS = {
  histories: [
    {
      id: 3, userId: 42, nickname: '민지', amount: -1200,
      type: 'SHOP_PURCHASE', refId: 9, balanceAfter: 800, createdAt: '2026-07-30T10:00:00',
    },
    {
      id: 2, userId: 7, nickname: 'Alex', amount: 300,
      type: 'GAME_REWARD', refId: null, balanceAfter: 2000, createdAt: '2026-07-30T09:30:00',
    },
  ],
  page: 0, size: 20, totalElements: 2, totalPages: 1,
  summary: null,
}

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  const empty = { reports: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
  return {
    ...actual,
    adminApi: { reports: () => Promise.resolve([]), auditLogs: () => Promise.reject(new Error('미구현')) },
    adminGamesApi: { list: gamesList, setActive },
    adminPointsApi: { list: pointsList },
    adminSanctionApi: { allHistory: sanctionsList, status: sanctionStatus },
    adminChatReportsApi: { list: () => Promise.resolve(empty), detail: vi.fn<() => void>(), updateStatus: vi.fn<() => void>() },
    adminUserReportsApi: { list: () => Promise.resolve(empty), updateStatus: vi.fn<() => void>() },
  }
})

/** AppPage가 AppHeader(라우터·세션 스토어)를 끌고 오므로 friendsView.spec처럼 pinia+router를 깔아 준다. */
async function mountAdmin() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/admin')
  await router.isReady()
  const wrapper = mount(AdminView, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return wrapper
}

async function openTab(wrapper: Awaited<ReturnType<typeof mountAdmin>>, label: string) {
  const tab = wrapper.findAll('.tabs button').find((b) => b.text() === label)
  expect(tab, `"${label}" 탭 버튼`).toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
}

/**
 * 게임 행의 허용/차단 토글. 행에 버튼이 이것 하나뿐이라 first-match로 집는다 —
 * "마지막 버튼"으로 집으면 행에 버튼이 하나 늘어날 때 조용히 다른 걸 누른다.
 */
function toggleButtonOfFirstGame(wrapper: Awaited<ReturnType<typeof mountAdmin>>) {
  const row = wrapper.findAll('tbody tr')[0]
  expect(row, '첫 게임 행').toBeTruthy()
  return row!.find('button')
}

beforeEach(() => {
  vi.clearAllMocks()
  gamesList.mockResolvedValue(GAMES)
  sanctionsList.mockResolvedValue(SANCTIONS)
  pointsList.mockResolvedValue(POINTS)
  sanctionStatus.mockResolvedValue(null)
})

describe('제재 내역 탭', () => {
  it('회원을 지정하지 않아도 전체 목록을 불러온다', async () => {
    const wrapper = await mountAdmin()

    // 이 화면의 원래 문제 — 회원 id를 넣어야만 조회가 시작됐다.
    expect(sanctionsList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined, type: undefined }),
    )

    await openTab(wrapper, '제재 내역')
    const text = wrapper.text()
    expect(text).toContain('민지')
    expect(text).toContain('기간 정지')
    expect(text).toContain('채팅 신고 #7') // 유형까지 찍어야 되짚을 수 있다
  })

  it('회원 미지정이면 상태 카드 대신 안내를 띄운다 — 정지 상태는 대상이 있어야 의미가 있다', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '제재 내역')

    expect(wrapper.find('.sx-status').exists()).toBe(false)
    expect(wrapper.text()).toContain('전체 제재 내역이에요')
    expect(sanctionStatus).not.toHaveBeenCalled()
  })
})

describe('포인트 내역 탭', () => {
  it('적립·사용을 원장 부호 그대로 그린다', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '포인트 내역')

    const text = wrapper.text()
    expect(text).toContain('-1,200P') // 사용 — balanceAfter와 부호가 맞아야 검산이 된다
    expect(text).toContain('+300P')
    expect(text).toContain('상점 구매')
    expect(text).toContain('게임 보상')
  })

  it('회원 미지정이면 요약 카드가 없다 — 여러 사람을 합친 합계는 의미가 없다', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '포인트 내역')

    expect(wrapper.find('.px-summary').exists()).toBe(false)
  })

  it('회원을 지정하면 서버가 준 전체 합계를 요약으로 띄운다', async () => {
    pointsList.mockResolvedValue({
      ...POINTS,
      summary: { earned: 1500, spent: 1200, currentBalance: 300 },
    })
    const wrapper = await mountAdmin()
    await openTab(wrapper, '포인트 내역')

    const summary = wrapper.find('.px-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('+1,500P')
    expect(summary.text()).toContain('-1,200P') // 서버가 양수로 준 값을 사용 방향으로 표기
    expect(summary.text()).toContain('300P')
  })
})

describe('게임 관리 탭', () => {
  it('닫아 둔 게임도 목록에 남는다 — 사라지면 다시 열 방법이 없다', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '게임 관리')

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('그림으로 말해요')
    expect(wrapper.findAll('tr.gm-closed')).toHaveLength(1)
    expect(wrapper.text()).toContain('2개 중')
  })

  it('싱글 탭은 혼자 되는 게임만, 멀티 탭은 여럿 되는 게임만', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '게임 관리')

    const scope = (label: string) =>
      wrapper.findAll('.gm-scope button').find((b) => b.text() === label)!

    await scope('싱글 플레이').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('핑거 스타')
    expect(wrapper.text()).not.toContain('그림으로 말해요')

    await scope('멀티 플레이').trigger('click')
    await flushPromises()
    // 핑거 스타는 min 1 / max 8이라 양쪽에 뜬다 — 한쪽으로 몰면 닫으려는 관리자가 못 찾는다.
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('토글은 서버 응답으로 상태를 맞춘다 — 낙관적으로 먼저 바꾸면 실패했는데 닫힌 줄 안다', async () => {
    setActive.mockResolvedValue({ ...GAMES[0], active: false })
    const wrapper = await mountAdmin()
    await openTab(wrapper, '게임 관리')

    await toggleButtonOfFirstGame(wrapper).trigger('click')
    await flushPromises()

    expect(setActive).toHaveBeenCalledWith(1, false)
    expect(wrapper.findAll('tr.gm-closed')).toHaveLength(2) // 방금 닫은 것까지
  })

  it('토글이 실패하면 화면 상태를 바꾸지 않는다', async () => {
    setActive.mockRejectedValue(new Error('boom'))
    const wrapper = await mountAdmin()
    await openTab(wrapper, '게임 관리')

    await toggleButtonOfFirstGame(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findAll('tr.gm-closed')).toHaveLength(1) // 닫힌 건 원래 하나뿐
  })
})
