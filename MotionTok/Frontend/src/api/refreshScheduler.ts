/**
 * 액세스 토큰 자동 갱신 타이머.
 *
 * 왜 필요한가 — 모톡은 로비에서 방에 들어가 게임을 하는 동안 REST 요청이 거의 없다.
 * 요청이 있을 때만 갱신하면 30분~1시간짜리 세션 하나를 마치고 나올 때 토큰이 이미 죽어 있고,
 * 그 시점에 로비로 못 돌아가고 로그인 화면으로 튕긴다.
 * 그래서 요청과 무관하게 만료 5분 전에 스스로 갱신하고, 절전·백그라운드로 타이머가 밀렸을 수 있으니
 * 탭이 다시 보일 때도 한 번 확인한다.
 *
 * 게스트는 Refresh 토큰이 없어 갱신 대상이 아니다(대신 게스트 토큰 자체가 길다 — 서버 jwt.guest-expiration-ms).
 */
import { refreshAccessTokenIfNeeded } from './http'
import { accessTokenRemainingMs, getRefreshToken } from './token'

/** 만료 몇 분 전에 갱신할지 — http.ts의 선제 갱신 기준과 같게 맞춘다. */
const LEAD_MS = 5 * 60 * 1000
/** TTL이 짧은 개발 설정에서 타이머가 촘촘히 도는 것을 막는 하한. */
const MIN_DELAY_MS = 30 * 1000

let timer: ReturnType<typeof setTimeout> | undefined
let started = false

function schedule() {
  clearTimeout(timer)
  if (!getRefreshToken()) return // 비로그인·게스트 — 갱신할 것이 없다
  const delay = Math.max(MIN_DELAY_MS, accessTokenRemainingMs() - LEAD_MS)
  timer = setTimeout(() => void tick(), delay)
}

async function tick() {
  await refreshAccessTokenIfNeeded()
  schedule() // 갱신에 실패했으면 토큰이 지워져 있어 schedule()이 스스로 멈춘다
}

/** 앱 부팅 시 1회 호출. 로그인·로그아웃으로 토큰이 바뀌면 rescheduleTokenAutoRefresh()로 다시 잡는다. */
export function startTokenAutoRefresh() {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick()
  })
  window.addEventListener('focus', () => void tick())
  schedule()
}

export function rescheduleTokenAutoRefresh() {
  schedule()
}

export function stopTokenAutoRefresh() {
  clearTimeout(timer)
}
