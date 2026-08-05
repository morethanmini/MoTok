<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  gamesApi,
  ApiError,
  type LeaderboardEntry,
  type LeaderboardMode,
  type LeaderboardPeriod,
  type LeaderboardResponse,
} from '@/api'
import { useGameCatalog } from '@/composables/useGameCatalog'
import { useUserProfile } from '@/composables/useUserProfile'
import { useToast } from '@/composables/useToast'
import AppPage from '@/components/common/AppPage.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import UserProfileModal from '@/components/common/UserProfileModal.vue'

const MOCK_BOARD: LeaderboardResponse = {
  gameId: 1,
  period: 'ALLTIME',
  entries: [
    { rank: 1, userId: 10, nickname: '별잡이', score: 9980, playCount: 42 },
    { rank: 2, userId: 11, nickname: '민수', score: 9850, playCount: 30 },
    { rank: 3, userId: 1, nickname: 'P1', score: 9720, playCount: 12 },
    { rank: 4, userId: 12, nickname: 'Alex', score: 9310, playCount: 25 },
  ],
  myRank: { rank: 3, userId: 1, nickname: 'P1', score: 9720, playCount: 12 },
}

/**
 * 게임 목록은 <b>예시 폴백을 두지 않는다</b>(순위표의 MOCK_BOARD와 다르게 취급하는 이유).
 *
 * 전에 두었던 예시 3개(손가락 별·리듬 터치·자세 매치)는 백엔드에 <b>그 이름으로 존재하지 않는
 * 게임</b>이었다. 그래서 화면 제목이 "손가락 별" → "핑거 스타"로 바뀌며 튀었고, 게임 목록이
 * 3개 → 5개로 늘었으며, 다른 게임까지 훑는 닉네임 검색이 없는 id(3·5)를 조회했다.
 *
 * 순위표는 텅 빈 표보다 예시가 나아 폴백을 유지하지만(그건 boardIsFallback으로 검색에서 제외한다),
 * 게임 목록은 <b>고를 대상</b>이라 잘못된 항목을 잠깐이라도 보여 주면 안 된다.
 *
 * 공용 창구를 쓰므로 로비 게임 목록·방 안 선택창과 <b>같은 목록</b>을 본다 — 화면마다 따로 받으면
 * 관리자가 중간에 게임을 닫았을 때 화면끼리 다른 상태를 보여 준다.
 */
const { games } = useGameCatalog()
const selected = ref(1)
const board = ref<LeaderboardResponse>(MOCK_BOARD)
const error = ref<string | null>(null)
/**
 * 지금 보고 있는 순위표가 서버에서 온 게 아니라 폴백(MOCK_BOARD)인지.
 *
 * 폴백은 화면이 텅 비지 않게 두는 예시 데이터라 실제 회원이 아니다. 검색이 이걸 찾아내면
 * 결과 박스를 눌러 없는 userId로 프로필을 열게 되고("조회할 수 없는 계정"), 없는 사람의
 * 순위를 알려 준 셈이 된다. 그래서 검색은 이 순위표를 대상으로 삼지 않는다.
 */
const boardIsFallback = ref(false)
const MODES = [
  { value: 'MULTI', label: '멀티 플레이' },
  { value: 'SOLO', label: '혼자 플레이' },
] as const
const mode = ref<LeaderboardMode>('MULTI')
/**
 * 혼자 플레이 순위표를 열어 줄 게임인가 — minPlayers가 2 이상이면 혼자서는 시작조차 못 한다.
 *
 * 그런 게임에도 솔로 기록이 남아 있다(개발 중 인원 제한을 잠깐 풀고 테스트한 것). 토글을
 * 열어 두면 이제는 아무도 세울 수 없는 기록이 순위표로 보이므로 멀티만 남긴다.
 *
 * 목록에 없는 id는 막지 않는다 — /games가 실패해 폴백 목록(MOCK_GAMES)을 쓰는 중일 수 있다.
 */
function soloPlayable(gameId: number) {
  const game = games.value.find((g) => g.id === gameId)
  return !game || game.minPlayers <= 1
}
const availableModes = computed(() =>
  MODES.filter((item) => item.value === 'MULTI' || soloPlayable(selected.value)),
)

/**
 * 집계 기간 탭. 두 랭킹은 성격이 짝이라 나란히 둔다.
 *
 * <b>역대</b>는 단일 판 최고 점수이고 동점이면 먼저 달성한 쪽이 위다 — 그래서 점수 상한이 있는
 * 게임은 상위권이 한 번 정해지면 사실상 굳는다(명예의 전당). <b>주간</b>은 매주 0에서 다시 시작하니
 * 늦게 온 사람도 이길 수 있다.
 *
 * 기본값을 역대로 둔 이유는 하나뿐이다 — 주간 집계를 이번 주부터 시작해서, 주간을 기본으로 하면
 * 첫 방문자가 빈 표를 본다. 기록이 쌓이면 이 한 줄만 'WEEKLY'로 바꾸면 된다.
 */
/**
 * SSAFY 응원가 이벤트 보드(S15P11A706-186) — <b>한시적</b>이다.
 *
 * 캐치캐치리듬의 특정 채보(어려움 풀) 하나만 따로 세운 최고점 랭킹. 만점이 41,200이라
 * 만점자가 여럿이면 먼저 찍은 사람이 위로 온다(서버 tie-break가 그대로 적용된다).
 *
 * 이벤트가 끝나면 <b>이 상수와 아래 EVENT 탭 한 줄만 지우면</b> 화면에서 사라진다.
 * 서버 쪽도 chart_leaderboard 테이블을 버리는 것으로 끝난다.
 */
