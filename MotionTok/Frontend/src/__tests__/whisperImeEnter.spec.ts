/**
 * 귓속말 Enter 전송과 한글 IME (-178).
 *
 * macOS IME는 조합 중 Enter에서 keydown을 두 번 낸다 — 조합을 커밋하는 것(isComposing,
 * 레거시 keyCode 229)과 진짜 Enter. 가드가 없으면 <b>귓속말이 두 번 발행된다.</b>
 *
 * 서버는 두 발행을 각각 다른 whisperId로 쌓기 때문에 useWhisper의 whisperId 중복 제거가
 * 이걸 잡지 못한다. 즉 이 가드가 유일한 방어선이라 테스트로 박아 둔다 — 같은 버그가
 * 대기실 채팅(GameRoomView.sendOnEnter)에서 한 번 났고 귓속말에서 또 났다.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WhisperModal from '@/components/common/WhisperModal.vue'

const mountModal = () =>
  mount(WhisperModal, {
    props: { nickname: '수아', messages: [], connected: true },
  })

/** 입력칸에 글자를 넣고 Enter keydown을 한 번 보낸다. */
async function typeThenEnter(
  wrapper: ReturnType<typeof mountModal>,
  text: string,
  event: Partial<KeyboardEvent> = {},
) {
  const input = wrapper.find('.composer input')
  await input.setValue(text)
  await input.trigger('keydown.enter', event)
}

/**
 * 레거시 `keyCode`는 KeyboardEvent.prototype의 getter라 trigger 옵션으로 얹히지 않는다
 * (조용히 무시돼 가드를 태우지 못한다). 그 경로를 검사하려면 이벤트를 직접 만들어야 한다.
 */
async function dispatchEnter(
  wrapper: ReturnType<typeof mountModal>,
  text: string,
  init: KeyboardEventInit,
) {
  const input = wrapper.find('.composer input')
  await input.setValue(text)
  input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }))
  await wrapper.vm.$nextTick()
}

describe('귓속말 Enter 전송 — 한글 IME', () => {
  it('조합을 커밋하는 Enter는 보내지 않는다 (isComposing)', async () => {
    const wrapper = mountModal()
    await typeThenEnter(wrapper, '안녕', { isComposing: true })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('조합을 커밋하는 Enter는 보내지 않는다 (레거시 keyCode 229)', async () => {
    const wrapper = mountModal()
    await dispatchEnter(wrapper, '안녕', { keyCode: 229 })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('진짜 Enter는 keyCode 13으로 와도 보낸다 — 229만 걸러야 한다', async () => {
    const wrapper = mountModal()
    await dispatchEnter(wrapper, '안녕', { keyCode: 13 })

    expect(wrapper.emitted('send')).toEqual([['안녕']])
  })

  it('조합이 끝난 진짜 Enter는 한 번 보낸다', async () => {
    const wrapper = mountModal()
    await typeThenEnter(wrapper, '안녕')

    expect(wrapper.emitted('send')).toEqual([['안녕']])
  })

  it('macOS 한글 입력 흐름 전체 — 커밋 Enter + 진짜 Enter로 두 번 오지만 한 번만 나간다', async () => {
    const wrapper = mountModal()
    const input = wrapper.find('.composer input')
    await input.setValue('안녕')
    await input.trigger('keydown.enter', { isComposing: true, keyCode: 229 })
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('보낸 뒤 입력칸을 비워 같은 말이 다시 나가지 않게 한다', async () => {
    const wrapper = mountModal()
    await typeThenEnter(wrapper, '안녕')
    await wrapper.find('.composer input').trigger('keydown.enter')

    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('연결이 끊겨 있으면 Enter로도 보내지 않는다', async () => {
    const wrapper = mount(WhisperModal, {
      props: { nickname: '수아', messages: [], connected: false },
    })
    await typeThenEnter(wrapper, '안녕')

    expect(wrapper.emitted('send')).toBeUndefined()
  })
})
