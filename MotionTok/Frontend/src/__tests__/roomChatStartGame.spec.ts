/**
 * 게임 시작 발신의 실패 전파 테스트.
 *
 * 시작 요청은 응답이 없는 publish라, 소켓이 끊겨 프레임이 나가지 못해도 예외가 나지 않는다.
 * 그 사실이 호출부까지 전달되지 않으면 화면은 "START를 눌렀는데 아무 일도 안 일어남"이 된다 —
 * 실제로 그렇게 나타났다. 조용한 실패는 테스트로 못박아 두지 않으면 다시 조용해진다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

let publishOk = true
const published: Array<{ destination: string; body: unknown }> = []

vi.mock('@/composables/useGlobalStomp', () => ({
  stompConnected: { value: true },
  subscribeGlobal: () => () => {},
  publishGlobal: (destination: string, body: unknown) => {
    published.push({ destination, body })
    return publishOk
  },
}))

const { useRoomChat } = await import('@/composables/useRoomChat')

/** onScopeDispose를 쓰는 컴포저블이라 컴포넌트 스코프 안에서 만든다. */
function makeChat() {
  let chat!: ReturnType<typeof useRoomChat>
  mount(
    defineComponent({
      setup() {
        chat = useRoomChat()
        return () => h('div')
      },
    }),
  )
  return chat
}

beforeEach(() => {
  publishOk = true
  published.length = 0
})

describe('useRoomChat.startGame', () => {
  it('발행에 성공하면 true를 돌려준다', () => {
    const chat = makeChat()
    void chat.connect('room-1')

    expect(chat.startGame(1)).toBe(true)
    expect(published[published.length - 1]?.destination).toBe('/app/rooms/room-1/game/start')
  })

  it('소켓이 끊겨 발행하지 못하면 false — 호출부가 안내할 수 있어야 한다', () => {
    const chat = makeChat()
    void chat.connect('room-1')
    publishOk = false

    expect(chat.startGame(1)).toBe(false)
  })

  it('방에 입장하지 않은 상태면 발행하지 않고 false', () => {
    const chat = makeChat()

    expect(chat.startGame(1)).toBe(false)
    expect(published).toHaveLength(0)
  })
})
