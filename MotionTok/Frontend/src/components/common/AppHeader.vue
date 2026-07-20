<script setup lang="ts">
/**
 * 공통 상단 헤더 — 로비 헤더와 동일한 구성(브랜드 + nav + BGM·유저·코인·아바타).
 * 서브 페이지들이 로비와 같은 헤더를 갖도록 AppPage에 내장됩니다.
 * (Lobby/GameRoom 등 자체 헤더를 가진 코어 화면에서는 사용하지 않음)
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import BrandLogo from './BrandLogo.vue'
import BgmToggle from './BgmToggle.vue'
import CoinIcon from './CoinIcon.vue'
import ChargePointsModal from './ChargePointsModal.vue'
import LoginRequiredModal from './LoginRequiredModal.vue'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()

// 로비 헤더와 동일한 nav 구성
const NAV = [
  { name: RouteName.Lobby, label: '로비' },
  { name: RouteName.GamesCatalog, label: '게임' },
  { name: RouteName.Ranking, label: '랭킹' },
  { name: RouteName.Shop, label: '상점' },
] as const

const current = computed(() => route.name)
const go = (name: string) => router.push({ name })

// 게스트에게 막을 회원 전용 라우트 (게임·랭킹은 열람 허용)
const MEMBER_ONLY = new Set<string>([RouteName.Lobby, RouteName.Shop, RouteName.MyPage])
const showLogin = ref(false)
const loginMsg = ref('로그인이 필요한 기능이에요.')

function guard(name: string): boolean {
  if (session.isGuest && MEMBER_ONLY.has(name)) {
    loginMsg.value =
      name === RouteName.Lobby ? '멀티 플레이는 로그인이 필요합니다.' : '로그인이 필요한 기능이에요.'
    showLogin.value = true
    return true
  }
  return false
}
function onNav(name: string) {
  if (!guard(name)) go(name)
}
// 브랜드(홈): 게스트는 게임 화면, 회원은 로비
const goHome = () => go(session.isGuest ? RouteName.GamesCatalog : RouteName.Lobby)
function toLogin() {
  showLogin.value = false
  router.push({ name: RouteName.Auth, query: { mode: 'login' } })
}

// 포인트 잔액 + 충전 모달
const balance = ref(session.profile?.coins ?? 1250)
const showCharge = ref(false)
function onCharged(amount: number) {
  balance.value += amount
  if (session.profile) session.profile.coins = balance.value
}
</script>

<template>
  <header class="top">
    <button class="brand-btn" title="홈" @click="goHome">
      <BrandLogo class="brand" subtitle="친구와 함께 즐기는 모션 파티" />
    </button>

    <nav class="nav">
      <button
        v-for="item in NAV"
        :key="item.name"
        :class="{ active: current === item.name }"
        @click="onNav(item.name)"
      >
        {{ item.label }}
      </button>
    </nav>

    <div class="account">
      <BgmToggle />
      <span class="user-pill">{{ session.userLabel }}</span>
      <button class="coin" title="포인트 충전" @click="showCharge = true">
        <CoinIcon :size="15" /> {{ balance.toLocaleString() }} <b>＋</b>
      </button>
      <button class="avatar" title="마이페이지" @click="onNav(RouteName.MyPage)">😎</button>
    </div>

    <ChargePointsModal
      v-if="showCharge"
      :current-points="balance"
      @close="showCharge = false"
      @charged="onCharged"
    />

    <LoginRequiredModal v-if="showLogin" :message="loginMsg" @close="showLogin = false" @login="toLogin" />
  </header>
</template>

<style scoped>
/* 로비 헤더(.top)와 동일한 스타일 */
.top {
  height: 78px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: 28px;
  background: rgba(255, 253, 247, 0.96);
  border-bottom: var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand-btn { display: flex; align-items: center; border: 0; background: transparent; padding: 0; }
.brand { min-width: 228px; }

.nav { display: flex; gap: 8px; }
.nav button { border: 0; background: transparent; padding: 11px 15px; border-radius: 12px; font-weight: 700; }
.nav button.active { background: var(--c-yellow); border: 2px solid var(--c-ink); box-shadow: var(--shadow-sm); }

.account { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.user-pill { padding: 6px 9px; border: 2px solid var(--c-ink); border-radius: 999px; background: #fff; font-size: 9px; font-weight: 700; }
.coin { height: 39px; padding: 0 12px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; display: flex; align-items: center; gap: 7px; font-weight: 700; }
.coin b { color: #36a17f; }
.avatar { width: 43px; height: 43px; border: var(--border); border-radius: var(--radius-md); background: var(--c-mint-soft); display: grid; place-items: center; box-shadow: var(--shadow-sm); font-size: 20px; }

@media (max-width: 720px) {
  .top { gap: 14px; }
  .brand { min-width: 0; }
  .user-pill, .coin { display: none; }
}
</style>
