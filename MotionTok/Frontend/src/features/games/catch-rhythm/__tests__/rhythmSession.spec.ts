/**
 * 대전 세션의 STOMP 이벤트 처리 — 특히 **비방장 자동 입장 경로**.
 *
 * STOMP 토픽은 지나간 프레임을 재전송하지 않는다. 비방장은 RHYTHM_START를 받고 나서야
 * 게임 화면을 열기 때문에, 화면 안의 세션 구독은 그 신호를 직접 받을 수 없다.
 * 감시자(useRhythmAutoJoin)가 맡겨 둔 이벤트를 세션이 꺼내 쓰는 흐름을 여기서 고정한다.
 * (이게 깨지면 비방장은 "방장이 시작하기를 기다리는 중"에 영원히 멈춘다 — 실제로 있었던 버그)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'
import { stashRhythmStart, useRhythmSession } from '../useRhythmSession'
import { useRhythmAutoJoin } from '../useRhythmAutoJoin'
import type { RhythmStartEvent } from '../rhythmTypes'

function fakeChat() {
  const connected = ref(true)
  const subs = new Map<string, Set<(body: string) => void>>()
  return {
    connected,
    subscribeRaw(destination: string, onBody: (body: string) => void) {
      const set = subs.get(destination) ?? new Set()
      set.add(onBody)
      subs.set(destination, set)
      return {
        unsubscribe() {
          set.delete(onBody)
        },
      }
    },
    publishRaw: () => true,
    /** 서버가 토픽으로 프레임을 쏜 것처럼 — 지금 구독 중인 콜백에만 전달된다 */
    deliver(destination: string, event: unknown) {
      for (const cb of subs.get(destination) ?? []) cb(JSON.stringify(event))
    },
  }
}

function startEvent(over: Partial<RhythmStartEvent> = {}): RhythmStartEvent {
  return {
    type: 'RHYTHM_START',
    sessionId: 's1',
    seed: '9007199254740993', // 2^53+1 — 문자열 시드 계약 그대로
    difficulty: 'HARD',
    mode: 'ringTap',
    serverNow: 500_000,
    startAt: 503_000,
    endAt: 563_000,
    ...over,
  }
}

describe('비방장 자동 입장 — 마운트 전에 온 RHYTHM_START', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('★ 신호를 받고 나서 열린 화면도 라운드에 들어간다 (수신 시각 기준 시계 보정)', () => {
    const chat = fakeChat()
    const roomId = ref('room-late') as Ref<string>
    let opened = 0

    // 방 수준 감시자만 듣고 있다 — 게임 화면(세션)은 아직 없다
    const roomScope = effectScope()
    roomScope.run(() => useRhythmAutoJoin(chat, roomId, () => opened++))

    chat.deliver('/topic/rooms/room-late/rhythm', startEvent())
    expect(opened).toBe(1)

    // 화면이 900ms 늦게 마운트됐다(비동기 청크 로드) — 그래도 t=0은 수신 시각(10초)이어야 한다
    vi.setSystemTime(10_900)
    const gameScope = effectScope()
    const session = gameScope.run(() => useRhythmSession(chat, roomId))!

    expect(session.round.value).not.toBeNull()
    expect(session.round.value).toMatchObject({
      sessionId: 's1',
      seed: '9007199254740993',
      difficulty: 'HARD',
      mode: 'ringTap',
      epochZeroMs: 10_000,
      durationMs: 63_000,
    })
    expect(session.clockOffset.value).toBe(500_000 - 10_000)

    gameScope.stop()
    roomScope.stop()
  })

  it('끝난 라운드는 꺼내 쓰지 않는다', () => {
    const chat = fakeChat()
    const roomId = ref('room-ended') as Ref<string>
    const roomScope = effectScope()
    roomScope.run(() => useRhythmAutoJoin(chat, roomId, () => {}))
    chat.deliver('/topic/rooms/room-ended/rhythm', startEvent())

    // 라운드 길이 63초를 훌쩍 넘긴 뒤에야 화면이 열렸다
    vi.setSystemTime(10_000 + 63_000 + 1)
    const gameScope = effectScope()
    const session = gameScope.run(() => useRhythmSession(chat, roomId))!
    expect(session.round.value).toBeNull()

    gameScope.stop()
    roomScope.stop()
  })

  it('다른 방의 신호는 꺼내 쓰지 않는다', () => {
    const chat = fakeChat()
    stashRhythmStart('room-other', startEvent())
    const gameScope = effectScope()
    const session = gameScope.run(() => useRhythmSession(chat, ref('room-mine') as Ref<string>))!
    expect(session.round.value).toBeNull()
    gameScope.stop()
  })

  it('이미 구독 중인 세션은 라이브로 받는다 (방장 경로 회귀 방어)', () => {
    const chat = fakeChat()
    const roomId = ref('room-live') as Ref<string>
    const gameScope = effectScope()
    const session = gameScope.run(() => useRhythmSession(chat, roomId))!
    expect(session.round.value).toBeNull()

    chat.deliver('/topic/rooms/room-live/rhythm', startEvent({ sessionId: 's-live' }))
    expect(session.round.value).toMatchObject({ sessionId: 's-live', epochZeroMs: 10_000 })
    gameScope.stop()
  })
})
