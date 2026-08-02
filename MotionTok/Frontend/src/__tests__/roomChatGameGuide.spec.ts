/**
 * 게임 설명 함께 보기 채널 테스트.
 *
 * 이 기능의 핵심은 "방장이 넘긴 장이 방 전원에게 그대로 간다"인데, 서버는 이벤트가 아니라
 * 매번 전체 상태를 보낸다(BE GameGuideEvent). 그 계약이 깨지면 — 예를 들어 열기/넘김을
 * 따로 보내기 시작하면 — 프레임 하나만 놓쳐도 방마다 다른 장이 열린 채 갈린다.
 * 발신 목적지와 수신 반영을 여기서 못박아 둔다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const published: Array<{ destination: string; body: unknown }> = []
/** 구독 목적지 → 프레임을 흘려 넣는 핸들러. 서버가 보내는 상황을 흉내 낸다. */
const handlers = new Map<string, (body: string) => void>()

vi.mock('@/composables/useGlobalStomp', () => ({
  stompConnected: { value: true },
  subscribeGlobal: (destination: string, onBody: (body: string) => void) => {
    handlers.set(destination, onBody)
    return () => handlers.delete(destination)
  },
  publishGlobal: (destination: string, body: unknown) => {
    published.push({ destination, body })
    return true
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
  published.length = 0
  handlers.clear()
})

describe('useRoomChat 게임 설명 함께 보기', () => {
  it('열기·넘김·닫기를 모두 같은 목적지에 전체 상태로 보낸다', () => {
    const chat = makeChat()
    void chat.connect('room-1')

    chat.sendGameGuide(true, 1, 0)
    chat.sendGameGuide(true, 1, 3)
    chat.sendGameGuide(false, null, 0)

    expect(published.map((p) => p.destination)).toEqual([
      '/app/rooms/room-1/guide',
      '/app/rooms/room-1/guide',
      '/app/rooms/room-1/guide',
    ])
    // 페이지만 보내는 프레임이 있으면 안 된다 — 놓쳤을 때 복구할 수 없다.
    expect(published.map((p) => p.body)).toEqual([
      { open: true, gameId: 1, page: 0 },
      { open: true, gameId: 1, page: 3 },
      { open: false, gameId: null, page: 0 },
    ])
  })

  it('방 토픽으로 온 상태가 그대로 반영된다 — 마지막 것만 남는다', () => {
    const chat = makeChat()
    void chat.connect('room-1')

    handlers.get('/topic/rooms/room-1/guide')?.(JSON.stringify({ open: true, gameId: 2, page: 0 }))
    expect(chat.gameGuide.value).toEqual({ open: true, gameId: 2, page: 0 })

    handlers.get('/topic/rooms/room-1/guide')?.(JSON.stringify({ open: true, gameId: 2, page: 4 }))
    expect(chat.gameGuide.value).toEqual({ open: true, gameId: 2, page: 4 })
  })

  it('늦게 들어온 사람의 sync 회신(개인 큐)도 같은 상태로 반영된다', () => {
    const chat = makeChat()
    void chat.connect('room-1')

    chat.requestGameGuideSync()
    expect(published[published.length - 1]?.destination).toBe('/app/rooms/room-1/guide/sync')

    // 회신은 방 토픽이 아니라 개인 큐로 온다 — 이걸 구독하지 않으면 혼자 못 본다.
    handlers.get('/user/queue/game-guide')?.(JSON.stringify({ open: true, gameId: 11, page: 2 }))
    expect(chat.gameGuide.value).toEqual({ open: true, gameId: 11, page: 2 })
  })

  it('방을 옮기면 앞 방의 설명 상태가 남지 않는다', () => {
    const chat = makeChat()
    void chat.connect('room-1')
    handlers.get('/topic/rooms/room-1/guide')?.(JSON.stringify({ open: true, gameId: 1, page: 1 }))

    void chat.connect('room-2')

    expect(chat.gameGuide.value).toBeNull()
  })

  it('방에 입장하지 않은 상태면 발신하지 않는다', () => {
    const chat = makeChat()

    chat.sendGameGuide(true, 1, 0)
    chat.requestGameGuideSync()

    expect(published).toHaveLength(0)
  })
})
