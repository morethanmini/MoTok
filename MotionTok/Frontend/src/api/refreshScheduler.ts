/**
 * 액세스 토큰 만료 타이머.
 *
 * 왜 필요한가 — 모톡은 로비에서 방에 들어가 게임을 하는 동안 REST 요청이 거의 없다.
 * 요청이 있을 때만 갱신하면 30분~1시간짜리 세션 하나를 마치고 나올 때 토큰이 이미 죽어 있고,
 * 그 시점에 로비로 못 돌아가고 로그인 화면으로 튕긴다.
 * 그래서 요청과 무관하게 만료 5분 전에 스스로 갱신하고, 절전·백그라운드로 타이머가 밀렸을 수 있으니
 * 탭이 다시 보일 때도 한 번 확인한다.
 *
 * 게스트는 Refresh 쿠키가 없어 갱신 대상이 아니다. 대신 <b>만료되는 순간을 알린다</b> —
 * 갱신 수단이 없으니 그때가 세션의 끝이고, 아무 안내 없이 요청만 실패하기 시작하면
 * "왜 갑자기 안 되지"가 된다. 만료를 회원 전환을 권하는 자리로 쓴다(App.vue).
 */
import { refreshAccessTokenIfNeeded } from './http'
import { emitSessionExpired } from './authEvents'
import { accessTokenRemainingMs, hasRefreshSession, readAnyAccessClaims } from './token'

/** 만료 몇 분 전에 갱신할지 — http.ts의 선제 갱신 기준과 같게 맞춘다. */
const LEAD_MS = 5 * 60 * 1000
/** TTL이 짧은 개발 설정에서 타이머가 촘촘히 도는 것을 막는 하한. */
const MIN_DELAY_MS = 30 * 1000

/**
 * 갱신 시각을 흩는 폭(ms). 0~4분 사이에서 무작위로 <b>늦춘다</b>.
 *
 * <p>갱신 시각은 로그인 시각에만 의존한다(TTL 1시간 − LEAD 5분 = 55분 뒤 고정).
 * 공지를 보고 2000명이 몇 분 안에 몰려 로그인하면 <b>55분 뒤 같은 몇 분에 2000건의 refresh</b>가
 * 몰린다 — Redis 토큰 회전 write가 한꺼번에 터지는 모양이다.</p>
 *
 * <p>지터는 반드시 <b>늦추는 방향</b>으로만 준다. 앞당기면 갱신이 잦아질 뿐이고,
 * 늦추는 쪽은 LEAD_MS(5분) 여유 안에서만 움직이면 만료 전에 반드시 끝난다.
 * 4분을 쓰면 최소 1분 여유가 남는다.</p>
 */
const REFRESH_JITTER_MS = 4 * 60 * 1000

let timer: ReturnType<typeof setTimeout> | undefined
let started = false

function schedule() {
  clearTimeout(timer)

  // 게스트 — 갱신할 것이 없으니 "만료되는 순간"에 맞춰 한 번만 깨운다.
  if (readAnyAccessClaims()?.type === 'guest') {
    timer = setTimeout(() => guestExpired(), accessTokenRemainingMs())
    return
  }

  if (!hasRefreshSession()) return // 비로그인 — 갱신할 것이 없다
  const base = accessTokenRemainingMs() - LEAD_MS
  // 여유가 충분할 때만 흩는다. 이미 만료가 임박했으면(base가 하한 이하) 미루지 않고 바로 간다.
  const delay =
    base > MIN_DELAY_MS ? base + Math.random() * REFRESH_JITTER_MS : MIN_DELAY_MS
  timer = setTimeout(() => void tick(), delay)
}

/** 게스트 토큰 만료. 타이머가 일찍 깼으면(브라우저 절전 등) 다시 잡는다. */
function guestExpired() {
  if (readAnyAccessClaims()?.type !== 'guest') return
  if (accessTokenRemainingMs() > 0) {
    schedule()
    return
  }
  emitSessionExpired('guest')
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
