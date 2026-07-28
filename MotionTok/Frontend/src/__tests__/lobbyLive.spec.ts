/**
 * 로비 실시간 수신 라우터(-148/-149) 테스트.
 *
 * 이 경로는 층이 많고(전역 연결 → 구독 레지스트리 → 봉투 판별 → 화면 갱신) 어긋나도
 * 에러가 아니라 **아무 일도 안 일어남**으로 나타난다. 그래서 "프레임이 들어오면 핸들러가
 * 불리는가"를 명시적으로 못박아 둔다 — 조용한 실패를 잡는 유일한 방법이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { LobbyRoomEvent } from '@/api/types'

/** destination → 등록된 핸들러들. subscribeGlobal을 가로채 프레임을 손으로 밀어 넣는다. */
const registry = new Map<string, Array<(body: string) => void>>()
let memberSession = true

vi.mock('@/composables/useGlobalStomp', () => ({
  isMemberSession: () => memberSession,
  subscribeGlobal: (destination: string, handler: (body: string) => void) => {
    const list = registry.get(destination) ?? []
    list.push(handler)
    registry.set(destination, list)
    return () => {
      const current = registry.get(destination) ?? []
      registry.set(
        destination,
        current.filter((h) => h !== handler),
      )
    }
  },
  onStompConnected: (cb: () => void) => {
    const list = registry.get('__connected') ?? []
    list.push(cb as never)
    registry.set('__connected', list)
    return () => {}
  },
  stompConnected: { value: true },
}))

const { useLobbyLive } = await import('@/composables/useLobbyLive')

/** 컴포넌트 안에서만 쓸 수 있는 컴포저블이라(onBeforeUnmount) 껍데기에 태워 마운트한다. */
function mountWith(handlers: Parameters<typeof useLobbyLive>[0]) {
  return mount(
    defineComponent({
      setup() {
        useLobbyLive(handlers)
        return () => h('div')
      },
    }),
  )
}

function emit(destination: string, payload: unknown) {
  registry.get(destination)?.forEach((handler) => handler(JSON.stringify(payload)))
}

beforeEach(() => {
  registry.clear()
  memberSession = true
})

describe('useLobbyLive — 친구 프레즌스 델타(-149)', () => {
  it('FRIEND 프레임이 오면 핸들러가 userId·presence·방과 함께 불린다', () => {
    const onFriendPresence = vi.fn()
    mountWith({ onFriendPresence })

    emit('/user/queue/presence', {
      type: 'FRIEND',
      intervalSeconds: null,
      userId: 42,
      presence: 'IN_ROOM',
      currentRoomId: 'AB12CD',
    })

    expect(onFriendPresence).toHaveBeenCalledWith({
      userId: 42,
      presence: 'IN_ROOM',
      currentRoomId: 'AB12CD',
    })
  })

  it('오프라인 전이도 그대로 전달된다', () => {
    const onFriendPresence = vi.fn()
    mountWith({ onFriendPresence })

    emit('/user/queue/presence', {
      type: 'FRIEND',
      intervalSeconds: null,
      userId: 7,
      presence: 'OFFLINE',
      currentRoomId: null,
    })

    expect(onFriendPresence).toHaveBeenCalledWith({
      userId: 7,
      presence: 'OFFLINE',
      currentRoomId: null,
    })
  })

  it('같은 큐로 오는 하트비트 간격 정정(BEAT)은 친구 핸들러를 부르지 않는다', () => {
    const onFriendPresence = vi.fn()
    mountWith({ onFriendPresence })

    emit('/user/queue/presence', { type: 'BEAT', intervalSeconds: 20, userId: null, presence: null, currentRoomId: null })

    expect(onFriendPresence).not.toHaveBeenCalled()
  })

  it('게스트는 회원 전용 채널을 구독하지 않는다 — 서버가 연결을 끊기 때문', () => {
    memberSession = false
    const onFriendPresence = vi.fn()
    mountWith({ onFriendPresence })

    expect(registry.get('/user/queue/presence')).toBeUndefined()
  })
})

describe('useLobbyLive — 로비 방 목록 델타(-148)', () => {
  it('배치 배열이 그대로 전달된다', () => {
    const seen: LobbyRoomEvent[][] = []
    const onRoomEvents = vi.fn((events: LobbyRoomEvent[]) => void seen.push(events))
    mountWith({ onRoomEvents })

    emit('/topic/lobby/rooms', [
      { type: 'ROOM_CREATED', roomId: 'AAA111', room: { roomId: 'AAA111' } },
      { type: 'ROOM_CLOSED', roomId: 'BBB222', room: null },
    ])

    expect(onRoomEvents).toHaveBeenCalledTimes(1)
    expect(seen[0]).toHaveLength(2)
  })

  it('빈 배치는 무시한다 — 화면을 흔들 이유가 없다', () => {
    const onRoomEvents = vi.fn()
    mountWith({ onRoomEvents })

    emit('/topic/lobby/rooms', [])

    expect(onRoomEvents).not.toHaveBeenCalled()
  })

  it('형식이 깨진 프레임은 조용히 버린다', () => {
    const onRoomEvents = vi.fn()
    mountWith({ onRoomEvents })

    registry.get('/topic/lobby/rooms')?.forEach((h) => h('{ 깨진 JSON'))

    expect(onRoomEvents).not.toHaveBeenCalled()
  })
})
