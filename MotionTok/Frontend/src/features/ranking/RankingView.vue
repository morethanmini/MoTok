<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  gamesApi,
  ApiError,
  type Game,
  type LeaderboardEntry,
  type LeaderboardMode,
  type LeaderboardResponse,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useUserProfile } from '@/composables/useUserProfile'
import { useToast } from '@/composables/useToast'
import AppPage from '@/components/common/AppPage.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import UserProfileModal from '@/components/common/UserProfileModal.vue'

const MOCK_GAMES: Game[] = [
  { id: 1, name: '손가락 별', description: '', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '모션', thumbnailUrl: '', playable: true, active: true },
  { id: 3, name: '리듬 터치', description: '', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '리듬', thumbnailUrl: '', playable: true, active: true },
  { id: 5, name: '자세 매치', description: '', mode: 'VERSUS', minPlayers: 2, maxPlayers: 8, supportsBot: true, category: '피트니스', thumbnailUrl: '', playable: true, active: true },
]
const MOCK_BOARD: LeaderboardResponse = {
  gameId: 1,
  entries: [
    { rank: 1, userId: 10, nickname: '별잡이', bestScore: 9980, playCount: 42 },
    { rank: 2, userId: 11, nickname: '민수', bestScore: 9850, playCount: 30 },
    { rank: 3, userId: 1, nickname: 'P1', bestScore: 9720, playCount: 12 },
    { rank: 4, userId: 12, nickname: 'Alex', bestScore: 9310, playCount: 25 },
  ],
  myRank: { rank: 3, userId: 1, nickname: 'P1', bestScore: 9720, playCount: 12 },
}

const { data: games } = useAsyncData(() => gamesApi.list(), MOCK_GAMES)
const selected = ref(1)
const board = ref<LeaderboardResponse>(MOCK_BOARD)
const error = ref<string | null>(null)
const MODES = [
  { value: 'MULTI', label: '멀티 플레이' },
  { value: 'SOLO', label: '혼자 플레이' },
] as const
const mode = ref<LeaderboardMode>('MULTI')
const gameMenuOpen = ref(false)
const FETCH_LIMIT = 100
const PAGE_SIZE = 10
const page = ref(1)

