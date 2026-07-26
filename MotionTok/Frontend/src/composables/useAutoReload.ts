/**
 * 화면이 열려 있는 동안 주기적으로 다시 불러오고, 탭이 다시 보일 때도 한 번 불러온다.
 *
 * 왜 필요한가 — 친구 요청은 <b>상대가</b> 처리한다. 내가 보낸 요청을 상대가 수락·거절하면 서버에서는
 * 즉시 사라지는데, 내 화면은 마운트 시점 데이터를 들고 있어 새로고침 전까지 계속 "대기 중"으로 보인다.
 * STOMP는 게임룸에서만 연결되므로(useRoomChat) 지금은 서버가 개인에게 푸시할 통로가 없다.
 *
 * 백그라운드 탭에서는 폴링을 건너뛴다 — 안 보는 화면을 위해 요청을 쏠 이유가 없고,
 * 돌아오는 순간 visibilitychange가 어차피 한 번 불러온다.
 *
 * (refreshScheduler.ts의 토큰 갱신과 같은 구조다. 그쪽은 앱 전역 단발, 이쪽은 화면 수명에 묶인다.)
 */
import { onBeforeUnmount, onMounted } from 'vue'

const DEFAULT_INTERVAL_MS = 20_000
/** focus와 visibilitychange가 거의 동시에 오는 경우가 있어, 짧은 간격의 중복 호출을 접는다. */
const MIN_GAP_MS = 2_000

export function useAutoReload(reload: () => unknown, intervalMs = DEFAULT_INTERVAL_MS) {
  let timer: ReturnType<typeof setInterval> | undefined
  let lastAt = 0

  function run() {
    const now = Date.now()
    if (now - lastAt < MIN_GAP_MS) return
    lastAt = now
    void reload()
  }

  function onVisible() {
    if (document.visibilityState === 'visible') run()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', run)
    timer = setInterval(() => {
      if (!document.hidden) run()
    }, intervalMs)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', run)
    clearInterval(timer)
  })

  /** 내가 방금 서버 상태를 바꿨을 때처럼, 간격을 무시하고 즉시 불러야 하는 경우. */
  return { reloadNow: () => { lastAt = Date.now(); return reload() } }
}
