<script setup lang="ts">
/** 게임 결과 — 시상대 랭킹 + 획득 포인트. */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import PixelButton from '@/components/common/PixelButton.vue'

const route = useRoute()
const router = useRouter()

const game = computed(() => (route.query.game as string) || '리듬 펀치')
const room = computed(() => (route.query.room as string) || 'MP4X9K')

interface Rank {
  face: string
  name: string
  score: string
  first?: boolean
}
const ranks: Rank[] = [
  { face: '🐰', name: '민지 · 2위', score: '8,420' },
  { face: '😎', name: 'P1 · 1위', score: '9,850', first: true },
  { face: '🦊', name: 'Alex · 3위', score: '7,960' },
]

function backToRoom() {
  router.push({
    name: RouteName.GameRoom,
    query: { game: game.value, room: room.value, host: '1' },
  })
}
</script>

<template>
  <main class="page">
    <img class="confetti trophy" src="/assets/intro/trophy.png" alt="트로피" />
    <img class="confetti console" src="/assets/intro/console.png" alt="" />
    <i class="star s1">★</i><i class="star s2">✦</i><i class="star s3">★</i>
    <section class="card">
      <header class="title">
        <span class="px-kicker">★ MOTOK PARTY RESULT</span>
        <b>GAME CLEAR!</b>
        <p>{{ game }} 결과가 집계되었어요.</p>
      </header>

      <div class="podium">
        <div v-for="r in ranks" :key="r.name" class="rank" :class="{ first: r.first }">
          <span v-if="r.first" class="crown">♛</span>
          <div class="face">{{ r.face }}</div>
          <strong>{{ r.name }}</strong>
          <span>{{ r.score }}</span>
        </div>
      </div>

      <div class="reward">
        획득 포인트 <b>＋320 P</b>
        <span>카메라 꾸미기 아이템에 사용할 수 있어요!</span>
      </div>

      <div class="actions">
        <PixelButton variant="yellow" size="lg" block @click="backToRoom">↻ 같은 게임 다시하기</PixelButton>
        <PixelButton size="lg" block @click="backToRoom">대기실로 돌아가기</PixelButton>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  height: 100%;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  background-color: #fff4d7;
  background-image:
    linear-gradient(32deg, transparent 0 47%, rgba(72,200,164,.14) 47% 53%, transparent 53%),
    linear-gradient(145deg, transparent 0 47%, rgba(239,104,114,.12) 47% 53%, transparent 53%),
    radial-gradient(rgba(56, 38, 61, 0.1) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 18px 18px;
}
.card {
  width: min(830px, 90vw);
  padding: 28px;
  border: var(--border-thick);
  border-radius: 24px;
  background: var(--c-paper);
  position: relative;
  z-index: 2;
  box-shadow: 10px 10px 0 var(--c-ink);
}
.title { text-align: center; }
.title .px-kicker { margin: 0 auto 14px; }
.title b { display: block; font-size: 32px; color: var(--c-coral); text-shadow: 3px 3px 0 #ffd3cb; }
.title p { font-size: 10px; color: var(--c-muted); }

.podium {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 13px;
  align-items: end;
  margin: 25px 0;
}
.rank {
  position: relative;
  padding: 17px;
  border: var(--border);
  border-radius: 18px;
  background: #fff;
  text-align: center;
  box-shadow: var(--shadow-md);
}
.rank.first { padding-top: 28px; background: #fff0b9; transform: translateY(-10px); }
.crown { position: absolute; top: -23px; left: 50%; transform: translateX(-50%); color: #e2a914; font-size: 28px; text-shadow: 2px 2px 0 var(--c-ink); }
.rank .face { font-size: 34px; }
.rank strong { display: block; font-size: 12px; margin: 7px; }
.rank span { font-size: 18px; font-weight: 700; color: var(--c-blue); }

.reward {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 13px;
  border: var(--border);
  border-radius: 14px;
  background: var(--c-mint-soft);
  font-size: 11px;
}
.reward b { color: #d79600; font-size: 18px; }

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px;
  margin-top: 18px;
}
.confetti { position: absolute; z-index: 1; width: 170px; filter: drop-shadow(7px 7px 0 rgba(56,38,61,.18)); animation: px-float 3.5s steps(4) infinite; }
.trophy { left: 3%; bottom: 7%; transform: rotate(-8deg); }
.console { right: 2%; top: 8%; transform: rotate(10deg); animation-delay: .7s; }
.star { position: absolute; z-index: 1; color: var(--c-yellow); font-size: 28px; text-shadow: 3px 3px 0 var(--c-ink); animation: px-twinkle 1.7s steps(2) infinite; }
.s1 { left: 12%; top: 14%; } .s2 { right: 16%; bottom: 12%; color: var(--c-coral); } .s3 { right: 9%; top: 48%; color: var(--c-blue); }
</style>