async function loadBoard() {
  error.value = null
  try {
    board.value = await gamesApi.leaderboard(selected.value, mode.value, FETCH_LIMIT)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '랭킹을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    board.value = { ...MOCK_BOARD, gameId: selected.value }
  }
  page.value = 1
}
onMounted(loadBoard)
watch([selected, mode], loadBoard)

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
          <span>MY BEST</span>
          <strong>#{{ board.myRank?.rank ?? '-' }}</strong>
          <small>{{ board.myRank ? `${board.myRank.bestScore.toLocaleString()} PTS` : 'PLAY NOW' }}</small>
        </div>
      </section>
    </template>

    <section class="ranking-panel">
      <div class="ranking-controls">
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
        <div class="mode-switch" aria-label="랭킹 모드 선택">
          <button v-for="item in MODES" :key="item.value" :class="{ active: mode === item.value }" @click="mode = item.value">
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="podium-wrap">
        <div class="podium-title"><span>TOP PLAYERS</span><b>이번 주의 챔피언</b></div>
        <div class="podium">
          <button v-for="entry in podiumEntries" :key="entry.userId" class="podium-player" :class="`place-${entry.rank}`" @click="openProfile(entry)">
            <span class="podium-medal">{{ rankMark(entry.rank) }}</span>
            <UserAvatar :src="entry.avatarUrl" :fallback="entry.nickname.charAt(0)" :alt="`${entry.nickname} 프로필 사진`" />
            <strong>{{ entry.nickname }}</strong>
            <small>{{ entry.bestScore.toLocaleString() }} PTS</small>
            <i class="podium-block">{{ entry.rank }}</i>
          </button>
          <div v-if="!podiumEntries.length" class="podium-empty">아직 랭킹 기록이 없어요.</div>
        </div>
      </div>

      <div class="leaderboard-grid">
        <section class="scoreboard">
          <header class="board-head"><div><span>LEADERBOARD</span><h2>{{ selectedGame }} 전체 순위</h2></div><small>프로필을 눌러 확인해 보세요</small></header>
          <div class="score-labels"><span>RANK</span><span>PLAYER</span><span>SCORE</span><span>PLAY</span></div>
          <button v-for="entry in pagedEntries" :key="entry.userId" class="score-row" :class="{ mine: board.myRank?.userId === entry.userId, elite: entry.rank <= 3 }" @click="openProfile(entry)">
            <span class="row-rank">{{ rankMark(entry.rank) }}</span>
            <span class="player"><UserAvatar :src="entry.avatarUrl" :fallback="entry.nickname.charAt(0)" :alt="`${entry.nickname} 프로필 사진`" /><b>{{ entry.nickname }}</b><i v-if="board.myRank?.userId === entry.userId">ME</i></span>
            <strong>{{ entry.bestScore.toLocaleString() }}</strong>
            <small>{{ entry.playCount }}회</small>
          </button>
          <p v-if="!board.entries.length" class="empty">첫 기록의 주인공이 되어 보세요!</p>
          <div v-if="totalPages > 1" class="pager"><button :disabled="page === 1" @click="page--">‹</button><span>{{ page }} / {{ totalPages }}</span><button :disabled="page === totalPages" @click="page++">›</button></div>
          <p v-if="error" class="error-message">{{ error }}</p>
        </section>

        <aside class="personal-card">
          <span class="personal-kicker">YOUR RECORD</span>
          <div class="personal-rank"><span>현재 순위</span><strong>#{{ board.myRank?.rank ?? '-' }}</strong></div>
          <div class="personal-score"><span>BEST SCORE</span><b>{{ board.myRank?.bestScore?.toLocaleString() ?? '—' }}</b><small>POINTS</small></div>
          <div class="personal-meta"><span>플레이 <b>{{ board.myRank?.playCount ?? 0 }}회</b></span><span>{{ mode === 'MULTI' ? '멀티 모드' : '솔로 모드' }}</span></div>
          <div class="tip"><i>✦</i><p>더 높은 곳을 향해!<br />한 판 더 도전해 보세요.</p></div>
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
.podium-wrap { overflow: hidden; padding: 20px 24px 0; border: 2px solid #d4c2d7; border-radius: 15px; background: linear-gradient(135deg, #fff7e9, #f6ecfa); box-shadow: 4px 4px 0 #e1d0d5; }.podium-title { display: flex; align-items: center; gap: 10px; }.podium-title span { color: #9c6e73; }.podium-title b { font-size: 15px; }.podium { display: flex; height: 174px; align-items: end; justify-content: center; gap: 14px; }.podium-player { position: relative; display: flex; width: min(21vw, 160px); min-width: 105px; flex-direction: column; align-items: center; border: 0; background: transparent; color: #4a3748; }.podium-player :deep(.user-avatar) { position: relative; z-index: 2; width: 44px; height: 44px; border: 3px solid #4d3963; border-radius: 50%; background: #fff; box-shadow: 3px 3px 0 rgba(77,57,99,.25); }.podium-player strong { position: relative; z-index: 2; max-width: 100%; margin-top: 6px; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.podium-player small { position: relative; z-index: 2; margin: 3px 0 7px; color: #8e7080; font-size: 8px; }.podium-medal { position: absolute; z-index: 3; top: -10px; left: calc(50% + 11px); display: grid; width: 23px; height: 23px; place-items: center; border: 2px solid #4d3963; border-radius: 50%; background: #ffd05b; font-size: 10px; }.podium-block { display: grid; width: 100%; height: 48px; place-items: center; border: 2px solid #4d3963; border-bottom: 0; border-radius: 8px 8px 0 0; background: #d9c4e9; box-shadow: inset 0 4px rgba(255,255,255,.33); color: #725486; font-size: 22px; font-style: normal; }.place-1 { order: 2; }.place-1 .podium-block { height: 78px; background: #ffcb59; color: #9e6237; }.place-2 { order: 1; }.place-2 .podium-block { background: #bad2e2; color: #5e7185; }.place-3 { order: 3; }.place-3 .podium-block { height: 38px; background: #e9b59c; color: #9a604b; }.podium-empty { display: grid; width: 100%; height: 100%; place-items: center; padding: 0; color: var(--c-muted); font-size: 11px; text-align: center; }
.leaderboard-grid { display: grid; grid-template-columns: minmax(0, 1fr) 225px; gap: 18px; margin-top: 18px; }.scoreboard, .personal-card { border: 2px solid #cbbbc8; border-radius: 14px; background: #fffdf8; box-shadow: 4px 4px 0 #dfd0d8; }.scoreboard { overflow: hidden; }.board-head { display: flex; align-items: end; justify-content: space-between; padding: 18px 20px 13px; border-bottom: 2px dashed #e1d3df; }.board-head span { color: #9a6f8c; }.board-head h2 { margin: 6px 0 0; font-size: 16px; }.board-head small { color: #a38d9d; font-size: 9px; }.score-labels, .score-row { display: grid; grid-template-columns: 64px minmax(130px, 1fr) 112px 60px; align-items: center; column-gap: 8px; }.score-labels { padding: 10px 20px 7px; color: #a5909b; font-size: 8px; }.score-row { width: 100%; min-height: 59px; padding: 7px 20px; border: 0; border-top: 1px solid #efe6ec; background: transparent; text-align: left; transition: var(--t-fast); }.score-row:hover { background: #f8eef8; transform: translateX(2px); }.score-row.mine { background: #fff4cc; box-shadow: inset 4px 0 0 #f1b933; }.row-rank { color: #8b7385; font-size: 12px; }.elite .row-rank { color: #b87838; }.player { display: flex; align-items: center; gap: 8px; min-width: 0; }.player :deep(.user-avatar) { width: 34px; height: 34px; flex: none; border: 2px solid #765f72; border-radius: 50%; background: #f3e3ee; }.player b { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.player i { padding: 3px 4px; border-radius: 3px; background: #e67a75; color: #fff; font-size: 7px; font-style: normal; }.score-row > strong { color: #60466d; font-size: 12px; }.score-row > small { color: #9c8792; font-size: 9px; }.empty { display: grid; min-height: 158px; margin: 0; place-items: center; padding: 32px 20px 24px; color: #9c8792; text-align: center; font-size: 11px; }.pager { display: flex; justify-content: center; gap: 10px; padding: 14px; border-top: 1px solid #efe6ec; font-size: 10px; }.pager button { width: 25px; border: 2px solid #806b80; border-radius: 5px; background: #fff; }.pager button:disabled { opacity: .35; cursor: default; }.error-message { margin: 0; padding: 0 14px 14px; color: #a85b65; font-size: 9px; }
.personal-card { align-self: start; overflow: hidden; padding: 20px; border-color: #c8b8ce; background: linear-gradient(150deg, #eee6f2, #dfd2e7); box-shadow: 3px 3px 0 #d6c8d9; color: #514059; }.personal-kicker { color: #96769e; }.personal-rank { display: flex; align-items: end; justify-content: space-between; margin-top: 13px; }.personal-rank span { color: #846f89; font-size: 10px; }.personal-rank strong { color: #795b88; font-size: 32px; line-height: .9; }.personal-score { margin-top: 19px; padding: 13px; border: 1px solid #cbbbd1; border-radius: 8px; background: rgba(255,253,255,.58); }.personal-score span, .personal-score small { display: block; color: #927e98; font-size: 8px; }.personal-score b { display: block; margin: 5px 0 2px; color: #664c72; font-size: 19px; }.personal-meta { display: flex; justify-content: space-between; margin-top: 13px; color: #806a88; font-size: 9px; }.personal-meta b { color: #674c73; }.tip { display: flex; gap: 8px; margin-top: 20px; padding-top: 13px; border-top: 1px dashed #bba9c2; }.tip i { color: #b08d52; font-style: normal; }.tip p { margin: 0; color: #745f7a; font-size: 9px; line-height: 1.55; }
@keyframes champion-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-11px); } }
@media (prefers-reduced-motion: reduce) { .champion-cat { animation: none; } }
@media (max-width: 760px) { .rank-stage { min-height: 300px; }.stage-copy { padding: 28px 25px; }.stage-copy p { max-width: 70%; }.trophy-scene { right: -54px; width: 220px; opacity: .78; }.champion-cat { right: -26px; bottom: -13px; width: 220px; }.my-rank-flag { position: absolute; right: 17px; bottom: 14px; width: 105px; height: 78px; margin: 0; }.my-rank-flag strong { font-size: 28px; }.ranking-controls { align-items: stretch; flex-direction: column; gap: 10px; }.game-picker { width: 100%; }.mode-switch { align-self: flex-end; }.podium-wrap { padding-right: 10px; padding-left: 10px; }.podium { gap: 4px; }.podium-player { min-width: 82px; }.leaderboard-grid { grid-template-columns: 1fr; }.personal-card { display: none; }.score-labels, .score-row { grid-template-columns: 44px minmax(100px, 1fr) 78px; }.score-labels span:last-child, .score-row > small { display: none; }.score-labels, .score-row { padding-right: 13px; padding-left: 13px; }.board-head { padding-right: 13px; padding-left: 13px; }.board-head small { display: none; } }
</style>
