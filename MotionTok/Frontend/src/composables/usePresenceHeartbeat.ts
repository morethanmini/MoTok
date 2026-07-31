/**
 * 접속 상태 하트비트 — 친구 목록에 내가 온라인으로 보이게 한다(-57).
 *
 * 왜 앱 전역인가 — presence는 "지금 이 사람이 접속해 있나"이므로 특정 화면에 묶일 수 없다.
 * 로비에 있어도, 마이페이지에 있어도 온라인이어야 한다. 그래서 App.vue에서 한 번만 켠다.
 *
 * ## HTTP에서 STOMP로 (-143)
 * 예전에는 20초마다 `POST /presence/heartbeat`를 쳤다. 서버가 실제로 하는 일은 Redis에
 * 필드 두 개를 쓰고 TTL을 미는 것뿐인데, 그 앞뒤로 요청·응답 헤더, JWT 서명 검증,
 * 시큐리티 필터 체인, 디스패처 매핑이 매번 붙었다. 이미 열려 있는 전역 소켓(-142) 위의
 * SEND 프레임으로 옮기면 인증은 CONNECT 때 한 번 끝났고 라우팅은 문자열 매칭뿐이라
 * 그 부대비용이 사라진다.
 *
 * ## 그래도 주기를 없애지 않은 이유
 * "연결됐으니 온라인"으로 단순화하면 두 가지가 함께 깨진다 — presence 키의 TTL(60초)을
 * 아무도 갱신하지 않아 연결이 살아 있어도 오프라인이 되고, 총 접속시간(-141)이
 * "직전 비트와의 간격"을 델타로 쌓는데 그 간격이 사라진다. 비트의 의미는 그대로 두고
 * 전송 수단만 바꿨다.
 *
 * 간격은 여전히 **서버가 알려 준다**. 다만 매번 응답을 받지는 않는다 — 지금 쓰는 간격을
 * 함께 보내고, 서버가 아는 값과 다를 때만 정정 프레임이 온다(정상 상태에서는 응답 0).
 *
 * 백그라운드 탭에서도 계속 보낸다 — 탭을 뒤로 넘겼을 뿐 로그아웃한 게 아니므로 온라인이 맞다.
 * (기기가 절전에 들어가면 타이머가 멈추고 TTL이 만료돼 자연히 오프라인이 된다.)
 */
import { onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import {
  isMemberSession,
  publishGlobal,
  stompConnected,
  subscribeGlobal,
} from './useGlobalStomp'

/** 서버 정정 프레임을 받기 전까지 쓰는 값. 서버 기본값(TTL 60s ÷ 3)과 같다. */
const DEFAULT_INTERVAL_SECONDS = 20

/**
 * 주기에 곱하는 지터 폭(±20%). 20초면 16~24초 사이에서 흔들린다.
 *
 * <p><b>왜 필요한가</b> — 비트는 주기가 고정이라 <b>한 번 몰리면 영원히 몰린다.</b>
 * 2000명이 공지를 보고 비슷한 시각에 접속하거나, 서버가 한 번 넘어져 전원이 동시에 재연결하면
 * 그 뒤로 20초마다 2000건이 같은 순간에 도착한다 — 평균은 100 msg/s인데 실제로는
 * 20초에 한 번 2000건이 몰리는 톱니 모양이 된다.</p>
 *
 * <p>매 주기 다시 뽑으므로 뭉쳐 있던 무리가 시간이 갈수록 저절로 흩어진다.
 * TTL(60초)에 비하면 24초는 충분히 짧아 프레즌스 정확도에는 영향이 없다.</p>
 */
const INTERVAL_JITTER = 0.2

/**
 * 연결 직후 첫 비트를 미루는 폭(ms).
 *
 * <p>재연결은 이미 흩어져 있지만(useGlobalStomp의 백오프 지터) 그 폭이 좁아 무리가 남는다.
 * 여기서 한 번 더 흩는다. TTL이 60초라 최대 2초 지연은 프레즌스에 영향을 주지 않는다.</p>
 */
const CONNECT_BEAT_JITTER_MS = 2_000

const HEARTBEAT_DESTINATION = '/app/presence/heartbeat'
const PRESENCE_QUEUE = '/user/queue/presence'

export function usePresenceHeartbeat() {
  const route = useRoute()
  let timer: ReturnType<typeof setTimeout> | undefined
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS
  let stopped = false

  /** 게임룸에 있을 때만 방 ID가 있다. 이 값이 ONLINE과 IN_ROOM을 가른다. */
  function currentRoomId(): string | null {
    if (route.name !== RouteName.GameRoom) return null
    return (route.query.room as string) || null
  }

  function schedule() {
    clearTimeout(timer)
    if (stopped) return
    // 매 주기 지터를 다시 뽑는다 — 고정 주기면 한 번 몰린 무리가 영원히 몰린 채로 남는다.
    const jitter = 1 + (Math.random() * 2 - 1) * INTERVAL_JITTER
    timer = setTimeout(beat, Math.round(intervalSeconds * 1000 * jitter))
  }

  function beat() {
    clearTimeout(timer)
    if (stopped) return
    // 게스트는 프레즌스 대상이 아니다 — RDB에 없어 친구를 가질 수 없고, 서버도 거절한다.
    // 연결 자체는 게스트도 하므로(1인방 게임 이벤트) 여기서 걸러야 한다.
    if (!isMemberSession()) return
    // 연결이 끊겨 있으면 보낼 곳이 없다 — 재연결되면 onStompConnected가 즉시 한 번 친다.
    publishGlobal(HEARTBEAT_DESTINATION, {
      roomId: currentRoomId(),
      intervalSeconds,
    })
    schedule()
  }

  const unsubscribe = subscribeGlobal(PRESENCE_QUEUE, (body) => {
    try {
      const message = JSON.parse(body) as { type?: string; intervalSeconds?: number }
      if (message.type !== 'BEAT' || !message.intervalSeconds) return
      // 서버 TTL이 바뀌면 여기로 정정이 온다. 프론트가 상수를 들고 있으면 비트가 TTL보다
      // 느려져 친구 목록에서 깜빡이는데, 그 경우를 서버가 알아서 막아 준다.
      intervalSeconds = Math.max(1, message.intervalSeconds)
      schedule()
    } catch {
      // 형식 오류 프레임은 무시
    }
  })

  // 연결이 성립하는 순간마다 즉시 한 번 — 첫 연결과 재연결 모두. 예전에는
  // onStompConnected(재연결 전용 훅)만 걸어서 새로고침 후 <b>첫 연결에는 비트가 영영 시작되지
  // 않았다</b>(-164): 소켓은 살아 있는데 아무도 beat를 안 불러 60초 뒤 TTL 만료로 조용히
  // 오프라인이 됐고, 다음 재연결에 온라인으로 돌아와 친구 목록이 널뛰었다.
  // 즉시 치지 않고 아주 조금 미룬다 — 서버가 넘어졌다 살아나면 접속자 전원이 거의 같은 순간에
  // 붙고, 그 자리에서 바로 치면 재연결 직후에 비트 2000건이 한꺼번에 도착한다.
  // (첫 연결에도 반드시 시작돼야 한다 — 안 그러면 60초 TTL로 조용히 오프라인이 된다, -164)
  watch(stompConnected, (connected) => {
    if (!connected) return
    clearTimeout(timer)
    timer = setTimeout(beat, Math.round(Math.random() * CONNECT_BEAT_JITTER_MS))
  }, { immediate: true })

  // 방에 들어가거나 나오는 순간을 최대 한 주기(20초)나 기다리게 하지 않는다.
  watch(currentRoomId, () => {
    if (stompConnected.value) beat()
  })

  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
    unsubscribe()
  })
}
