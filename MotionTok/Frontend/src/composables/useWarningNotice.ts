/**
 * 관리자 경고 수신 (-105) — 접근을 막지 않는 유일한 제재라 <b>읽히는 것이 곧 제재의 실행</b>이다.
 *
 * ## 왜 푸시만으로는 안 되는가
 * 개인 큐로 보낸 메시지는 그 순간 접속 중이 아니면 조용히 폐기된다(서버 `UserNotifier` 주석).
 * 정지·영구정지는 접근이 막히는 것 자체가 통보라 놓쳐도 되지만, 경고를 놓치면 아무 일도
 * 일어나지 않은 것과 같다. 그래서 <b>푸시 + 스냅샷</b> 두 경로를 함께 쓴다 — 초대·친구요청(-149)이
 * 쓰는 것과 같은 계약이다.
 *
 * ## 확인을 서버에 알리는 이유
 * "봤다"를 클라이언트에만 두면 기기를 바꾸거나 저장소를 비울 때마다 같은 경고가 다시 뜬다.
 * 반대로 서버가 안 들고 있으면 못 본 경고를 다시 띄울 방법이 없다. 확인 시각은 서버가 갖는다.
 */
import { ref } from 'vue'
import { usersApi } from '@/api'
import type { UserNotification, WarningNotice } from '@/api'
import { isMemberSession, onStompConnected, subscribeGlobal } from './useGlobalStomp'

/** 로비·단일세션 안내도 같은 큐를 본다(useLobbyLive·useSessionDisplaced와 같은 상수). */
const NOTIFICATIONS_QUEUE = '/user/queue/notifications'

/** 아직 확인하지 않은 경고 — 오래된 것부터. 여러 건이면 순서대로 하나씩 보여 준다. */
const pending = ref<WarningNotice[]>([])

/** 지금 띄울 경고 한 건. 없으면 null. */
export const currentWarning = ref<WarningNotice | null>(null)

function showNext() {
  currentWarning.value = pending.value.shift() ?? null
}

function enqueue(notices: WarningNotice[]) {
  // 이미 큐에 있거나 지금 보고 있는 건 중복으로 넣지 않는다 — 푸시와 스냅샷이 같은 경고를 줄 수 있다.
  const known = new Set([
    ...pending.value.map((w) => w.id),
    ...(currentWarning.value ? [currentWarning.value.id] : []),
  ])
  pending.value.push(...notices.filter((w) => !known.has(w.id)))
  if (!currentWarning.value) showNext()
}

async function loadSnapshot() {
  if (!isMemberSession()) return // 게스트는 제재 대상이 아니다(RDB에 계정이 없다)
  try {
    enqueue(await usersApi.warnings())
  } catch {
    // 경고 조회 실패로 앱을 막지 않는다 — 다음 재연결이 다시 시도한다.
  }
}

/**
 * App.vue에서 <b>한 번만</b> 호출한다.
 *
 * @returns 확인 처리 함수 — 서버에 알리고 다음 경고로 넘긴다
 */
export function useWarningNotice() {
  void loadSnapshot()
  // 끊겼던 동안 받은 경고를 메운다(푸시는 그때 폐기됐다).
  onStompConnected(() => void loadSnapshot())

  // subscribeGlobal은 목적지 하나에 핸들러 여럿을 허용한다 — 로비·단일세션과 공존하고 각자 자기 type만 본다.
  subscribeGlobal(NOTIFICATIONS_QUEUE, (body) => {
    try {
      const message = JSON.parse(body) as UserNotification<WarningNotice>
      if (message.type === 'SANCTION_WARNING' && message.payload) {
        enqueue([message.payload])
      }
    } catch {
      // 형식 오류 프레임은 버린다 — 다른 알림 타입도 이 큐로 흐른다.
    }
  })

  return { acknowledge }
}

/**
 * 확인 처리. 서버 호출이 실패해도 <b>화면은 넘긴다</b> — 확인을 눌렀는데 모달이 안 닫히면
 * 앱이 멈춘 것처럼 보인다. 서버에 안 닿았으면 다음 접속 때 같은 경고가 다시 뜨는데,
 * 그게 안내를 한 번 더 보는 쪽이라 못 보는 것보다 안전하다.
 */
async function acknowledge() {
  const warning = currentWarning.value
  if (!warning) return
  showNext()
  try {
    await usersApi.acknowledgeWarning(warning.id)
  } catch {
    // 위 주석 참고 — 삼키고 넘어간다.
  }
}