const EVENT_BOARD = {
  gameId: 2,
  chartId: 'ssafy-fighting-manual',
  label: 'SSAFY 응원가',
} as const

const PERIODS = [
  { value: 'ALLTIME', label: '전체 랭킹' },
  { value: 'WEEKLY', label: '주간 랭킹' },
  { value: 'CHART', label: EVENT_BOARD.label },
] as const
const period = ref<LeaderboardPeriod>('ALLTIME')
const isWeekly = computed(() => period.value === 'WEEKLY')
const isChart = computed(() => period.value === 'CHART')
/** 응원가 탭은 캐치캐치리듬에서만 — 다른 게임엔 그 채보 자체가 없다. */
const hasEventBoard = computed(() => selected.value === EVENT_BOARD.gameId)

/**
 * 협동 게임(그림으로 말해요)에는 <b>역대 최고점 순위표가 없다</b> — 주간 탭만 보인다.
 *
 * 협동은 전원이 같은 점수를 받고, 그 점수도 AI 추측 순위에 따른 여섯 값(100·80·60·40·20·0)뿐이다.
 * 그래서 역대 최고점은 사람이 조금만 늘어도 전부 100점에 몰려 "100점을 제일 먼저 겪은 사람"으로
 * 굳는다. 게다가 그건 내 실력이 아니라 그날 팀의 결과다. 주간 합계는 판마다 쌓여 값이 흩어지고
 * 매주 리셋되므로 협동에서도 성립한다.
 *
 * 모드 토글(soloPlayable)과 같은 방식으로 <b>고를 수 없게</b> 막는다 — 눌렀는데 빈 표가 나오는
 * 것보다 아예 없는 게 낫다. 서버도 같은 판단을 하므로(Game.hasLeaderboard) 직접 URL로 불러도 빈다.
 */
const isCoopGame = computed(() => games.value.find((g) => g.id === selected.value)?.mode === 'COOP')
const availablePeriods = computed(() =>
  PERIODS.filter((item) => {
    if (item.value === 'CHART') return hasEventBoard.value
    return item.value === 'WEEKLY' || !isCoopGame.value
  }),
)
const gameMenuOpen = ref(false)
const FETCH_LIMIT = 100
const PAGE_SIZE = 10
const page = ref(1)

/**
 * 닉네임으로 순위표에서 사람 찾기.
 *
 * 부분 일치가 아니라 정확히 같은 닉네임만 찾는다. 서버가 아니라 순위표(게임·모드별 최대
 * {@link FETCH_LIMIT}명)를 훑는다 — 닉네임으로 회원을 찾는 공개 API가 없다(있는 건 관리자용
 * `/v1/admin/users`뿐). 그래서 "못 찾음"은 그런 사람이 없거나 어느 순위표에도 100위 안에
 * 들지 못했다는 뜻이다.
 */
const searchQuery = ref('')
const searchHit = ref<LeaderboardEntry | null>(null)
const searchMiss = ref('')
/** 다른 게임 순위표를 훑는 중 — 요청이 여러 건이라 버튼을 잠가 중복 발사를 막는다. */
const searching = ref(false)
/** 옮겨서 찾았다는 안내. 보고 있던 게임이 바뀌므로 왜 바뀌었는지 말해 줘야 한다. */
const movedNote = ref('')
/**
 * 옮기는 중 보관 — 순위표를 새로 받은 뒤 바로 다음 검색이 안내로 올린다.
 *
 * <b>한 번만 쓴다.</b> 옮긴 뒤 그 순위표 조회가 실패하면(폴백 데이터로 대체) 그 사람을 못 찾아
 * 안내를 쓸 자리가 없는데, 그때 값을 남겨 두면 나중에 성공한 엉뚱한 검색에 "옮겼어요"가 붙는다.
 */
let pendingMove = ''

function clearSearch() {
  searchHit.value = null
  searchMiss.value = ''
  movedNote.value = ''
  pendingMove = ''
}

