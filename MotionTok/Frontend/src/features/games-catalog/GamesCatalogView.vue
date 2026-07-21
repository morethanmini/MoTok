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
const ART: Record<string, string> = {
  '핑거 스타': '/assets/intro/constellation.png',
  '리듬 펀치': '/assets/intro/tambourine.png',
  '모션 피싱': '/assets/intro/fishing-rod.png',
  '드로잉 릴레이': '/assets/intro/sketchbook.png',
  '포즈 매치': '/assets/intro/person.png',
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
    <template #hero>
      <section class="catalog-hero">
        <div>
          <span class="px-kicker">🎮 TODAY'S PARTY</span>
          <h2>오늘은 어떤 움직임으로 놀까요?</h2>
          <p>손끝부터 온몸까지, 카메라 앞에서 바로 시작하는 모션 게임이에요.</p>
        </div>
        <img src="/assets/intro/person.png" alt="몸을 움직이는 캐릭터" />
      </section>
    </template>
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
        <div class="thumb" :class="`tone-${(g.id % 5) + 1}`">
          <span class="spark">✦</span>
          <img v-if="ART[g.name]" :src="ART[g.name]" :alt="g.name" />
          <span v-else class="fallback">{{ EMOJI[g.name] ?? '🎮' }}</span>
          <span class="tag">{{ g.playable ? g.category : 'SOON' }}</span>
          <span class="play">▶</span>
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
.catalog-hero {
  height: 150px;
  margin-bottom: 18px;
  padding: 22px 28px;
  display: flex;
  align-items: center;
  overflow: hidden;
  border: var(--border);
  border-radius: 21px 21px 15px 21px;
  background: linear-gradient(120deg, #dff5ed 0 58%, #ffe3d5 58%);
  box-shadow: var(--shadow-lg);
}
.catalog-hero h2 { margin: 12px 0 6px; font-size: 19px; }
.catalog-hero p { margin: 0; color: var(--c-muted); font-size: 10px; }
.catalog-hero img { width: 190px; margin-left: auto; transform: translateY(18px) rotate(3deg); }
.guest-note {
  margin-bottom: 16px;
  padding: 11px 14px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff1d2;
  font-size: 11px;
}
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 17px; }
.game { border: var(--border); border-radius: 17px 17px 13px 17px; background: #fff; box-shadow: var(--shadow-md); overflow: hidden; cursor: pointer; transition: var(--t-fast); }
.game:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-lg); }
.game.dim { opacity: 0.72; }
.thumb { height: 146px; position: relative; display: grid; place-items: center; overflow: hidden; border-bottom: var(--border); background: var(--tone-2); }
.thumb::after { content: ''; position: absolute; inset: auto 0 0; height: 34%; background: linear-gradient(transparent, rgba(56,38,61,.12)); }
.thumb img { width: 75%; height: 86%; object-fit: contain; position: relative; z-index: 1; transition: transform .18s steps(3); }
.game:hover .thumb img { transform: translateY(-5px) rotate(-2deg) scale(1.05); }
.fallback { font-size: 50px; }
.tone-1 { background: var(--tone-1); } .tone-2 { background: var(--tone-2); }
.tone-3 { background: var(--tone-3); } .tone-4 { background: var(--tone-4); }
.tone-5 { background: var(--tone-5); }
.spark { position: absolute; right: 12px; top: 10px; color: var(--c-yellow); font-size: 21px; text-shadow: 2px 2px 0 var(--c-ink); animation: px-twinkle 1.8s steps(2) infinite; }
.tag { position: absolute; top: 8px; left: 8px; padding: 4px 7px; background: #fff; border: 2px solid var(--c-ink); border-radius: 8px; font-size: 8px; font-weight: 700; }
.play { position: absolute; z-index: 2; right: 10px; bottom: 9px; width: 31px; height: 31px; display: grid; place-items: center; border: 2px solid var(--c-ink); border-radius: 9px; background: var(--c-yellow); box-shadow: 2px 2px 0 var(--c-ink); font-size: 10px; }
.copy { padding: 14px 14px 16px; }
.copy strong { display: block; font-size: 13px; }
.copy small { display: block; color: var(--c-muted); font-size: 9px; margin-top: 5px; }
.meta { margin-top: 7px; font-size: 8px; color: var(--c-muted); }

h3 { margin: 0 0 12px; }
.sec-label { margin: 12px 0 4px; font-size: 9px; font-weight: 700; color: var(--c-blue); }
.sec { margin: 0 0 8px; font-size: 11px; line-height: 1.6; color: #55495a; }
</style>
