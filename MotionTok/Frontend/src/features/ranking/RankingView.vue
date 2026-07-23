<script setup lang="ts">
/** 랭킹 — 게임 선택 + 리더보드 + 내 순위 (API §5 /games/{id}/leaderboard). */
import { onMounted, ref, watch } from 'vue'
import {
  gamesApi,
  usersApi,
  ApiError,
  type Game,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type PublicUserProfile,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useSessionStore } from '@/stores/session'
import { askLogin } from '@/composables/useLoginRequired'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import UserProfileModal from './components/UserProfileModal.vue'

const MOCK_GAMES: Game[] = [
  { id: 1, name: '핑거 스타', description: '', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '손동작', thumbnailUrl: '', playable: true },
  { id: 3, name: '리듬 펀치', description: '', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '리듬', thumbnailUrl: '', playable: true },
  { id: 5, name: '포즈 매치', description: '', mode: 'VERSUS', minPlayers: 2, maxPlayers: 8, supportsBot: true, category: '전신', thumbnailUrl: '', playable: true },
]
const MOCK_BOARD: LeaderboardResponse = {
  gameId: 1,
  entries: [
    { rank: 1, userId: 10, nickname: '별잡이', bestScore: 9980, playCount: 42 },
    { rank: 2, userId: 11, nickname: '민지', bestScore: 9850, playCount: 30 },
    { rank: 3, userId: 1, nickname: 'P1', bestScore: 9720, playCount: 12 },
    { rank: 4, userId: 12, nickname: 'Alex', bestScore: 9310, playCount: 25 },
  ],
  myRank: { rank: 3, userId: 1, nickname: 'P1', bestScore: 9720, playCount: 12 },
}

const { data: games } = useAsyncData(() => gamesApi.list(), MOCK_GAMES)
const selected = ref<number>(1)
const board = ref<LeaderboardResponse>(MOCK_BOARD)
const error = ref<string | null>(null)

async function loadBoard() {
  error.value = null
  try {
    board.value = await gamesApi.leaderboard(selected.value)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '리더보드 로드 실패 (백엔드 미연동)'
    board.value = { ...MOCK_BOARD, gameId: selected.value }
  }
}
onMounted(loadBoard)
watch(selected, loadBoard)

// ── 다른 사용자 프로필 조회 (-96) ────────────────────────────
// 공개 프로필도 회원 전용이라(SecurityConfig /api/users/**) 게스트·비로그인은 로그인 안내로 유도한다.
const session = useSessionStore()

const selectedEntry = ref<LeaderboardEntry | null>(null)
const selectedProfile = ref<PublicUserProfile | null>(null)
const profileLoading = ref(false)
const profileError = ref('')

async function openProfile(entry: LeaderboardEntry) {
  if (!session.isMember) {
    askLogin('다른 사용자의 프로필은 로그인 후 볼 수 있어요.')
    return
  }
  selectedEntry.value = entry
  selectedProfile.value = null
  profileError.value = ''
  profileLoading.value = true
  try {
    selectedProfile.value = await usersApi.getProfile(entry.userId)
  } catch (e) {
    profileError.value =
      e instanceof ApiError && e.status === 404
        ? '탈퇴했거나 조회할 수 없는 계정이에요.'
        : e instanceof ApiError
          ? e.message
          : '프로필을 불러오지 못했어요.'
  } finally {
    profileLoading.value = false
  }
}

function closeProfile() {
  selectedEntry.value = null
}
</script>

<template>
  <AppPage title="랭킹" subtitle="게임별 최고 점수 리더보드">
    <template #hero>
      <section class="rank-hero">
        <img src="/assets/intro/trophy.png" alt="트로피" />
        <div><span class="px-kicker">HALL OF MOTION</span><h2>이번 주 최고의 플레이어</h2><p>움직이고, 기록을 깨고, 명예의 전당에 올라보세요.</p></div>
        <strong>#{{ board.myRank?.rank ?? '-' }}<small>MY RANK</small></strong>
      </section>
    </template>
    <div class="chips">
      <button
        v-for="g in games"
        :key="g.id"
        class="chip"
        :class="{ on: selected === g.id }"
        @click="selected = g.id"
      >
        {{ g.name }}
      </button>
    </div>

    <PixelCard>
      <table class="board">
        <thead>
          <tr><th>순위</th><th>닉네임</th><th>최고점수</th><th>플레이</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="e in board.entries"
            :key="e.userId"
            class="row"
            :class="{ me: board.myRank && e.userId === board.myRank.userId, top: e.rank <= 3 }"
            @click="openProfile(e)"
          >
            <td class="rank">{{ e.rank <= 3 ? ['🥇','🥈','🥉'][e.rank - 1] : `#${e.rank}` }}</td>
            <td><button type="button" class="name">{{ e.nickname }}</button></td>
            <td>{{ e.bestScore.toLocaleString() }}</td>
            <td>{{ e.playCount }}회</td>
          </tr>
        </tbody>
      </table>

      <div v-if="board.myRank" class="myrank">
        내 순위 <b>#{{ board.myRank.rank }}</b> · {{ board.myRank.bestScore.toLocaleString() }}점
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </PixelCard>

    <UserProfileModal
      v-if="selectedEntry"
      :entry="selectedEntry"
      :profile="selectedProfile"
      :loading="profileLoading"
      :error="profileError"
      @close="closeProfile"
    />
  </AppPage>
</template>

<style scoped>
.rank-hero { height: 142px; margin-bottom: 18px; padding: 15px 24px; display: flex; align-items: center; gap: 20px; overflow: hidden; border: var(--border); border-radius: 21px; background: linear-gradient(110deg, #fff0b9, #ffd9c9); box-shadow: var(--shadow-lg); }
.rank-hero img { width: 116px; filter: drop-shadow(5px 5px 0 rgba(56,38,61,.16)); } .rank-hero h2 { margin: 10px 0 5px; font-size: 18px; } .rank-hero p { margin: 0; color: var(--c-muted); font-size: 9px; }
.rank-hero > strong { margin-left: auto; text-align: center; color: var(--c-blue); font-size: 28px; text-shadow: 2px 2px 0 #fff; } .rank-hero > strong small { display: block; margin-top: 4px; color: var(--c-ink); font-size: 7px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.chip { border: 2px solid var(--c-ink); background: #fff; border-radius: 999px; padding: 8px 14px; font-size: 11px; box-shadow: 2px 2px 0 #d8c9d8; }
.chip.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.board { width: 100%; border-collapse: collapse; font-size: 12px; }
.board th, .board td { padding: 11px 8px; text-align: left; border-bottom: 2px dashed #eaddea; }
.board th { font-size: 9px; color: var(--c-muted); }
.board .rank { font-size: 15px; }
.board tr.top td { font-weight: 700; }
.board tr.me { background: #fff7d9; box-shadow: inset 4px 0 0 var(--c-yellow); }
.board tr.row { cursor: pointer; }
.board tr.row:hover { background: var(--c-mint-soft); }
.board .name { border: 0; background: transparent; padding: 0; font: inherit; text-decoration: underline; }
.myrank { margin-top: 14px; padding: 11px 14px; border: 2px solid var(--c-ink); border-radius: 12px; background: var(--c-mint-soft); font-size: 11px; }
.myrank b { color: var(--c-blue); font-size: 14px; }
.err { margin-top: 12px; font-size: 10px; color: var(--c-muted); }
</style>