function focusHit(hit: LeaderboardEntry, note = '') {
  searchHit.value = hit
  movedNote.value = note
  // 찾은 사람이 몇 페이지에 있든 그 페이지로 넘겨 준다 — 순위(rank)가 아니라 목록에서의
  // 자리로 센다. 동점자 처리에 따라 rank는 건너뛸 수 있어 페이지 계산이 어긋난다.
  page.value = Math.floor(board.value.entries.indexOf(hit) / PAGE_SIZE) + 1
  nextTick(() => {
    document.querySelector('.score-row.found')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

const modeLabel = (value: LeaderboardMode) => MODES.find((m) => m.value === value)?.label ?? value

/**
 * 지금 순위표에 없으면 다른 순위표에서 가장 높은 순위를 찾는다.
 *
 * <p>지금 모드의 다른 게임들을 먼저 본다. 거기서 나오면 모드 스위치를 건드리지 않고 끝난다 —
 * 요청도 절반이고, 누르지 않은 토글이 저절로 넘어가는 일도 없다. 그 모드 어디에도 없을 때만
 * 반대 모드까지 넓힌다. 아예 안 넓히면 솔로 기록만 있는 사람을 못 찾아, 직접 모드를 바꿔
 * 다시 검색하는 수고가 그대로 남는다.</p>
 *
 * <p><b>기간 축은 넓히지 않는다.</b> 지금 보고 있는 탭 안에서만 찾는다 — 넓히면 요청이 두 배가
 * 되는 것도 문제지만, "주간엔 없어서 역대 탭으로 저절로 넘어감"이 더 나쁘다. 모드는 어느 쪽이든
 * 같은 성격의 기록이라 옮겨도 말이 되지만, 역대와 주간은 아예 다른 질문에 대한 답이다.</p>
 */
async function bestRankElsewhere(query: string) {
  const waves: LeaderboardMode[] = [mode.value, mode.value === 'MULTI' ? 'SOLO' : 'MULTI']
  for (const wave of waves) {
    // 순위표가 없는 조합은 그 물결에서 뺀다 — 훑어 봐야 빈 응답이고, 거기서 찾더라도 그 게임에서는
    // 고를 수조차 없는 탭으로 옮겨 놓게 된다. 솔로 없는 게임(minPlayers ≥ 2)과 역대 없는 협동
    // 게임이 여기 해당한다. 서버도 같은 판단을 하므로(Game.hasLeaderboard) 이건 요청을 아끼는 쪽이다.
    const targets = games.value.filter(
      (g) =>
        !(g.id === selected.value && wave === mode.value) &&
        (wave === 'MULTI' || soloPlayable(g.id)) &&
        (period.value === 'WEEKLY' || g.mode !== 'COOP'),
    )
    const found = (
      await Promise.all(
        targets.map((game) =>
          gamesApi
            .leaderboard(game.id, wave, FETCH_LIMIT, period.value)
            .then((b) => {
              const entry = b.entries.find((e) => e.nickname === query)
              return entry ? { gameId: game.id, name: game.name, mode: wave, entry } : null
            })
            // 한 게임이 실패해도 나머지 결과로 답한다 — 전부 못 찾은 것과 구분되지 않지만,
            // 여기서 화면을 오류로 덮으면 이미 찾은 순위까지 버리게 된다
            .catch(() => null),
        ),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null)
    if (found.length) {
      return found.reduce((best, r) => (r.entry.rank < best.entry.rank ? r : best))
    }
  }
  return null
}

/**
 * @param crossGame 지금 순위표에 없을 때 다른 게임까지 찾아볼지.
 *   순위표를 새로 받을 때는 false다 — 사용자가 직접 고른 게임을 검색이 다시 덮어쓰면
 *   게임을 고를 수가 없다. 재귀도 이 한 줄로 막힌다.
 */
async function searchPlayer(crossGame = true) {
  // 훑는 중에는 새 검색을 받지 않는다. 버튼은 잠기지만 Enter는 그대로 들어오는데, 겹쳐 돌면
  // 요청이 배로 늘고 늦게 끝난 쪽이 이겨 엉뚱한 게임으로 옮겨진다.
  // 순위표를 새로 받는 경로(crossGame=false)는 막지 않는다 — 그건 옮긴 결과를 표시하는 쪽이다.
  if (crossGame && searching.value) return
  const query = searchQuery.value.trim()
  // 이동 직후인지 여기서 확정하고 비운다 — 아래에서 쓰든 못 쓰든 다음 검색으로 넘기지 않는다.
  const moveNote = pendingMove
  clearSearch()
  if (!query) return
  // 폴백 순위표는 실제 회원이 아니라 건너뛴다(위 boardIsFallback 참고)
  const hit = boardIsFallback.value
    ? undefined
    : board.value.entries.find((entry) => entry.nickname === query)
  if (hit) {
    focusHit(hit, moveNote)
    return
  }
  // 응원가 보드는 캐치캐치리듬 하나뿐이라 옮겨 갈 곳이 없다 — 훑지 않고 바로 못 찾음으로 답한다
  if (!crossGame || isChart.value) {
    searchMiss.value = query
    return
  }
  searching.value = true
  try {
    const best = await bestRankElsewhere(query)
    if (!best) {
      searchMiss.value = query
      return
    }
    pendingMove =
      best.mode === mode.value
        ? `이 게임엔 없어서 ‘${best.name}’로 옮겼어요`
        : `이 게임엔 없어서 ‘${best.name} · ${modeLabel(best.mode)}’로 옮겼어요`
    // 두 값을 바꾸면 watch가 순위표를 새로 받고, 그 안에서 이 사람을 찾아 표시한다
    selected.value = best.gameId
    mode.value = best.mode
  } finally {
    searching.value = false
  }
}

async function loadBoard() {
  error.value = null
  try {
    board.value = await gamesApi.leaderboard(
      selected.value,
      mode.value,
      FETCH_LIMIT,
      period.value,
      undefined,
      isChart.value ? EVENT_BOARD.chartId : undefined,
    )
    boardIsFallback.value = false
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '랭킹을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    // 주간·이벤트에는 예시를 띄우지 않는다 — 아직 아무도 안 한 게 정상 상태라, 여기에 가짜 기록을
    // 그려 두면 사용자가 그걸 실제 순위로 읽는다. 역대는 텅 빈 표가 더 어색해 폴백을 남긴다.
    board.value = period.value === 'ALLTIME'
      ? { ...MOCK_BOARD, gameId: selected.value }
      : { gameId: selected.value, period: period.value, entries: [] }
    boardIsFallback.value = period.value === 'ALLTIME'
  }
  page.value = 1
  // 게임·모드·기간을 바꿔도 찾던 사람을 계속 따라간다 — 같은 이름을 다시 칠 이유가 없다
  if (searchQuery.value.trim()) void searchPlayer(false)
  else clearSearch()
}
onMounted(loadBoard)
watch([selected, mode, period], loadBoard)

/** 순위표 제목 — 지금 보고 있는 탭이 뭔지 표에도 적어 준다(탭만 보고 헷갈리지 않게). */
const boardTitle = computed(() => {
  if (isChart.value) return `${EVENT_BOARD.label} 순위`
  return `${selectedGame.value} ${isWeekly.value ? '주간 순위' : '전체 순위'}`
})

/** 주간 탭이 보고 있는 주 — 서버가 스냅해 준 weekStart 기준 7일. */
const weekLabel = computed(() => {
  const start = board.value.weekStart
  if (!start) return ''
  const from = new Date(`${start}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(from)} ~ ${fmt(to)}`
})

/**
 * 줄에 마우스를 올렸을 때 뜨는 안내 — <b>동점인데 순위가 갈린 이유</b>를 설명하는 유일한 장치다.
 * 서버가 공동 등수를 주지 않으므로, 이게 없으면 같은 점수 두 줄의 위아래를 납득시킬 방법이 없다.
 */
function achievedTitle(entry: LeaderboardEntry) {
  if (!entry.achievedAt) return ''
  const d = new Date(entry.achievedAt)
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return isWeekly.value
    ? `${when}에 이 합계에 도달`
    : `${when} 달성 — 같은 점수면 먼저 달성한 사람이 위입니다`
}

/** 모드 토글은 응원가 보드에서 숨긴다 — 그 보드는 솔로·멀티를 합쳐서 세므로 눌러도 안 바뀐다. */
const showModeSwitch = computed(() => !isChart.value)

const totalPages = computed(() => Math.max(1, Math.ceil(board.value.entries.length / PAGE_SIZE)))
const pagedEntries = computed(() => board.value.entries.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const podiumEntries = computed(() =>
  [1, 0, 2]
    .map((index) => board.value.entries[index])
    .filter((entry): entry is LeaderboardEntry => Boolean(entry)),
)
const selectedGame = computed(() => games.value.find((game) => game.id === selected.value)?.name ?? '이번 게임')
const viewer = useUserProfile()
const { message: toast, flash } = useToast()

function openProfile(entry: LeaderboardEntry) {
  viewer.open(entry.userId, entry.nickname)
}
function rankMark(rank: number) {
  return rank <= 3 ? ['👑', '✦', '●'][rank - 1] : String(rank).padStart(2, '0')
}
function selectGame(gameId: number) {
  selected.value = gameId
  // 혼자 플레이가 없는 게임으로 옮기면 그 토글이 사라진다 — 모드도 같이 되돌려야
  // 고를 수 없게 된 모드의 순위표를 그대로 보고 있지 않는다
  if (!soloPlayable(gameId)) mode.value = 'MULTI'
  // 역대 탭이 없는 협동 게임도 마찬가지 — 사라진 탭의 순위표를 계속 보고 있으면 안 된다
  if (games.value.find((g) => g.id === gameId)?.mode === 'COOP') period.value = 'WEEKLY'
  // 응원가 보드는 캐치캐치리듬에만 있다 — 다른 게임으로 옮기면 그 탭도 사라지므로 되돌린다
  if (period.value === 'CHART' && gameId !== EVENT_BOARD.gameId) period.value = 'ALLTIME'
  gameMenuOpen.value = false
}
</script>

<template>
  <AppPage class="ranking-page" title="랭킹" :back="false" title-style="none" max-width="1460px" :zoom="1">
    <template #hero>
      <section class="rank-stage">
        <div class="stage-copy">
          <span class="stage-kicker">MOTIONTOK ARCADE</span>
          <h1>명예의 <em>랭킹 보드</em></h1>
          <p>{{ selectedGame }}에서 가장 빛난 플레이어들을 만나보세요.</p>
        </div>
        <div class="trophy-scene" aria-hidden="true">
          <i class="spark spark-one">✦</i><i class="spark spark-two">✦</i><i class="spark spark-three">●</i>
          <img class="champion-cat" src="/assets/ranking-champion-cat.png" alt="" />
          <div class="scene-floor" />
        </div>
        <div class="my-rank-flag">
          <span>{{ isWeekly ? 'MY WEEK' : 'MY BEST' }}</span>
          <strong>#{{ board.myRank?.rank ?? '-' }}</strong>
          <small>{{ board.myRank ? `${board.myRank.score.toLocaleString()} PTS` : 'PLAY NOW' }}</small>
        </div>
      </section>
    </template>

    <section class="ranking-panel">
      <div class="ranking-controls">
        <div class="player-search">
          <div class="search-box">
            <label class="search-field">
              <i class="search-icon" aria-hidden="true">⌕</i>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="닉네임으로 순위 찾기"
                aria-label="닉네임으로 순위 찾기"
                @keydown.enter="searchPlayer()"
              />
            </label>
            <button type="button" :disabled="searching" @click="searchPlayer()">
              {{ searching ? '찾는 중' : '찾기' }}
            </button>
          </div>
          <button v-if="searchHit" class="search-result" type="button" :aria-label="`${searchHit.nickname} 프로필 보기`" title="프로필 보기" @click="openProfile(searchHit)">
            <UserAvatar :src="searchHit.avatarUrl" :fallback="searchHit.nickname.charAt(0)" :alt="`${searchHit.nickname} 프로필 사진`" />
            <b>{{ searchHit.nickname }}</b>
            <span class="result-rank">{{ searchHit.rank }}위</span>
            <small>{{ searchHit.score.toLocaleString() }} PTS</small>
          </button>
          <p v-else-if="searchMiss" class="search-result miss" role="status">
            ‘{{ searchMiss }}’ 님은 어느 순위표에도 없어요
          </p>
          <p v-if="movedNote" class="search-moved" role="status">{{ movedNote }}</p>
        </div>
        <div class="game-picker">
          <button class="game-picker-trigger" :aria-expanded="gameMenuOpen" @click="gameMenuOpen = !gameMenuOpen">
            <span><b>{{ selectedGame }}</b></span>
            <i class="game-picker-chevron" :class="{ open: gameMenuOpen }" aria-hidden="true" />
          </button>
          <div v-if="gameMenuOpen" class="game-menu" role="menu">
            <button v-for="game in games" :key="game.id" :class="{ selected: selected === game.id }" role="menuitem" @click="selectGame(game.id)">
              <span>{{ game.name }}</span><i v-if="selected === game.id">✓</i>
            </button>
          </div>
        </div>
        <div v-if="showModeSwitch" class="mode-switch" aria-label="랭킹 모드 선택">
          <button v-for="item in availableModes" :key="item.value" :class="{ active: mode === item.value }" @click="mode = item.value">
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="podium-wrap">
        <div class="podium-title">
          <span>TOP PLAYERS</span>
          <b v-if="isChart">{{ EVENT_BOARD.label }} 챔피언</b>
          <b v-else>{{ isWeekly ? '이번 주의 챔피언' : '역대 챔피언' }}</b>
        </div>
        <div class="podium">
          <button v-for="entry in podiumEntries" :key="entry.userId" class="podium-player" :class="`place-${entry.rank}`" @click="openProfile(entry)">
            <span class="podium-medal">{{ rankMark(entry.rank) }}</span>
            <UserAvatar :src="entry.avatarUrl" :fallback="entry.nickname.charAt(0)" :alt="`${entry.nickname} 프로필 사진`" />
            <strong>{{ entry.nickname }}</strong>
            <small>{{ entry.score.toLocaleString() }} PTS</small>
            <i class="podium-block">{{ entry.rank }}</i>
          </button>
          <div v-if="!podiumEntries.length" class="podium-empty">아직 랭킹 기록이 없어요.</div>
        </div>
      </div>

      <div class="leaderboard-grid">
        <section class="scoreboard">
          <header class="board-head"><div><span>LEADERBOARD</span><h2>{{ boardTitle }}</h2></div><small>프로필을 눌러 확인해 보세요</small></header>
          <div class="period-tabs" role="tablist" aria-label="랭킹 집계 기간">
            <button
              v-for="item in availablePeriods"
              :key="item.value"
              type="button"
              role="tab"
              :aria-selected="period === item.value"
              :class="{ active: period === item.value }"
              @click="period = item.value"
            >
              <b>{{ item.label }}</b>
            </button>
            <span v-if="isWeekly && weekLabel" class="week-range">{{ weekLabel }}</span>
            <span v-else-if="isChart" class="week-range">만점 41,200</span>
          </div>
          <div class="score-labels"><span>RANK</span><span>PLAYER</span><span>{{ isWeekly ? 'TOTAL' : 'SCORE' }}</span><span>PLAY</span></div>
          <button v-for="entry in pagedEntries" :key="entry.userId" class="score-row" :class="{ mine: board.myRank?.userId === entry.userId, elite: entry.rank <= 3, found: searchHit?.userId === entry.userId }" :title="achievedTitle(entry)" @click="openProfile(entry)">
            <span class="row-rank">{{ rankMark(entry.rank) }}</span>
            <span class="player"><UserAvatar :src="entry.avatarUrl" :fallback="entry.nickname.charAt(0)" :alt="`${entry.nickname} 프로필 사진`" /><b>{{ entry.nickname }}</b><i v-if="board.myRank?.userId === entry.userId">ME</i></span>
            <strong>{{ entry.score.toLocaleString() }}</strong>
            <small>{{ entry.playCount }}회</small>
          </button>
          <p v-if="!board.entries.length" class="empty">
            <template v-if="isChart">아직 아무도 도전하지 않았어요. 첫 만점의 주인공이 되어 보세요!</template>
            <template v-else-if="isWeekly">이번 주엔 아직 기록이 없어요. 첫 판의 주인공이 되어 보세요!</template>
            <template v-else>첫 기록의 주인공이 되어 보세요!</template>
          </p>
          <div v-if="totalPages > 1" class="pager"><button :disabled="page === 1" @click="page--">‹</button><span>{{ page }} / {{ totalPages }}</span><button :disabled="page === totalPages" @click="page++">›</button></div>
          <p v-if="error" class="error-message">{{ error }}</p>
        </section>

        <aside class="personal-card">
          <span class="personal-kicker">YOUR RECORD</span>
          <div class="personal-rank"><span>현재 순위</span><strong>#{{ board.myRank?.rank ?? '-' }}</strong></div>
          <div class="personal-score"><span>{{ isWeekly ? 'WEEK TOTAL' : 'BEST SCORE' }}</span><b>{{ board.myRank?.score?.toLocaleString() ?? '—' }}</b><small>POINTS</small></div>
          <div class="personal-meta"><span>플레이 <b>{{ board.myRank?.playCount ?? 0 }}회</b></span><span>{{ mode === 'MULTI' ? '멀티 모드' : '솔로 모드' }}</span></div>
          <div class="tip">
            <i>✦</i>
            <p v-if="isChart">만점은 41,200점!<br />동점이면 먼저 찍은 사람이 위예요.</p>
            <p v-else-if="isWeekly">주간은 매주 0에서 시작해요.<br />지금부터 쌓아도 따라잡을 수 있어요.</p>
            <p v-else>더 높은 곳을 향해!<br />한 판 더 도전해 보세요.</p>
          </div>
        </aside>
      </div>
    </section>

    <UserProfileModal v-if="viewer.isOpen.value" :user-id="viewer.targetId.value!" :profile="viewer.profile.value" :nickname="viewer.nickname.value" :loading="viewer.loading.value" :error="viewer.error.value" @close="viewer.close" @reported="flash" />
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
:global(html:has(.ranking-page)), :global(body:has(.ranking-page)) { scrollbar-width: none; }
:global(html:has(.ranking-page)::-webkit-scrollbar), :global(body:has(.ranking-page)::-webkit-scrollbar) { display: none; }
.ranking-page { background-color: #fff8e9; background-image: radial-gradient(rgba(56, 38, 61, .09) 1px, transparent 1px); background-size: 18px 18px; }.ranking-page :deep(.app-page) { padding: 28px 0 48px; }.ranking-page :deep(.hero), .ranking-page :deep(.body) { padding-right: clamp(18px, 4vw, 58px); padding-left: clamp(18px, 4vw, 58px); }.ranking-page :deep(.page-sticker) { display: none; }
.rank-stage { position: relative; display: flex; min-height: 262px; overflow: hidden; border: 0; border-radius: 18px; background: url('/assets/ranking-space-bg.png') center / cover; box-shadow: none; color: #493b54; }
.rank-stage::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(242,235,249,.82) 0%, rgba(237,226,245,.57) 47%, rgba(228,214,239,.16) 100%); }
.stage-copy { position: relative; z-index: 2; padding: 38px 46px; }.stage-kicker { color: #a8704f; font-size: 10px; letter-spacing: 1px; }.podium-title span, .board-head span, .personal-kicker { display: block; color: #95759c; font-size: 10px; letter-spacing: 1.4px; }.stage-copy h1 { margin: 11px 0 9px; font-family: var(--font-pixel); font-size: clamp(30px, 3vw, 43px); font-weight: 400; letter-spacing: -.8px; }.stage-copy h1 em { color: #866795; font-style: normal; text-shadow: 2px 2px 0 #fff8fa; }.stage-copy p { margin: 0; color: #685446; font-size: 14px; }
.trophy-scene { position: absolute; right: 20%; bottom: 0; width: 275px; height: 100%; }.champion-cat { position: absolute; z-index: 2; right: -22px; bottom: -33px; width: 320px; filter: drop-shadow(4px 6px 0 rgba(114,83,125,.12)); animation: champion-float 3.2s ease-in-out infinite; }.scene-floor { display: none; }.spark { position: absolute; z-index: 3; color: #b596c5; font-style: normal; font-size: 17px; }.spark-one { top: 33px; left: 10px; }.spark-two { top: 77px; right: 2px; font-size: 11px; }.spark-three { top: 27px; right: 52px; font-size: 7px; }
.my-rank-flag { position: relative; z-index: 3; display: flex; width: 145px; margin: 24px 25px 24px auto; flex-direction: column; align-items: center; justify-content: center; border: 2px solid #c8b5d1; border-radius: 11px; background: rgba(255,252,255,.56); box-shadow: 2px 2px 0 rgba(137,103,150,.16); }.my-rank-flag span { color: #95759c; font-size: 8px; letter-spacing: 1px; }.my-rank-flag strong { margin: 3px 0; color: #71527d; font-size: 35px; line-height: 1; }.my-rank-flag small { color: #866d8d; font-size: 9px; }
.ranking-panel { margin-top: 20px; }.ranking-controls { position: relative; z-index: 10; display: flex; justify-content: flex-end; align-items: end; gap: 10px; margin-bottom: 16px; }.game-picker { position: relative; order: 2; width: 210px; }.game-picker-trigger { display: flex; width: 100%; height: 41px; align-items: center; justify-content: space-between; padding: 7px 11px 7px 13px; border: 2px solid #bdaac3; border-radius: 9px; background: #fffdfb; box-shadow: 2px 2px 0 #e4d7e2; text-align: left; }.game-picker-trigger small { display: block; margin-bottom: 2px; color: #a087a4; font-size: 8px; letter-spacing: 1px; }.game-picker-trigger b { color: #59435f; font-size: 12px; }.game-picker-chevron { position: relative; display: block; width: 24px; height: 24px; flex: none; transition: transform .16s ease; }.game-picker-chevron::before, .game-picker-chevron::after { position: absolute; top: 11px; width: 9px; height: 2px; background: #82688a; content: ''; }.game-picker-chevron::before { left: 4px; transform: rotate(42deg); }.game-picker-chevron::after { right: 4px; transform: rotate(-42deg); }.game-picker-chevron.open { transform: scaleY(-1); }.game-menu { position: absolute; top: calc(100% + 6px); right: 0; left: 0; overflow: hidden; border: 2px solid #bdaac3; border-radius: 9px; background: #fffdfb; box-shadow: 4px 4px 0 rgba(157,127,169,.24); }.game-menu button { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 10px 13px; border: 0; border-bottom: 1px solid #eadfeb; background: transparent; color: #725d77; font-size: 11px; text-align: left; }.game-menu button:last-child { border-bottom: 0; }.game-menu button:hover, .game-menu button.selected { background: #eee3f1; color: #56405d; }.game-menu i { color: #8f699a; font-style: normal; }.mode-switch { order: 1; display: flex; height: 41px; overflow: hidden; border: 2px solid #bdaac3; border-radius: 9px; background: #fffdfb; box-shadow: 2px 2px 0 #e4d7e2; }.mode-switch button { display: flex; height: 100%; align-items: center; padding: 0 12px; border: 0; background: transparent; color: #846f86; font-size: 11px; }.mode-switch button + button { border-left: 1px solid #dfd1e0; }.mode-switch button.active { background: #cbb7d4; box-shadow: inset 0 -3px #9b7ca8; color: #493750; }.mode-switch i { margin-right: 5px; font-style: normal; }
/* 줄이 좁아질 때 줄어드는 건 검색 쪽이다 — 모드·게임 선택이 눌리면 버튼 글자가 두 줄로 접힌다 */
.player-search { order: 0; display: flex; flex: 1 1 auto; min-width: 0; align-items: center; flex-wrap: wrap; gap: 8px; margin-right: auto; }.mode-switch, .game-picker { flex: none; }.mode-switch button { white-space: nowrap; }.search-box { display: flex; height: 41px; overflow: hidden; border: 2px solid #bdaac3; border-radius: 9px; background: #fffdfb; box-shadow: 2px 2px 0 #e4d7e2; }
/* 돋보기까지 label로 감싸 아이콘을 눌러도 입력창에 커서가 간다(로비 방 검색과 같은 방식) */
.search-field { display: flex; height: 100%; align-items: center; gap: 6px; padding-left: 11px; }.search-icon { color: #9a83a0; font-size: 25px; font-style: normal; line-height: 1; }.search-box input { width: 158px; height: 100%; padding: 0 10px 0 0; border: 0; background: transparent; color: #59435f; font-size: 11px; outline: 0; }.search-box input::placeholder { color: #a892ab; }.search-box button { padding: 0 14px; border: 0; border-left: 1px solid #dfd1e0; background: #eee3f1; color: #6b5273; font-size: 11px; font-weight: 700; }.search-box button:hover { background: #e2d2e8; }.search-box button:disabled { color: #a892ab; cursor: default; }
/* 결과도 검색창과 같은 박스로 — 찾은 사람은 눌러서 프로필을 볼 수 있다 */
.search-result { display: flex; height: 41px; align-items: center; gap: 7px; margin: 0; padding: 0 12px 0 9px; border: 2px solid #bdaac3; border-radius: 9px; background: #fffdfb; box-shadow: 2px 2px 0 #e4d7e2; transition: var(--t-fast); }button.search-result:hover { background: #f8eef8; transform: translateY(-1px); }.search-result :deep(.user-avatar) { width: 26px; height: 26px; flex: none; border: 2px solid #765f72; border-radius: 50%; background: #f3e3ee; }.search-result b { color: #4f3a57; font-size: 11px; }.result-rank { padding: 3px 7px; border-radius: 999px; background: #eee3f1; color: #6b5273; font-size: 9px; font-weight: 700; }.search-result small { color: #9c8792; font-size: 9px; }.search-result.miss { border-style: dashed; border-color: #cfbcd2; background: #fbf6fa; box-shadow: none; color: #a3818b; font-size: 10px; }.search-moved { margin: 0; color: #8d7594; font-size: 9px; }
.podium-wrap { overflow: hidden; padding: 20px 24px 0; border: 2px solid #d4c2d7; border-radius: 15px; background: linear-gradient(135deg, #fff7e9, #f6ecfa); box-shadow: 4px 4px 0 #e1d0d5; }.podium-title { display: flex; align-items: center; gap: 10px; }.podium-title span { color: #9c6e73; }.podium-title b { font-size: 15px; }.podium { display: flex; height: 174px; align-items: end; justify-content: center; gap: 14px; }.podium-player { position: relative; display: flex; width: min(21vw, 160px); min-width: 105px; flex-direction: column; align-items: center; border: 0; background: transparent; color: #4a3748; }.podium-player :deep(.user-avatar) { position: relative; z-index: 2; width: 44px; height: 44px; border: 3px solid #4d3963; border-radius: 50%; background: #fff; box-shadow: 3px 3px 0 rgba(77,57,99,.25); }.podium-player strong { position: relative; z-index: 2; max-width: 100%; margin-top: 6px; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.podium-player small { position: relative; z-index: 2; margin: 3px 0 7px; color: #8e7080; font-size: 8px; }.podium-medal { position: absolute; z-index: 3; top: -10px; left: calc(50% + 11px); display: grid; width: 23px; height: 23px; place-items: center; border: 2px solid #4d3963; border-radius: 50%; background: #ffd05b; font-size: 10px; }.podium-block { display: grid; width: 100%; height: 48px; place-items: center; border: 2px solid #4d3963; border-bottom: 0; border-radius: 8px 8px 0 0; background: #d9c4e9; box-shadow: inset 0 4px rgba(255,255,255,.33); color: #725486; font-size: 22px; font-style: normal; }.place-1 { order: 2; }.place-1 .podium-block { height: 78px; background: #ffcb59; color: #9e6237; }.place-2 { order: 1; }.place-2 .podium-block { background: #bad2e2; color: #5e7185; }.place-3 { order: 3; }.place-3 .podium-block { height: 38px; background: #e9b59c; color: #9a604b; }.podium-empty { display: grid; width: 100%; height: 100%; place-items: center; padding: 0; color: var(--c-muted); font-size: 11px; text-align: center; }
.leaderboard-grid { display: grid; grid-template-columns: minmax(0, 1fr) 225px; gap: 18px; margin-top: 18px; }.scoreboard, .personal-card { border: 2px solid #cbbbc8; border-radius: 14px; background: #fffdf8; box-shadow: 4px 4px 0 #dfd0d8; }.scoreboard { overflow: hidden; }.board-head { display: flex; align-items: end; justify-content: space-between; padding: 18px 20px 13px; border-bottom: 2px dashed #e1d3df; }
/* 기간 탭 — 활성 탭만 카드 위로 떠 보이게(아래 테두리를 끊어 표 본문과 이어 붙인다) */
.period-tabs { display: flex; align-items: center; gap: 8px; padding: 12px 20px 0; border-bottom: 2px solid #e1d3df; }
.period-tabs button { padding: 10px 18px 11px; border: 2px solid #dccfdd; border-bottom: 0; border-radius: 9px 9px 0 0; background: #f6eff5; color: #97819c; transition: var(--t-fast); translate: 0 2px; }
.period-tabs button:hover { background: #f1e6f2; color: #7b6280; }
.period-tabs button.active { border-color: #bda7c6; background: #fffdf8; box-shadow: inset 0 3px #b492c4; color: #56405d; translate: 0 2px; }
.period-tabs button b { font-size: 12px; white-space: nowrap; }
.period-tabs .week-range { margin-left: auto; padding-bottom: 8px; color: #97819c; font-size: 10px; }.board-head span { color: #9a6f8c; }.board-head h2 { margin: 6px 0 0; font-size: 16px; }.board-head small { color: #a38d9d; font-size: 9px; }.score-labels, .score-row { display: grid; grid-template-columns: 64px minmax(130px, 1fr) 112px 60px; align-items: center; column-gap: 8px; }.score-labels { padding: 10px 20px 7px; color: #a5909b; font-size: 8px; }.score-row { width: 100%; min-height: 59px; padding: 7px 20px; border: 0; border-top: 1px solid #efe6ec; background: transparent; text-align: left; transition: var(--t-fast); }.score-row:hover { background: #f8eef8; transform: translateX(2px); }.score-row.mine { background: #fff4cc; box-shadow: inset 4px 0 0 #f1b933; }
/* 찾은 줄은 내 줄(노랑)과 구분되게 — 내가 나를 검색해도 어느 쪽이 검색 결과인지 알 수 있다 */
.score-row.found { background: #f2e4f8; box-shadow: inset 4px 0 0 #9b7ca8; }.row-rank { color: #8b7385; font-size: 12px; }.elite .row-rank { color: #b87838; }.player { display: flex; align-items: center; gap: 8px; min-width: 0; }.player :deep(.user-avatar) { width: 34px; height: 34px; flex: none; border: 2px solid #765f72; border-radius: 50%; background: #f3e3ee; }.player b { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.player i { padding: 3px 4px; border-radius: 3px; background: #e67a75; color: #fff; font-size: 7px; font-style: normal; }.score-row > strong { color: #60466d; font-size: 12px; }.score-row > small { color: #9c8792; font-size: 9px; }.empty { display: grid; min-height: 158px; margin: 0; place-items: center; padding: 32px 20px 24px; color: #9c8792; text-align: center; font-size: 11px; }.pager { display: flex; justify-content: center; gap: 10px; padding: 14px; border-top: 1px solid #efe6ec; font-size: 10px; }.pager button { width: 25px; border: 2px solid #806b80; border-radius: 5px; background: #fff; }.pager button:disabled { opacity: .35; cursor: default; }.error-message { margin: 0; padding: 0 14px 14px; color: #a85b65; font-size: 9px; }
.personal-card { align-self: start; overflow: hidden; padding: 20px; border-color: #c8b8ce; background: linear-gradient(150deg, #eee6f2, #dfd2e7); box-shadow: 3px 3px 0 #d6c8d9; color: #514059; }.personal-kicker { color: #96769e; }.personal-rank { display: flex; align-items: end; justify-content: space-between; margin-top: 13px; }.personal-rank span { color: #846f89; font-size: 10px; }.personal-rank strong { color: #795b88; font-size: 32px; line-height: .9; }.personal-score { margin-top: 19px; padding: 13px; border: 1px solid #cbbbd1; border-radius: 8px; background: rgba(255,253,255,.58); }.personal-score span, .personal-score small { display: block; color: #927e98; font-size: 8px; }.personal-score b { display: block; margin: 5px 0 2px; color: #664c72; font-size: 19px; }.personal-meta { display: flex; justify-content: space-between; margin-top: 13px; color: #806a88; font-size: 9px; }.personal-meta b { color: #674c73; }.tip { display: flex; gap: 8px; margin-top: 20px; padding-top: 13px; border-top: 1px dashed #bba9c2; }.tip i { color: #b08d52; font-style: normal; }.tip p { margin: 0; color: #745f7a; font-size: 9px; line-height: 1.55; }
@keyframes champion-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-11px); } }
@media (prefers-reduced-motion: reduce) { .champion-cat { animation: none; } }
@media (max-width: 760px) { .rank-stage { min-height: 300px; }.stage-copy { padding: 28px 25px; }.stage-copy p { max-width: 70%; }.trophy-scene { right: -54px; width: 220px; opacity: .78; }.champion-cat { right: -26px; bottom: -13px; width: 220px; }.my-rank-flag { position: absolute; right: 17px; bottom: 14px; width: 105px; height: 78px; margin: 0; }.my-rank-flag strong { font-size: 28px; }.ranking-controls { align-items: stretch; flex-direction: column; gap: 10px; }.game-picker { width: 100%; }.mode-switch { align-self: flex-end; }.podium-wrap { padding-right: 10px; padding-left: 10px; }.podium { gap: 4px; }.podium-player { min-width: 82px; }.leaderboard-grid { grid-template-columns: 1fr; }.personal-card { display: none; }.score-labels, .score-row { grid-template-columns: 44px minmax(100px, 1fr) 78px; }.score-labels span:last-child, .score-row > small { display: none; }.score-labels, .score-row { padding-right: 13px; padding-left: 13px; }.board-head { padding-right: 13px; padding-left: 13px; }.board-head small { display: none; }
/* 좁은 화면에선 탭 셋이 헤더 폭을 다 먹으므로 여백을 줄인다 */
.period-tabs { gap: 5px; padding-right: 13px; padding-left: 13px; }.period-tabs button { padding: 9px 11px 10px; }.period-tabs button b { font-size: 11px; }.period-tabs .week-range { font-size: 9px; } }
</style>
