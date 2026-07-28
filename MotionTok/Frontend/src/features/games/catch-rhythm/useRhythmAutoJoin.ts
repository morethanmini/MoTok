/**
 * 방장이 리듬 라운드를 시작하면 **방 전원을 자동으로 입장**시키는 감시자.
 *
 * 왜 따로 필요한가: 리듬 토픽 구독은 CatchRhythmGame이 마운트돼야 시작되는데,
 * 비방장은 게임 화면을 열 이유가 없다(제안만 한다). 그래서 "구독하려면 화면을 열어야 하고,
 * 화면을 열려면 시작 신호를 받아야 하는" 닭-달걀이 생긴다.
 * 이 컴포저블이 **방에 있는 동안 항상** 토픽을 듣고 있다가 시작 신호에 화면을 띄운다.
 *
 * 게임룸은 이 함수만 호출하면 되고 리듬 이벤트 모양은 몰라도 된다.
 */

import { onScopeDispose, watch, type Ref } from 'vue'
import { stashRhythmStart } from './useRhythmSession'
import type { RhythmEvent } from './rhythmTypes'

interface StompLike {
  connected: Readonly<Ref<boolean>>
  subscribeRaw: (
    destination: string,
    onBody: (body: string) => void,
  ) => { unsubscribe(): void } | null
}

export function useRhythmAutoJoin(
  roomChat: StompLike,
  roomId: Ref<string>,
  onRoundStart: () => void,
): void {
  let sub: { unsubscribe(): void } | null = null

  function subscribe() {
    sub?.unsubscribe()
    sub = roomChat.subscribeRaw(`/topic/rooms/${roomId.value}/rhythm`, (body) => {
      try {
        const event = JSON.parse(body) as RhythmEvent
        if (event.type !== 'RHYTHM_START') return
        // 게임 화면은 이 신호를 받고 나서야 열리므로 이 프레임을 직접 받을 수 없다.
        // 마운트된 세션이 꺼내 쓰도록 맡겨 둔 **뒤에** 화면을 연다(순서 중요).
        stashRhythmStart(roomId.value, event)
        onRoundStart()
      } catch {
        /* 손상된 프레임 무시 */
      }
    })
  }

  watch(
    () => roomChat.connected.value,
    (isConnected) => {
      if (isConnected) subscribe()
      else sub = null // 끊긴 구독 핸들은 무효
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    sub?.unsubscribe()
    sub = null
  })
}
