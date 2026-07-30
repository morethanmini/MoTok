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

const {
  setActive, gamesList, sanctionsList, pointsList, sanctionStatus, searchUsers, onlineUsers, chatReportsList,
} = vi.hoisted(() => ({
  setActive: vi.fn<(gameId: number, isActive: boolean) => Promise<unknown>>(),
  gamesList: vi.fn<() => Promise<unknown>>(),
  sanctionsList: vi.fn<(p?: object) => Promise<unknown>>(),
  pointsList: vi.fn<(p?: object) => Promise<unknown>>(),
  sanctionStatus: vi.fn<(userId: number) => Promise<unknown>>(),
  searchUsers: vi.fn<(nickname: string) => Promise<unknown>>(),
  onlineUsers: vi.fn<() => Promise<unknown>>(),
  chatReportsList: vi.fn<(p?: object) => Promise<unknown>>(),
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
    adminApi: { reports: () => Promise.resolve([]), searchUsers, onlineUsers },
    adminGamesApi: { list: gamesList, setActive },
    adminPointsApi: { list: pointsList },
    adminSanctionApi: { allHistory: sanctionsList, status: sanctionStatus },
    adminChatReportsApi: { list: chatReportsList, detail: vi.fn<() => void>(), updateStatus: vi.fn<() => void>() },
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
  searchUsers.mockResolvedValue([])
  onlineUsers.mockResolvedValue({ users: [], capped: false })
  chatReportsList.mockResolvedValue({ reports: [], page: 0, size: 5, totalElements: 0, totalPages: 0 })
})

/** 닉네임 검색창에 값을 넣고 조회를 누른다. */
async function searchNickname(wrapper: Awaited<ReturnType<typeof mountAdmin>>, nickname: string) {
  const input = wrapper.find('input[type="search"]')
  expect(input.exists(), '닉네임 검색창').toBe(true)
  await input.setValue(nickname)
  await wrapper.find('form.cr-filter').trigger('submit')
  await flushPromises()
}

describe('닉네임으로 회원 좁히기', () => {
  it('닉네임을 id로 바꿔 조회한다 — 서버 필터는 여전히 userId다', async () => {
    searchUsers.mockResolvedValue([{ userId: 42, nickname: '민지' }])
    sanctionStatus.mockResolvedValue({
      suspended: false, banned: false, warnCount: 0, suspendCount: 0, banCount: 0,
      remainingSeconds: null, releaseAt: null, suspendReason: null, banReason: null,
    })
    const wrapper = await mountAdmin()
    await openTab(wrapper, '제재 내역')

    await searchNickname(wrapper, '민지')

    expect(searchUsers).toHaveBeenCalledWith('민지')
    expect(sanctionsList).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 42 }))
    // 상태 카드는 대상이 정해져야 뜬다 — 닉네임 검색도 그 조건을 만족시켜야 한다.
    expect(sanctionStatus).toHaveBeenCalledWith(42)
  })

  it('후보가 여럿이면 고르게 한다 — 임의로 한 명을 집으면 엉뚱한 사람에게 제재가 나간다', async () => {
    searchUsers.mockResolvedValue([
      { userId: 9, nickname: 'master2' },
      { userId: 11, nickname: 'grandmaster' },
    ])
    const wrapper = await mountAdmin()
    await openTab(wrapper, '제재 내역')
    sanctionsList.mockClear()

    await searchNickname(wrapper, 'master')

    expect(sanctionsList).not.toHaveBeenCalled()
    const picker = wrapper.find('.ux-picker')
    expect(picker.exists()).toBe(true)

    await picker.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(sanctionsList).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 11 }))
  })

  it('없는 닉네임은 실패를 밝힌다 — 조용히 전체 목록을 주면 남의 내역을 그 사람 것으로 읽는다', async () => {
    const wrapper = await mountAdmin()
    await openTab(wrapper, '포인트 내역')
    pointsList.mockClear()

    await searchNickname(wrapper, '없는사람')

    expect(pointsList).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('찾지 못했어요')
  })
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

describe('사용중인 유저 탭', () => {
  it('탭을 열 때만 접속자를 부르고, 방 안·로비를 구분해 보여 준다', async () => {
    onlineUsers.mockResolvedValue({
      users: [
        { userId: 3, nickname: '민지', state: 'IN_ROOM', roomId: 'AGFNN8', secondsAgo: 4 },
        { userId: 7, nickname: 'Alex', state: 'ONLINE', roomId: null, secondsAgo: 41 },
      ],
      capped: false,
    })
    const wrapper = await mountAdmin()
    // 안 보는 화면 때문에 서버가 키를 훑게 두지 않는다.
    expect(onlineUsers).not.toHaveBeenCalled()

    await openTab(wrapper, '사용중인 유저')

    expect(onlineUsers).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('2명 접속 중')
    expect(text).toContain('방 안')
    expect(text).toContain('AGFNN8')
    expect(text).toContain('로비')
    expect(text).toContain('41초 전')
    // 페이지가 아니라 스크롤이다 — 60초면 목록이 바뀌어 쪽수를 세는 게 의미가 없다.
    expect(wrapper.find('.cr-pager').exists()).toBe(false)
    expect(wrapper.find('.ou-scroll').exists()).toBe(true)
  })
})

describe('신고함 페이지 크기', () => {
  it('채팅 신고도 한 페이지 5줄로 부른다', async () => {
    await mountAdmin()
    expect(chatReportsList).toHaveBeenCalledWith(expect.objectContaining({ size: 5 }))
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
