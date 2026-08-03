/**
 * 프로필 모달의 최근 접속 시각 (-179).
 *
 * 처음엔 친구 목록 아이템에 붙였다가 프로필 모달(닉네임 밑)로 옮겼다. 목록에서는 프레즌스를
 * 들고 있어 "오프라인일 때만" 걸렀지만, 프로필 조회는 프레즌스를 보지 않는다 — 여기서는
 * <b>가입일·총 접속시간과 같은 성격의 기록</b>으로 취급해 접속 여부를 가리지 않고 보여준다.
 *
 * 고정하는 건 두 가지다. <b>값이 없으면 줄 자체가 없다</b>(조회 전·실패·미정산 계정에서
 * 빈 줄이 생기면 아래 카드가 밀린다), 그리고 <b>날짜 경계는 자정 기준</b>이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import UserProfileModal from '@/components/common/UserProfileModal.vue'
import type { PublicUserProfile } from '@/api'

/** 기준 "지금" — 2026-08-03(월) 14:00 KST. 자정 경계 판정이 여기에 걸린다. */
const NOW = new Date(2026, 7, 3, 14, 0, 0)

const profile = (lastSeenAt?: string | null): PublicUserProfile => ({
  id: 2,
  nickname: '히주',
  createdAt: '2026-07-22T10:00:00',
  avatarUrl: null,
  totalConnectSeconds: 77_880,
  lastSeenAt,
})

const mountModal = (p: PublicUserProfile | null) =>
  mount(UserProfileModal, {
    props: { userId: 2, profile: p, nickname: '히주', loading: false, error: '' },
    global: {
      plugins: [createPinia()],
      stubs: { PixelModal: { template: '<div><slot /></div>' }, ReportDialog: true },
    },
  })

const seenText = (wrapper: ReturnType<typeof mountModal>) =>
  wrapper.find('.last-seen').exists() ? wrapper.find('.last-seen').text() : ''

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('프로필 모달 — 최근 접속', () => {
  it('오늘 접속했으면 "오늘 HH:mm"', () => {
    expect(seenText(mountModal(profile('2026-08-03T09:30:00')))).toBe('최근 접속 · 오늘 09:30')
  })

  it('자정 직후도 오늘이다 — 경계를 시각이 아니라 날짜로 가른다', () => {
    expect(seenText(mountModal(profile('2026-08-03T00:01:00')))).toBe('최근 접속 · 오늘 00:01')
  })

  it('어제 접속했으면 "어제 HH:mm" — 24시간 이내가 아니라 날짜 기준이다', () => {
    // 20시간 전이지만 날짜가 어제다. 시간차로 갈랐다면 "오늘"로 잘못 나온다.
    expect(seenText(mountModal(profile('2026-08-02T18:00:00')))).toBe('최근 접속 · 어제 18:00')
  })

  it('그보다 오래되면 날짜를 쓴다 — "5일 전"은 며칠인지 세게 만든다', () => {
    expect(seenText(mountModal(profile('2026-07-28T21:05:00')))).toBe('최근 접속 · 2026.7.28 21:05')
  })

  it('접속 여부를 가리지 않는다 — 여기서는 가입일과 같은 성격의 기록이다', () => {
    // 프로필 응답에는 프레즌스가 없다. 온라인이어도 서버가 준 값을 그대로 보여준다.
    expect(seenText(mountModal(profile('2026-08-03T13:59:00')))).toBe('최근 접속 · 오늘 13:59')
  })

  it('기록이 없으면 줄 자체를 만들지 않는다 — 빈 줄이 아래 카드를 밀지 않게', () => {
    expect(mountModal(profile(null)).find('.last-seen').exists()).toBe(false)
    expect(mountModal(profile(undefined)).find('.last-seen').exists()).toBe(false)
  })

  it('조회 전(profile=null)에도 줄을 만들지 않는다', () => {
    expect(mountModal(null).find('.last-seen').exists()).toBe(false)
  })

  it('형식이 깨진 값은 조용히 넘긴다 — 모달이 통째로 안 뜨는 것보다 낫다', () => {
    expect(mountModal(profile('알 수 없음')).find('.last-seen').exists()).toBe(false)
  })

  it('닉네임 바로 밑에 온다 — 가입일 카드보다 앞', () => {
    const wrapper = mountModal(profile('2026-08-03T09:30:00'))
    const html = wrapper.html()
    expect(html.indexOf('히주')).toBeLessThan(html.indexOf('최근 접속'))
    expect(html.indexOf('최근 접속')).toBeLessThan(html.indexOf('가입일'))
  })
})
