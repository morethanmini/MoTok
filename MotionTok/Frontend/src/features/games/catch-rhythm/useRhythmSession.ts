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
import type { RhythmEvent, RhythmLiveRow, RhythmResultEntry, RhythmStartEvent } from './rhythmTypes'
import { DIFFICULTIES, type Difficulty } from './generator/presets'
import type { GameMode } from './core/types'

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
  /** 시드 생성 경로용 — 곡 라운드의 수제 난이도(MANUAL 등)는 HARD로 접힌다(스테이지가 안 씀) */
  difficulty: Difficulty
  /** 서버가 에코한 원문 — 곡 라운드의 결과 화면 등 표시용 */
  difficultyLabel: string
  mode: GameMode
  /** 곡 지정 라운드(-168)의 번들 채보 id. null이면 기존 시드 채보 */
  song: string | null
  /** 게임 시각 t=0에 해당하는 **로컬** 타임스탬프 (= 서버 serverNow) */
  epochZeroMs: number
  /** 채보 길이 = endAt - serverNow. 전원이 같은 값을 계산한다 */
  durationMs: number
}

/** 곡 라운드의 수제 난이도(MANUAL/EXTREME)는 시드 생성 타입에 없다 — 표시용과 분리해 접는다 */
function toStageDifficulty(d: string): Difficulty {
  return (DIFFICULTIES as string[]).includes(d) ? (d as Difficulty) : 'HARD'
}

/**
 * 게임 화면이 뜨기 **전에** 도착한 RHYTHM_START 버퍼.
 *
 * 비방장은 시작 신호를 받고 나서야 게임 화면을 여는데(자동 입장), STOMP 토픽은 지나간
 * 프레임을 재전송하지 않는다 — 화면이 열린 뒤에 구독한 세션은 그 신호를 영영 못 받고
 * "방장이 시작하기를 기다리는 중"에 멈춘다. 그래서 방에 있는 동안 항상 듣고 있는
 * 감시자(useRhythmAutoJoin)가 여기에 이벤트를 맡겨 두고, 세션이 만들어질 때
 * 같은 방 + 아직 진행 중인 라운드면 꺼내 쓴다.
 *
 * ⚠️ <b>한 번만 꺼내 쓴다.</b> 이건 "화면이 신호보다 늦게 열리는" 한 순간을 잇는 다리이지
 * 라운드 상태의 사본이 아니다. 소비 후에도 남겨 두면, 라운드가 끝나기 전에 게임을 닫았다
 * 다시 열었을 때 같은 신호를 또 꺼내 쓴다 — 시작을 누르지도 않았는데 화면이 "진행 중"으로
 * 열리고, 서버 세션은 이미 지워진 뒤라 점수도 올라가지 않는다.
 */
let stashedStart: { roomId: string; event: RhythmStartEvent; receivedAtMs: number } | null = null

export function stashRhythmStart(roomId: string, event: RhythmStartEvent): void {
  stashedStart = { roomId, event, receivedAtMs: Date.now() }
}

/**
 * 맡겨 둔 신호를 꺼내면서 지운다. 꺼낼 게 없거나 다른 방 것이면 null.
 * 읽기와 지우기를 나누면 "꺼내 놓고 안 지우는" 경로가 생긴다 — 그게 위 버그였다.
 */
function takeRhythmStart(roomId: string) {
  if (!stashedStart || stashedStart.roomId !== roomId) return null
  const taken = stashedStart
  stashedStart = null
  return taken
}

/**
 * 라운드가 끝났으니 맡겨 둔 신호도 버린다(RHYTHM_END·RHYTHM_ABORTED).
 * 화면을 한 번도 열지 않아 아무도 꺼내 가지 않은 신호가 남는 경우를 위한 것이다.
 */
export function clearRhythmStart(roomId: string): void {
  if (stashedStart?.roomId === roomId) stashedStart = null
}

