/**
 * 친구 한 줄에서 누르는 자리가 갈린다 — 동그라미는 프로필(-96), 이름은 귓속말(-150).
 *
 * 구조도 함께 고정한다. 바깥 박스에 role="button"을 주면 그 안의 프로필 버튼이
 * "button 안의 포커스 가능한 자손"이 되어 스크린리더가 구조를 잘못 읽는다. 눈에 보이지 않는
 * 회귀라 클릭 테스트만으로는 다시 들어와도 알 수 없다.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FriendItem from '@/features/lobby/components/FriendItem.vue'
import type { Friend } from '@/features/lobby/data'

const FRIEND: Friend = {
  userId: 7,
  name: '수아',
  face: '🐰',
  bg: '#fff',
  game: '로비에 있어요',
  online: true,
  avatarUrl: null,
}

const mountItem = (unread?: number) => mount(FriendItem, { props: { friend: FRIEND, unread } })

describe('FriendItem 누르는 자리', () => {
  it('동그라미는 프로필, 이름은 귓속말', async () => {
    const wrapper = mountItem()

    await wrapper.find('.face-frame').trigger('click')
    expect(wrapper.emitted('profile')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()

    await wrapper.find('.friend-info').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('profile')).toHaveLength(1) // 늘지 않았다
  })

  it('박스 아무 데나 눌러도 귓속말 — 마우스 편의는 유지한다', async () => {
    const wrapper = mountItem()

    await wrapper.find('.friend').trigger('click')

    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('profile')).toBeUndefined()
  })

  it('두 동작 모두 키보드로 닿는다 — 각자 버튼이라 Enter가 그냥 먹는다', () => {
    const wrapper = mountItem()

    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b.attributes('type')).toBe('button')
  })

  it('바깥 박스는 button 역할이 아니다 — 안에 버튼이 들어 있다', () => {
    const wrapper = mountItem()
    const box = wrapper.find('.friend')

    expect(box.attributes('role')).toBeUndefined()
    expect(box.attributes('tabindex')).toBeUndefined()
    // 그 대신 안쪽 버튼들이 포커스를 받는다
    expect(box.findAll('button').length).toBe(2)
  })

  it('안 읽은 말이 있으면 개수를 띄운다', () => {
    expect(mountItem(3).find('.unread').text()).toBe('3')
    expect(mountItem(12).find('.unread').text()).toBe('9+')
    expect(mountItem(0).find('.unread').exists()).toBe(false)
  })
})
