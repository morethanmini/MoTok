/**
 * 서버 게임 카탈로그(GET /games) — 목록을 보는 화면들의 단일 창구.
 *
 * <p><b>화면마다 따로 부르지 않는 이유.</b> 로비 게임 목록·랭킹·방 안 선택창이 각자 조회하면 한
 * 세션에서 같은 요청이 여러 번 나가고, 관리자가 중간에 게임을 닫으면(-106) 화면끼리 다른 목록을
 * 보게 된다. "무슨 게임이 있나"는 한 곳에서 답해야 하는 질문이다.</p>
 *
 * <p><b>예시 목록(폴백)을 두지 않는 이유.</b> 전에는 화면마다 목데이터를 먼저 그리고 서버 응답으로
 * 갈아치웠다. 목데이터에는 백엔드에 없는 게임이 섞여 있어 <b>존재하지 않는 게임을 고를 수 있게</b>
 * 보여 줬고, 두 목록의 내용·순서·카드 종류가 달라서 갈아치우는 순간 화면이 튀었다.</p>
 *
 * <p><b>대신 마지막으로 성공한 목록을 들고 있는다.</b> 조회가 실패하면 그걸 계속 보여 준다 —
 * 오래됐을 수는 있어도 없는 게임을 만들어 내지는 않는다. 방에서 이게 중요하다: 게임 시작은 REST가
 * 아니라 STOMP로 나가므로, {@code /games} 하나가 실패했다고 놀지 못할 이유가 없다. 목록을 한 번도
 * 받지 못한 상태에서만 실패를 드러낸다.</p>
 *
 * <p>캐시는 <b>폴백이고 1차 출처가 아니다</b> — 마운트마다 새로 받는다. 관리자가 닫은 게임이 다음
 * 화면에 반영되어야 하기 때문이다. 캐시가 있으면 그 값으로 즉시 그리므로 두 번째 방문부터는
 * 자리표시자가 보이지 않는다(같은 서버 값이라 갈아치워도 튀지 않는다).</p>
 */
import { onMounted, ref } from 'vue'
import { ApiError, gamesApi, type Game } from '@/api'

/** 마지막으로 성공한 목록 — 모듈 수명 동안 남는다(새로고침하면 사라진다). */
let lastGood: Game[] | null = null
/** 같은 순간 여러 화면이 마운트돼도 요청은 한 번만 나가게 한다. */
let inFlight: Promise<Game[]> | null = null

function fetchCatalog(): Promise<Game[]> {
  inFlight ??= gamesApi
    .list()
    .then((games) => {
      lastGood = games
      return games
    })
    .finally(() => {
      // 실패는 캐시하지 않는다 — 다음 화면이 다시 시도한다.
      inFlight = null
    })
  return inFlight
}

/** 테스트에서 모듈 캐시를 비운다 — 한 테스트의 성공이 다음 테스트의 폴백으로 새지 않게. */
export function __resetGameCatalogCache(): void {
  lastGood = null
  inFlight = null
}

export function useGameCatalog() {
  const games = ref<Game[]>(lastGood ?? [])
  /** 보여 줄 것이 아직 없는 동안만 참 — 자리표시자를 세우는 신호다. */
  const loading = ref(lastGood === null)
  /** 목록을 한 번도 받지 못한 채 실패했을 때의 안내. 직전 목록이 있으면 null(그걸 쓴다). */
  const error = ref<string | null>(null)
  /** 지금 보고 있는 게 이번에 받은 목록이 아니라 직전 성공 목록인지(오래됐을 수 있다). */
  const stale = ref(false)

  async function load(): Promise<void> {
    loading.value = lastGood === null
    error.value = null
    try {
      games.value = await fetchCatalog()
      stale.value = false
    } catch (e) {
      if (lastGood) {
        games.value = lastGood
        stale.value = true
      } else {
        error.value = e instanceof ApiError ? e.message : '게임 목록을 불러오지 못했어요'
      }
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { games, loading, error, stale, reload: load }
}