export function useRhythmSession(roomChat: StompLike, roomId: Ref<string>) {
  const round = shallowRef<RhythmRound | null>(null)
  const results = shallowRef<RhythmResultEntry[] | null>(null)
  /** 정산 대기(-187) — 서버가 미제출 참가자의 재접속을 기다리는 중. null이면 대기 아님 */
  const waiting = shallowRef<{ nicknames: string[]; waitUntil: number } | null>(null)
  const live = ref<Record<string, RhythmLiveRow>>({})
  /** 서버 시각 - 로컬 시각. 양수면 서버가 앞선다 */
  const clockOffset = ref(0)

  let sub: { unsubscribe(): void } | null = null

  /**
   * 재전송 대기 중인 최종 제출(-187).
   *
   * 제출은 STOMP 발행 한 번뿐이라 그 순간 연결이 끊겨 있으면 조용히 유실됐고, 서버는
   * 이 참가자를 0점 미완주로 정산했다 — 2분 플레이가 통째로 날아가는 경로. 서버가
   * 재접속 유예 동안 기다려 줘도(RHYTHM_WAITING) 클라이언트가 다시 보내지 않으면
   * 의미가 없으므로, 정산 확인(RHYTHM_END·ABORTED)이 올 때까지 주기 재전송한다.
   * 서버 저장이 HSETNX 멱등이라 중복 발송은 안전하다(최초 1회만 수리).
   */
  let pendingFinish: Record<string, number> | null = null
  let finishRetryTimer: number | null = null
  let finishRetryLeft = 0
  const FINISH_RETRY_MS = 3_000
  /** 서버 대기 상한(endAt+1.5s+10s)을 여유 있게 덮고 멈춘다 — 정산 신호를 영영 못 받아도 무한 재전송은 없다 */
  const FINISH_RETRY_MAX = 8

  function stopFinishRetry() {
    pendingFinish = null
    finishRetryLeft = 0
    if (finishRetryTimer !== null) {
      clearInterval(finishRetryTimer)
      finishRetryTimer = null
    }
  }

  function reset() {
    round.value = null
    results.value = null
    waiting.value = null
    live.value = {}
    stopFinishRetry()
  }

  /**
   * @param receivedAtMs 이벤트를 **수신한** 로컬 시각. 버퍼에서 꺼낸 이벤트를 지금 시각으로
   *        처리하면 화면이 늦게 열린 만큼 t=0이 밀려 전원의 노트 타이밍이 어긋난다.
   */
  function handle(event: RhythmEvent, receivedAtMs = Date.now()) {
    if (event.type === 'RHYTHM_START') {
      // 이 세션이 신호를 직접 받았으니 다리(맡겨 둔 사본)는 필요 없다.
      // 방장은 화면을 먼저 열고 시작을 눌러 늘 이 경로로 들어오는데, 감시자는 같은 프레임을
      // 맡겨 두기만 하고 아무도 꺼내 가지 않아 그 사본이 남았다 — 닫았다 다시 열면 그게
      // 되살아나 "진행 중"으로 열렸다.
      clearRhythmStart(roomId.value)
      clockOffset.value = event.serverNow - receivedAtMs
      results.value = null
      waiting.value = null
      live.value = {}
      stopFinishRetry() // 새 라운드 — 지난 라운드 제출 재전송은 의미가 없다
      round.value = {
        sessionId: event.sessionId,
        seed: event.seed,
        difficulty: toStageDifficulty(event.difficulty),
        difficultyLabel: event.difficulty,
        mode: event.mode ?? 'catch',
        song: event.song ?? null,
        // 서버의 serverNow 시점을 t=0으로 잡는다(로컬로는 수신 시각). 채보 앞 유예
        // LEAD_IN이 카운트다운을 겸하므로 전원이 같은 순간에 첫 노트를 본다.
        epochZeroMs: receivedAtMs,
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
    // 정산 대기(-187) — 잠깐 끊긴 참가자를 기다리는 중. 재확인마다 명단이 갱신된다
    if (event.type === 'RHYTHM_WAITING') {
      waiting.value = { nicknames: event.waitingNicknames ?? [], waitUntil: event.waitUntil }
      return
    }
    if (event.type === 'RHYTHM_END') {
      results.value = event.results
      waiting.value = null
      stopFinishRetry() // 정산 확정 — 더 보낼 이유가 없다
    }
    // 방장 강제종료(-164) — 정산이 없으니 결과를 띄우지 않고 라운드만 접는다
    if (event.type === 'RHYTHM_ABORTED') {
      reset()
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
    stopFinishRetry()
  })

  // 구독 전에 도착해 놓친 RHYTHM_START가 있으면 그걸로 라운드를 연다.
  // 수신 시각 기준으로 시계를 보정하므로 화면이 늦게 열려도 t=0이 어긋나지 않고,
  // 라운드 중간이면 Stage가 그 시각부터 이어서 진행한다.
  // 꺼내는 순간 버려진다 — 다음 번에 화면을 열 때 다시 꺼내 쓰면 안 된다(위 주석 참고).
  const stashed = takeRhythmStart(roomId.value)
  if (stashed) {
    const { event, receivedAtMs } = stashed
    const stillRunning = Date.now() < receivedAtMs + (event.endAt - event.serverNow)
    if (stillRunning) handle(event, receivedAtMs)
  }

  // ── 발행 ──────────────────────────────────────────────

  const start = (
    difficulty: string,
    mode: GameMode,
    song?: { id: string; durationSec: number },
  ) =>
    roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/start`, {
      difficulty,
      mode,
      song: song?.id ?? null,
      durationSec: song?.durationSec ?? null,
    })

  const sendProgress = (score: number, combo: number) =>
    roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/progress`, { score, combo })

  const sendFinish = (payload: {
    score: number
    maxCombo: number
    perfect: number
    good: number
    miss: number
  }) => {
    // 발행 실패(잠깐 끊김)에 대비해 보관하고 주기 재전송한다 — 재연결되면 publishRaw가
    // 다시 통과한다. RHYTHM_END·ABORTED·새 라운드·화면 정리에서 멈춘다.
    pendingFinish = payload
    finishRetryLeft = FINISH_RETRY_MAX
    if (finishRetryTimer === null) {
      finishRetryTimer = window.setInterval(() => {
        if (!pendingFinish || finishRetryLeft <= 0) {
          stopFinishRetry()
          return
        }
        finishRetryLeft -= 1
        roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/finish`, pendingFinish)
      }, FINISH_RETRY_MS)
    }
    return roomChat.publishRaw(`/app/rooms/${roomId.value}/rhythm/finish`, payload)
  }

  return { round, results, waiting, live, clockOffset, start, sendProgress, sendFinish, reset }
}
