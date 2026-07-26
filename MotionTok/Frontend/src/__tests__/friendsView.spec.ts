/**
 * FriendsView 탭 구성 — 친구 / 받은 요청 / 보낸 요청.
 *
 * 보낸 요청 탭은 받은 요청과 데이터 출처는 같지만(FriendRequestItem) 보여줄 사람과 할 수 있는 행동이
 * 반대다: 상대는 addressee이고, 수락·거절은 받는 쪽 권한이라 취소만 할 수 있다. 이 뒤집힘을 고정한다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import FriendsView from '@/features/friends/FriendsView.vue'
import { routes } from '@/router/routes'

// vi.mock 팩토리는 파일 최상단으로 끌어올려지므로 스파이도 hoisted로 만들어야 참조가 닿는다.
const { cancelRequest, respond, requests } = vi.hoisted(() => ({
  cancelRequest: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  respond: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  requests: vi.fn<(d?: string) => Promise<unknown[]>>(),
}))

const RECEIVED = [
  { requestId: 11, requesterNickname: '수아', addresseeNickname: '나', status: 'PENDING', createdAt: '2026-07-18T00:00:00Z' },
]
const SENT = [
  { requestId: 21, requesterNickname: '나', addresseeNickname: '지훈', status: 'PENDING', createdAt: '2026-07-19T00:00:00Z' },
]

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    friendsApi: {
      list: () => Promise.resolve([]),
      requests,
      sendRequest: vi.fn<() => void>(),
      respond,
      cancelRequest,
      remove: vi.fn<() => void>(),
      room: vi.fn<() => void>(),
    },
  }
})

/** AppPage가 AppHeader(라우터·세션 스토어)를 끌고 오므로 App.spec.ts와 같이 pinia+router를 깔아 준다. */
async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/friends')
  await router.isReady()
  const wrapper = mount(FriendsView, { global: { plugins: [createPinia(), router] } })
  await flushPromises() // useAsyncData가 onMounted에서 로드한다
  return wrapper
}

/** 탭 전환. findAll 인덱스 접근이 optional이라 라벨 텍스트로 찾는다. */
async function clickTab(wrapper: Awaited<ReturnType<typeof mountView>>, label: string) {
  for (const btn of wrapper.findAll('.tab-btn')) {
    if (btn.text().includes(label)) return btn.trigger('click')
  }
  throw new Error(`${label} 탭을 찾지 못했다`)
}

describe('FriendsView 탭', () => {
  beforeEach(() => {
    cancelRequest.mockClear()
    respond.mockClear()
    respond.mockImplementation(() => Promise.resolve())
    // direction에 따라 받은/보낸 목록이 갈린다 — 두 탭이 서로의 데이터를 보여주지 않는지까지 확인한다.
    requests.mockImplementation((direction) =>
      Promise.resolve(direction === 'sent' ? SENT : RECEIVED),
    )
  })

  it('친구·받은 요청·보낸 요청 세 탭을 노출한다', async () => {
    const wrapper = await mountView()
    const labels = wrapper.findAll('.tab-btn').map((b) => b.text())

    expect(labels).toHaveLength(3)
    expect(labels[0]).toContain('친구')
    expect(labels[1]).toContain('받은 요청')
    expect(labels[2]).toContain('보낸 요청')
  })

  it('보낸 요청 탭은 상대(addressee)를 보여주고 취소만 제공한다', async () => {
    const wrapper = await mountView()
    await clickTab(wrapper, '보낸 요청')

    const row = wrapper.get('.requests-list li')
    // 보낸 요청의 상대는 addressee('지훈') — 받은 요청 쪽 사람(수아)이 섞여 나오면 direction이 잘못된 것.
    expect(row.text()).toContain('지훈')
    expect(row.text()).not.toContain('수아')

    expect(row.findAll('.req-actions button').map((b) => b.text())).toEqual(['취소'])
  })

  it('받은 요청 탭은 보낸 사람(requester)과 수락·거절을 보여준다', async () => {
    const wrapper = await mountView()
    await clickTab(wrapper, '받은 요청')

    const row = wrapper.get('.requests-list li')
    expect(row.text()).toContain('수아')
    expect(row.findAll('.req-actions button').map((b) => b.text())).toEqual(['수락', '거절'])
  })

  it('취소하면 서버 재조회 결과가 화면에 반영된다', async () => {
    const wrapper = await mountView()
    await clickTab(wrapper, '보낸 요청')
    // 취소 후 재조회에서는 서버가 빈 목록을 준다 — 로컬에서 도려내는 게 아니라 다시 불러와야 통과한다.
    requests.mockImplementation((d) => Promise.resolve(d === 'sent' ? [] : RECEIVED))

    await wrapper.get('.req-actions button').trigger('click')
    await flushPromises()

    expect(cancelRequest).toHaveBeenCalledWith(21)
    expect(wrapper.get('.requests-list').text()).toContain('보낸 요청이 없어요')
  })

  it('수락이 실패하면 목록을 그대로 둔다 — 서버에 남은 요청을 화면에서만 지우면 안 된다', async () => {
    respond.mockImplementation(() => Promise.reject(new Error('boom')))
    const wrapper = await mountView()
    await clickTab(wrapper, '받은 요청')

    await wrapper.get('.req-actions button').trigger('click') // 수락
    await flushPromises()

    expect(wrapper.get('.requests-list li').text()).toContain('수아')
  })

  it('창 포커스가 돌아오면 다시 불러온다 — 상대가 처리한 결과를 새로고침 없이 반영', async () => {
    const wrapper = await mountView()
    const before = requests.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(requests.mock.calls.length).toBeGreaterThan(before)
    expect(wrapper.exists()).toBe(true)
  })

  it('친구 추가 모달이 열려 있으면 자동 재조회를 건너뛴다', async () => {
    const wrapper = await mountView()
    // ＋ 요청 버튼으로 모달을 띄운다
    for (const btn of wrapper.findAll('button')) {
      if (btn.text().includes('요청') && !btn.classes('tab-btn')) {
        await btn.trigger('click')
        break
      }
    }
    const before = requests.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(requests.mock.calls.length).toBe(before)
  })

  it('API가 실패하면 목업 대신 빈 목록을 보여준다', async () => {
    requests.mockImplementation(() => Promise.reject(new Error('no backend')))
    const wrapper = await mountView()
    await clickTab(wrapper, '보낸 요청')

    expect(wrapper.get('.requests-list').text()).toContain('보낸 요청이 없어요')
  })
})
