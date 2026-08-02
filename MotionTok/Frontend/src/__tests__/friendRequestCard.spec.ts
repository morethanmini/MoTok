/**
 * 받은 친구 요청 카드 (-57).
 *
 * 고정하는 건 <b>잠금 범위</b>다. 응답을 보내는 중인 카드만 잠겨야 한다 — 전부 잠그면
 * 두 장이 떠 있을 때 두 번째 카드를 누른 사람은 아무 반응도 못 보고, 처리된 줄 알거나
 * 고장 났다고 생각한다. 서로 다른 요청이라 동시에 보내도 문제가 없다.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FriendRequestCardStack from '@/features/lobby/components/FriendRequestCardStack.vue'
import type { FriendRequestItem } from '@/api'

const request = (requestId: number, nickname: string): FriendRequestItem => ({
  requestId,
  requesterNickname: nickname,
  addresseeNickname: '나',
  status: 'PENDING',
  createdAt: '2026-08-02T00:00:00Z',
})

const REQUESTS = [request(11, '수아'), request(12, '지훈')]

const mountStack = (busyIds: number[] = []) =>
  mount(FriendRequestCardStack, { props: { requests: REQUESTS, busyIds } })

/** 카드별 [거절, 수락] 버튼의 disabled 여부 */
const disabledMap = (wrapper: ReturnType<typeof mountStack>) =>
  wrapper.findAll('.req-card').map((card) =>
    card.findAll('.req-actions button').map((b) => b.attributes('disabled') !== undefined),
  )

describe('친구 요청 카드', () => {
  it('아무것도 보내는 중이 아니면 전부 누를 수 있다', () => {
    expect(disabledMap(mountStack())).toEqual([
      [false, false],
      [false, false],
    ])
  })

  it('보내는 중인 카드만 잠긴다 — 다른 카드는 그대로 누를 수 있다', () => {
    expect(disabledMap(mountStack([11]))).toEqual([
      [true, true],
      [false, false],
    ])
  })

  it('둘 다 보내는 중이면 둘 다 잠긴다', () => {
    expect(disabledMap(mountStack([11, 12]))).toEqual([
      [true, true],
      [true, true],
    ])
  })

  it('수락·거절·나중에가 각각 그 요청을 실어 보낸다', async () => {
    const wrapper = mountStack()
    const second = wrapper.findAll('.req-card')[1]!

    await second.find('.accept').trigger('click')
    await second.find('.reject').trigger('click')
    await second.find('.req-close').trigger('click')

    expect(wrapper.emitted('accept')?.[0]).toEqual([REQUESTS[1]])
    expect(wrapper.emitted('reject')?.[0]).toEqual([REQUESTS[1]])
    expect(wrapper.emitted('dismiss')?.[0]).toEqual([REQUESTS[1]])
  })

  it('요청이 없으면 아무것도 그리지 않는다 — 빈 자리가 클릭을 먹지 않게', () => {
    const wrapper = mount(FriendRequestCardStack, { props: { requests: [], busyIds: [] } })
    expect(wrapper.find('.req-stack').exists()).toBe(false)
  })
})
