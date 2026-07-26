/**
 * 접속 상태 하트비트 — 친구 목록에 내가 온라인으로 보이게 한다(-57).
 *
 * 왜 앱 전역인가 — presence는 "지금 이 사람이 접속해 있나"이므로 특정 화면에 묶일 수 없다.
 * 로비에 있어도, 마이페이지에 있어도 온라인이어야 한다. 그래서 App.vue에서 한 번만 켠다.
 *
 * 왜 STOMP가 아닌가 — 프론트의 STOMP 클라이언트는 게임룸에서만 연결된다(useRoomChat).
 * 연결 여부로 판정하면 로비에 있는 사용자가 오프라인으로 보여 ONLINE 상태를 표현할 수 없다.
 *
 * 간격은 <b>서버가 응답으로 알려준다</b>. 프론트가 상수로 들고 있으면 서버 TTL만 바뀌었을 때
 * 하트비트가 TTL보다 느려져 친구 목록에서 깜빡인다.
 *
 * 백그라운드 탭에서도 계속 보낸다 — 탭을 뒤로 넘겼을 뿐 로그아웃한 게 아니므로 온라인이 맞다.
 * (기기가 절전에 들어가면 타이머가 멈추고 TTL이 만료돼 자연히 오프라인이 된다.)
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { presenceApi } from '@/api'
import { readAccessClaims } from '@/api/token'
import { RouteName } from '@/router/routeNames'

/** 서버 응답을 못 받았을 때 다시 시도할 간격. 회원이 아닐 때의 재확인 주기도 겸한다. */
const FALLBACK_MS = 20_000
/**
 * 연속 실패 시 간격을 늘려 가는 상한(5분).
 *
 * 백오프가 없으면 프레즌스 엔드포인트가 죽은 동안 접속자 전원이 20초마다 영구히 재시도한다 —
 * 장애 중인 서버에 가장 필요 없는 부하다. 대신 완전히 멈추지도 않는다(멈추면 서버가 살아나도
 * 아무도 온라인으로 돌아오지 못한다).
 */
const MAX_BACKOFF_MS = 5 * 60_000

export function usePresenceHeartbeat() {
  const route = useRoute()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let failures = 0

  /** 게임룸에 있을 때만 방 ID가 있다. 이 값이 ONLINE과 IN_ROOM을 가른다. */
  function currentRoomId(): string | null {
    if (route.name !== RouteName.GameRoom) return null
    return (route.query.room as string) || null
  }

  function schedule(delayMs: number) {
    clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(() => void beat(), delayMs)
  }

  async function beat() {
    clearTimeout(timer)
    if (stopped) return

    // 게스트는 RDB에 없어 친구를 가질 수 없다(서버도 /api/presence를 회원으로 제한).
    // 비로그인 상태에서도 타이머는 살려 둔다 — 로그인 직후 별도 신호 없이 이어서 돌게.
    if (readAccessClaims()?.type !== 'member') {
      schedule(FALLBACK_MS)
      return
    }

    try {
      const { intervalSeconds } = await presenceApi.heartbeat(currentRoomId())
      failures = 0
      schedule(Math.max(1, intervalSeconds) * 1000)
    } catch {
      // 일시적 네트워크 오류로 하트비트가 영구히 멈추면 그 뒤로 계속 오프라인이 된다 — 반드시 재시도하되,
      // 장애가 이어지면 간격을 늘려 서버를 두드리지 않는다(2배씩, 5분 상한).
      failures += 1
      schedule(Math.min(FALLBACK_MS * 2 ** (failures - 1), MAX_BACKOFF_MS))
    }
  }

  onMounted(() => void beat())

  // 방에 들어가거나 나오는 순간을 최대 한 주기(20초)나 기다리게 하지 않는다.
  watch(currentRoomId, () => void beat())

  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })
}
