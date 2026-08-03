/**
 * 친구 목록의 마지막 접속 시각 (-179).
 *
 * 고정하는 건 <b>언제 그리지 않는가</b>다. 접속 중인 친구 옆에 뜨는 순간 그 숫자는 거짓말이
 * 된다 — 서버가 주는 값은 <b>직전</b> 접속의 종료 시각이라 지금과 무관하기 때문이다.
 * 서버도 온라인이면 비워 보내지만, 실시간 델타로 막 온라인이 된 친구는 프롭이 남아 있을 수
 * 있어 컴포넌트에서도 한 번 더 막는다.
 *
 * 날짜 문구는 오늘·어제만 말로 바꾸고 그보다 오래면 날짜를 쓴다. 경계(자정)를 넘길 때 문구가
 * 바뀌므로 기준 시각을 고정해 두고 검사한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FriendItem from '@/features/lobby/components/FriendItem.vue'
import type { Friend } from '@/features/lobby/data'

/** 기준 "지금" — 2026-08-03(월) 14:00 KST. 자정 경계 판정이 여기에 걸린다. */
const NOW = new Date(2026, 7, 3, 14, 0, 0)

const friend = (online: boolean): Friend => ({
  userId: 2,
  name: '수아',
  face: '🐱',
  game: online ? '로비에서 둘러보는 중' : '오프라인',
  bg: '#fff',
  online,
  avatarUrl: null,
})

const mountItem = (online: boolean, lastSeenAt?: string | null) =>
  mount(FriendItem, { props: { friend: friend(online), lastSeenAt } })

const seenText = (wrapper: ReturnType<typeof mountItem>) =>
  wrapper.find('.last-seen').exists() ? wrapper.find('.last-seen').text() : ''

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('친구 목록 — 마지막 접속 시각', () => {
  it('접속 중인 친구에게는 그리지 않는다 — 직전 접속 시각이라 지금과 무관하다', () => {
    expect(seenText(mountItem(true, '2026-08-03T09:30:00'))).toBe('')
  })

  it('값이 없으면 그리지 않는다 — 배포 이후 한 번도 정산되지 않은 계정', () => {
    expect(seenText(mountItem(false, null))).toBe('')
    expect(seenText(mountItem(false, undefined))).toBe('')
  })

  it('오늘 접속했으면 "오늘 HH:mm"', () => {
    expect(seenText(mountItem(false, '2026-08-03T09:30:00'))).toBe('· 오늘 09:30')
  })

  it('자정 직후도 오늘이다 — 경계를 시각이 아니라 날짜로 가른다', () => {
    expect(seenText(mountItem(false, '2026-08-03T00:01:00'))).toBe('· 오늘 00:01')
  })

  it('어제 접속했으면 "어제 HH:mm" — 24시간 이내가 아니라 날짜 기준이다', () => {
    // 20시간 전이지만 날짜가 어제다. 시간차로 갈랐다면 "오늘"로 잘못 나온다.
    expect(seenText(mountItem(false, '2026-08-02T18:00:00'))).toBe('· 어제 18:00')
  })

  it('그보다 오래되면 날짜를 쓴다 — "5일 전"은 며칠인지 세게 만든다', () => {
    expect(seenText(mountItem(false, '2026-07-28T21:05:00'))).toBe('· 7월 28일 21:05')
  })

  it('형식이 깨진 값은 조용히 넘긴다 — 목록이 통째로 안 그려지는 것보다 낫다', () => {
    expect(seenText(mountItem(false, '알 수 없음'))).toBe('')
  })

  it('상태 문구는 그대로 남는다 — 마지막 접속은 그 옆에 덧붙는 정보다', () => {
    const wrapper = mountItem(false, '2026-08-03T09:30:00')
    expect(wrapper.find('.friend-info small').text()).toContain('오프라인')
  })
})
