/**
 * 배포 교체 감지 — "지금 실행 중인 빌드"와 "서버가 지금 내려주는 빌드"가 다른지 본다.
 *
 * ## 왜 필요한가
 * 배포는 dist를 nginx 서빙 폴더에 덮어쓴다(.gitlab-ci.yml deploy-frontend). Vite 청크는 해시
 * 파일명이라 배포가 나가면 파일 이름 자체가 바뀐다. 배포 전부터 열려 있던 탭은 <b>옛 index.html이
 * 참조하는 옛 청크 이름</b>을 들고 있으므로, 지연 로딩되는 화면에 들어가려는 순간 그 이름을 요청한다.
 *
 * <p>서버에 그 파일이 없으면(구 배포분을 지웠거나 보존 기간이 지났으면) 404가 나는데, 화면에는
 * <b>아무 일도 일어나지 않고</b> 콘솔에만 "Failed to fetch dynamically imported module"이 남는다.
 * 실제로 "게임 시작을 눌렀는데 카메라만 보인다"로 나타났다 — 소켓도 방도 멀쩡한데
 * 게임 컴포넌트 청크만 사라진 상태였다.</p>
 *
 * ## 어떻게 아는가 — 빌드 번호를 따로 심지 않는다
 * index.html이 참조하는 <b>엔트리 스크립트의 해시 파일명</b>이 곧 빌드 식별자다. 부팅 시점의 값을
 * 기억해 두고 서버의 index.html을 다시 받아 비교한다. 배포되면 반드시 바뀌는 값이라 놓칠 수 없고,
 * 빌드 설정·CI에 아무것도 추가하지 않아도 된다.
 *
 * <p>개발 서버는 엔트리가 `/src/main.ts`라 `/assets/`에 걸리는 스크립트가 없다 —
 * 양쪽 서명이 모두 비어 비교가 성립하지 않으므로 조용히 아무 일도 하지 않는다.</p>
 *
 * ## 세 가지 입구
 * <ul>
 *   <li>주기 확인({@link CHECK_INTERVAL_MS}) · 탭 복귀 — 아직 사고가 나기 전에 배너로 알린다</li>
 *   <li>{@link markBuildOutdated} — 청크 404를 실제로 만났을 때. 그 자체가 새 배포의 증거다</li>
 *   <li>{@link reloadForNewBuild} — 되돌릴 방법은 새 index.html을 받는 것뿐이라 새로고침이 유일한 복구다</li>
 * </ul>
 */
import { readonly, ref } from 'vue'

/** 배포 주기보다 촘촘하면 의미가 없고, 너무 뜸하면 사고가 먼저 난다. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * 자동 새로고침 재시도 간격. 방금 새로고침했는데 또 청크를 못 받았다면 배포 교체가 아니라
 * 다른 문제(서버 장애·네트워크)이므로, 무한 새로고침으로 화면을 못 쓰게 만들지 않는다.
 */
const RELOAD_COOLDOWN_MS = 60_000
const RELOAD_AT_KEY = 'motok.buildReloadAt'

/**
 * 동적 import 실패 메시지 — 브라우저마다 문구가 다르다.
 * Chrome "Failed to fetch dynamically imported module" · Firefox "error loading dynamically imported module"
 * · Safari "Importing a module script failed".
 *
 * <p>"Failed to fetch"만으로 판정하지 않는다 — 평범한 네트워크 오류까지 배포 교체로 오인해
 * 새로고침을 걸어 버린다.</p>
 */
const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed/i

const outdated = ref(false)
let started = false

/** 새 배포가 올라와 지금 화면이 낡았는가. 새로고침 전까지 false로 돌아가지 않는다. */
export const buildOutdated = readonly(outdated)

/** index.html이 참조하는 빌드 산출물 스크립트 목록 — 순서에 흔들리지 않게 정렬해 잇는다. */
function signatureOf(root: ParentNode): string {
  return Array.from(root.querySelectorAll('script[type="module"][src]'))
    .map((el) => el.getAttribute('src') ?? '')
    .filter((src) => src.includes('/assets/'))
    .sort()
    .join('|')
}

/** 부팅 시점(=지금 실행 중인 빌드)의 서명. 런타임에 스크립트가 더 붙기 전에 읽어야 한다. */
const bootSignature = signatureOf(document)

/** 청크를 못 받은 원인이 배포 교체인가 — 평범한 네트워크 실패와 구분한다. */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR_RE.test(error.message)
}

/** 청크 404를 실제로 만났을 때. 다음 주기를 기다릴 것 없이 이미 증명된 사실이다. */
export function markBuildOutdated() {
  outdated.value = true
}

/**
 * 새 빌드를 받기 위해 문서를 다시 연다. 청크가 사라진 상태는 재시도로 낫지 않는다 —
 * 새 index.html을 받아야 새 파일 이름을 알 수 있다.
 *
 * @param path 이동하려다 실패한 목적지. 주면 그 화면으로 새로 연다(안 주면 제자리 새로고침)
 * @returns 새로고침을 시작했으면 true. 쿨다운에 걸렸으면 false — 호출부가 대신 안내해야 한다
 */
export function reloadForNewBuild(path?: string): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? 0)
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false
  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()))
  if (path) {
    window.location.assign(path)
  } else {
    window.location.reload()
  }
  return true
}

async function check() {
  // 이미 낡은 걸 아는데 또 물어볼 이유가 없다. 서명이 비었으면(개발 서버) 비교 자체가 성립하지 않는다.
  if (outdated.value || !bootSignature) return
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' })
    if (!res.ok) return
    const served = signatureOf(new DOMParser().parseFromString(await res.text(), 'text/html'))
    if (served && served !== bootSignature) outdated.value = true
  } catch {
    // 오프라인·일시 실패 — 다음 주기에 다시 본다. 못 물어본 것과 낡은 것은 다르다.
  }
}

/**
 * App.vue에서 <b>한 번만</b> 호출한다.
 *
 * <p>탭 복귀에서 확인하는 것이 핵심이다 — 로비를 열어 둔 채 자리를 비운 사이 배포가 나가는 것이
 * 정확히 이 문제가 터지는 경로다. 주기 확인은 한 화면에 오래 머무는 경우를 위한 보조.</p>
 */
export function startBuildWatch() {
  if (started) return
  started = true
  window.setInterval(() => void check(), CHECK_INTERVAL_MS)
  // 돌아오는 신호를 둘 다 듣는다 — 탭 전환은 visibilitychange로, 창 전환은 focus로만 오는
  // 경우가 있다(refreshScheduler도 같은 이유로 둘을 함께 건다).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  window.addEventListener('focus', () => void check())
  void check()
}
