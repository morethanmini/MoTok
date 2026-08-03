/**
 * 방 만들기 기본 제목 (-175).
 *
 * 고정하는 건 <b>보이는 이름과 만들어지는 이름이 같다</b>는 것이다. placeholder에 띄운 이름과
 * 다른 값을 보내면 유저는 자기가 짓지 않은 방 이름을 보고 버그로 읽는다.
 *
 * 그리고 <b>수정 모드에는 적용되지 않는다</b>. 방 설정 수정은 같은 모달을 재사용하는데,
 * 거기서 제목을 지웠을 때 랜덤 이름으로 바뀌면 이름을 고치려던 사람이 엉뚱한 방을 갖게 된다.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CreateRoomModal, { type NewRoom } from '@/features/lobby/components/CreateRoomModal.vue'

/** 제출 버튼(두 번째 액션 버튼)을 눌러 create로 나간 payload를 돌려준다. */
async function submit(wrapper: ReturnType<typeof mount>) {
  await wrapper.findAll('.modal-actions button')[1]!.trigger('click')
  return wrapper.emitted('create')?.[0]?.[0] as NewRoom
}

const placeholderOf = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('.title-field input').attributes('placeholder')

describe('방 만들기 기본 제목', () => {
  it('제목을 비우고 만들면 placeholder에 보이던 이름 그대로 나간다', async () => {
    const wrapper = mount(CreateRoomModal)

    expect(await submit(wrapper)).toMatchObject({ title: placeholderOf(wrapper) })
  })

  it('공백만 넣어도 기본 제목으로 채운다 — 서버 @NotBlank에 걸리지 않게', async () => {
    const wrapper = mount(CreateRoomModal)
    await wrapper.find('.title-field input').setValue('   ')

    expect(await submit(wrapper)).toMatchObject({ title: placeholderOf(wrapper) })
  })

  it('직접 쓴 제목은 건드리지 않는다', async () => {
    const wrapper = mount(CreateRoomModal)
    await wrapper.find('.title-field input').setValue('상민이의 방')

    expect(await submit(wrapper)).toMatchObject({ title: '상민이의 방' })
  })

  it('기본 제목은 서버 @Size(max = 30) 안에 들어온다', () => {
    // 후보를 직접 열 수 없으니 여러 번 열어 뽑히는 이름들을 본다.
    const picked = new Set(
      Array.from({ length: 200 }, () => placeholderOf(mount(CreateRoomModal))!),
    )
    expect(picked.size).toBeGreaterThan(1) // 고정값이 아니라 실제로 랜덤이다
    for (const t of picked) expect(t.length).toBeLessThanOrEqual(30)
  })

  it('수정 모드에서는 기본 제목을 쓰지 않는다 — 지운 제목이 랜덤 이름으로 바뀌지 않는다', async () => {
    const initial: NewRoom = { title: '원래 방 이름', visibility: '공개', max: '6' }
    const wrapper = mount(CreateRoomModal, { props: { initial } })
    await wrapper.find('.title-field input').setValue('')

    // 빈 제목은 서버가 어차피 거절한다(@NotBlank). 보내지 않고 버튼을 잠근다 —
    // 보내면 `title: 공백일 수 없습니다.`가 그대로 토스트에 뜬다.
    expect(await submit(wrapper)).toBeUndefined()
    expect(wrapper.findAll('.modal-actions button')[1]!.attributes('disabled')).toBeDefined()
  })

  it('수정 모드라도 제목이 있으면 저장할 수 있다', async () => {
    const initial: NewRoom = { title: '원래 방 이름', visibility: '공개', max: '6' }
    const wrapper = mount(CreateRoomModal, { props: { initial } })
    await wrapper.find('.title-field input').setValue('바꾼 방 이름')

    expect(await submit(wrapper)).toMatchObject({ title: '바꾼 방 이름' })
  })

  it('생성 모드에서는 비워도 제출 버튼이 잠기지 않는다 — 기본 제목이 채우므로', async () => {
    const wrapper = mount(CreateRoomModal)
    await wrapper.find('.title-field input').setValue('')

    expect(wrapper.findAll('.modal-actions button')[1]!.attributes('disabled')).toBeUndefined()
  })
})
