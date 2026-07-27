/**
 * 캐치캐치리듬 전용 STOMP 세션.
 *
 * 방 채팅이 이미 열어 둔 연결에 올라탄다(`subscribeRaw`/`publishRaw`) — 연결을 하나 더 열면
 * 재실 추적·토큰 갱신·재연결을 전부 복제해야 한다. 대신 목적지·이벤트 타입 같은 도메인 지식은
 * 전부 이 파일에 두어 공용 컴포저블이 이 게임을 모르게 한다.
 *
 * 서버 시간 보정: RHYTHM_START의 serverNow와 수신 시각의 차이를 offset으로 잡아
 * startAt·endAt을 로컬 시계로 옮긴다. 전원이 같은 순간에 같은 노트를 보게 하는 근거.
 */

import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { RhythmEvent, RhythmLiveRow, RhythmResultEntry } from './rhythmTypes'
import type { Difficulty } from './generator/presets'

interface StompLike {
  connected: Readonly<Ref<boolean>>
  subscribeRaw: (
    destination: string,
    onBody: (body: string) => void,
  ) => { unsubscribe(): void } | null
  publishRaw: (destination: string, body: unknown) => boolean
}

/** RHYTHM_START로 확정된 라운드 정보. 로컬 시계 기준으로 보정된 값이다. */
export interface RhythmRound {
  sessionId: string
  seed: string
  difficulty: Difficulty
  /** 게임 시각 t=0에 해당하는 **로컬** 타임스탬프 (= 서버 serverNow) */
  epochZeroMs: number
  /** 채보 길이 = endAt - serverNow. 전원이 같은 값을 계산한다 */
  durationMs: number
}

export function useRhythmSession(roomChat: StompLike, roomId: Ref<string>) {
  const round = shallowRef<RhythmRound | null>(null)
  const results = shallowRef<RhythmResultEntry[] | null>(null)
  const live = ref<Record<string, RhythmLiveRow>>({})
  /** 서버 시각 - 로컬 시각. 양수면 서버가 앞선다 */
  const clockOffset = ref(0)

  let sub: { unsubscribe(): void } | null = null

  function reset() {
    round.value = null
    results.value = null
    live.value = {}
  }

  function handle(event: RhythmEvent) {
    if (event.type === 'RHYTHM_START') {
      clockOffset.value = event.serverNow - Date.now()
      results.value = null
      live.value = {}
      round.value = {
        sessionId: event.sessionId,
        seed: event.seed,
        difficulty: event.difficulty,
        // 서버의 serverNow 시점을 t=0으로 잡는다 — 카운트다운(서버 countdownSec)과
        // 채보 앞 유예(LEAD_IN)가 같은 3초라 자연스럽게 맞물린다.
        epochZeroMs: event.serverNow - clockOffset.value,
        durationMs: event.endAt - event.serverNow,
      }
      return
    }
    // 지난 세션의 늦게 도착한 프레임은 버린다
    if (!round.value || round.value.sessionId !== event.sessionId) return

    if (event.type === 'PROGRESS') {
      const prev = live.value[event.userId]
      if (prev?.finished) return // 완주 확정 후의 늦은 프레임 무시
      live.value = {
        ...live.value,
        [event.userId]: {
          userId: event.userId,
          nickname: event.nickname,
          score: event.score,
          combo: event.combo,
          finished: false,
        },
      }
      return
    }
    if (event.type === 'PLAYER_FINISHED') {
      live.value = {
        ...live.value,
        [event.userId]: {
          userId: event.userId,
          nickname: event.nickname,
          score: event.score,
          combo: event.maxCombo,
          finished: true,
        },
      }
      return
    }
    if (event.type === 'RHYTHM_END') {
      results.value = event.results
    }
  }

  function subscribe() {
    sub?.unsubscribe()
    sub = roomChat.subscribeRaw(`/topic/rooms/${roomId.value}/rhythm`, (body) => {
      try {
        handle(JSON.parse(body) as RhythmEvent)
      } catch {
        /* 손상된 프레임은 버린다 — 다음 프레임에서 회복 */
      }
    })
  }

  // 연결이 성립하거나 재연결되면(새 Client) 다시 구독한다.
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

  // ── 발행 ──────────────────────────────────────────────

  const start = (difficulty: Difficulty) =>
    roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/start`, { difficulty })

  const sendProgress = (score: number, combo: number) =>
    roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/progress`, { score, combo })

  const sendFinish = (payload: {
    score: number
    maxCombo: number
    perfect: number
    good: number
    miss: number
  }) => roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/finish`, payload)

  return { round, results, live, clockOffset, start, sendProgress, sendFinish, reset }
}
