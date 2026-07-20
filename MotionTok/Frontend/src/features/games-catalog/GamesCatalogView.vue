<script setup lang="ts">
/** 게임 목록/카탈로그 + 상세(규칙·조작) 모달 (API §5 /games, /games/{id}). */
import { computed, ref } from 'vue'
import { gamesApi, ApiError, type Game, type GameDetail } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useSessionStore } from '@/stores/session'
import AppPage from '@/components/common/AppPage.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const session = useSessionStore()

const EMOJI: Record<string, string> = {
  '핑거 스타': '✨', '리듬 펀치': '🥊', '모션 피싱': '🎣',
  '드로잉 릴레이': '🎨', '포즈 매치': '🤸', '버블 팝': '🫧',
}
const MOCK_GAMES: Game[] = [
  { id: 1, name: '핑거 스타', description: '손가락으로 별자리 만들기', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '손동작', thumbnailUrl: '', playable: true },
  { id: 2, name: '모션 피싱', description: '온몸으로 즐기는 낚시', mode: 'SOLO', minPlayers: 1, maxPlayers: 4, supportsBot: false, category: '전신', thumbnailUrl: '', playable: true },
  { id: 3, name: '리듬 펀치', description: '비트에 맞춰 펀치!', mode: 'VERSUS', minPlayers: 1, maxPlayers: 8, supportsBot: true, category: '리듬', thumbnailUrl: '', playable: true },
  { id: 5, name: '포즈 매치', description: '화면 속 포즈를 따라해요', mode: 'VERSUS', minPlayers: 2, maxPlayers: 8, supportsBot: true, category: '전신', thumbnailUrl: '', playable: false },
  { id: 6, name: '드로잉 릴레이', description: '몸으로 그리고 맞히기', mode: 'COOP', minPlayers: 3, maxPlayers: 8, supportsBot: false, category: '파티', thumbnailUrl: '', playable: false },
]

const { data: games } = useAsyncData(() => gamesApi.list(), MOCK_GAMES)

// 게스트는 1인 플레이 가능한 게임만 노출 (minPlayers === 1)
const visibleGames = computed(() =>
  session.isGuest ? games.value.filter((g) => g.minPlayers === 1) : games.value,
)

const detail = ref<GameDetail | null>(null)
const detailOpen = ref(false)

async function openDetail(g: Game) {
  detailOpen.value = true
  detail.value = { id: g.id, name: g.name, rules: '규칙을 불러오는 중…', controls: '' }
  try {
    detail.value = await gamesApi.detail(g.id)
  } catch (e) {
    detail.value = {
      id: g.id,
      name: g.name,
      rules: e instanceof ApiError ? e.message : `${g.description} (상세는 백엔드 연동 예정)`,
      controls: '카메라 앞에서 손·몸을 움직여 플레이합니다.',
    }
  }
}
</script>

<template>
  <AppPage title="게임 목록" subtitle="플레이할 게임을 골라보세요">
    <div v-if="session.isGuest" class="guest-note">
      👋 게스트는 <b>1인 게임</b>만 플레이할 수 있어요. 멀티플레이는 로그인 후 이용하세요.
    </div>

    <div class="grid">
      <article
        v-for="g in visibleGames"
        :key="g.id"
        class="game"
        :class="{ dim: !g.playable }"
        @click="openDetail(g)"
      >
        <div class="thumb">
          <span>{{ EMOJI[g.name] ?? '🎮' }}</span>
          <span class="tag">{{ g.playable ? g.category : 'SOON' }}</span>
        </div>
        <div class="copy">
          <strong>{{ g.name }}</strong>
          <small>{{ g.description }}</small>
          <div class="meta">{{ g.minPlayers }}~{{ g.maxPlayers }}인 · {{ g.mode }}<template v-if="g.supportsBot"> · 봇</template></div>
        </div>
      </article>
    </div>

    <PixelModal v-if="detailOpen && detail" @close="detailOpen = false">
      <h3>{{ detail.name }}</h3>
      <p class="sec-label">규칙</p>
      <p class="sec">{{ detail.rules }}</p>
      <template v-if="detail.controls">
        <p class="sec-label">조작 방법</p>
        <p class="sec">{{ detail.controls }}</p>
      </template>
      <PixelButton variant="primary" block @click="detailOpen = false">닫기</PixelButton>
    </PixelModal>
  </AppPage>
</template>

<style scoped>
.guest-note {
  margin-bottom: 16px;
  padding: 11px 14px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff1d2;
  font-size: 11px;
}
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.game { border: var(--border); border-radius: 17px 17px 13px 17px; background: #fff; box-shadow: var(--shadow-md); overflow: hidden; cursor: pointer; transition: var(--t-fast); }
.game:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-lg); }
.game.dim { opacity: 0.72; }
.thumb { height: 100px; position: relative; display: grid; place-items: center; font-size: 44px; border-bottom: var(--border); background: var(--tone-2); }
.tag { position: absolute; top: 8px; left: 8px; padding: 4px 7px; background: #fff; border: 2px solid var(--c-ink); border-radius: 8px; font-size: 8px; font-weight: 700; }
.copy { padding: 11px 12px 13px; }
.copy strong { display: block; font-size: 12px; }
.copy small { display: block; color: var(--c-muted); font-size: 9px; margin-top: 5px; }
.meta { margin-top: 7px; font-size: 8px; color: var(--c-muted); }

h3 { margin: 0 0 12px; }
.sec-label { margin: 12px 0 4px; font-size: 9px; font-weight: 700; color: var(--c-blue); }
.sec { margin: 0 0 8px; font-size: 11px; line-height: 1.6; color: #55495a; }
</style>
