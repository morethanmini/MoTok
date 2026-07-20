<script setup lang="ts">
/** 랭킹 — 게임 선택 + 리더보드 + 내 순위 (API §5 /games/{id}/leaderboard). */
import { onMounted, ref, watch } from 'vue'
import { gamesApi, ApiError, type Game, type LeaderboardResponse } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'

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
</script>

<template>
  <AppPage title="랭킹" subtitle="게임별 최고 점수 리더보드">
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
            :class="{ me: board.myRank && e.userId === board.myRank.userId, top: e.rank <= 3 }"
          >
            <td class="rank">{{ e.rank <= 3 ? ['🥇','🥈','🥉'][e.rank - 1] : `#${e.rank}` }}</td>
            <td>{{ e.nickname }}</td>
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
  </AppPage>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.chip { border: 2px solid var(--c-ink); background: #fff; border-radius: 999px; padding: 8px 14px; font-size: 11px; box-shadow: 2px 2px 0 #d8c9d8; }
.chip.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.board { width: 100%; border-collapse: collapse; font-size: 12px; }
.board th, .board td { padding: 11px 8px; text-align: left; border-bottom: 2px dashed #eaddea; }
.board th { font-size: 9px; color: var(--c-muted); }
.board .rank { font-size: 15px; }
.board tr.top td { font-weight: 700; }
.board tr.me { background: #fff7d9; }
.myrank { margin-top: 14px; padding: 11px 14px; border: 2px solid var(--c-ink); border-radius: 12px; background: var(--c-mint-soft); font-size: 11px; }
.myrank b { color: var(--c-blue); font-size: 14px; }
.err { margin-top: 12px; font-size: 10px; color: var(--c-muted); }
</style>
