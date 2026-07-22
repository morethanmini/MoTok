<script setup lang="ts">
/**
 * 공통 상단 헤더 — 로비 헤더와 동일한 구성(브랜드 + nav + BGM·유저·코인·아바타).
 * 서브 페이지들이 로비와 같은 헤더를 갖도록 AppPage에 내장됩니다.
 * (Lobby/GameRoom 등 자체 헤더를 가진 코어 화면에서는 사용하지 않음)
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
const MEMBER_ONLY = new Set<string>([
  RouteName.Lobby,
  RouteName.Shop,
  RouteName.MyPage,
  RouteName.AccountSettings,
])
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
const balance = ref(session.profile?.pointBalance ?? 1250)
const showCharge = ref(false)
function onCharged(amount: number) {
  balance.value += amount
  if (session.profile) session.profile.pointBalance = balance.value
}

// 로그아웃 — 게스트/회원 공통(세션 정리 후 시작 화면으로)
const logoutLabel = computed(() => (session.isGuest ? '나가기' : '로그아웃'))
async function onLogout() {
  await session.logout()
  router.push({ name: RouteName.Start })
}

// 아바타 클릭 시 토글되는 계정 메뉴
const showAccountMenu = ref(false)
const accountMenuRef = ref<HTMLElement | null>(null)
const nickname = computed(() => session.profile?.nickname ?? 'P1')

function toggleAccountMenu() {
  showAccountMenu.value = !showAccountMenu.value
}
function onMenuNav(name: string) {
  showAccountMenu.value = false
  onNav(name)
}
async function onMenuLogout() {
  showAccountMenu.value = false
  await onLogout()
}
function onDocClick(e: MouseEvent) {
  if (accountMenuRef.value && !accountMenuRef.value.contains(e.target as Node)) {
    showAccountMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="top">
    <button class="brand-btn" title="홈" @click="goHome">
      <BrandLogo class="brand" />
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
      <button class="coin" title="포인트 충전" @click="showCharge = true">
        <CoinIcon :size="15" /> {{ balance.toLocaleString() }} <b>＋</b>
      </button>
      <div class="avatar-wrap" ref="accountMenuRef">
        <button class="avatar-pill" title="계정 메뉴" @click="toggleAccountMenu">
          <span class="nickname">{{ nickname }}</span>
          <span class="avatar-circle">😎</span>
        </button>
        <div v-if="showAccountMenu" class="account-menu">
          <div class="menu-head">
            <span>{{ nickname }}</span>
            <span><CoinIcon :size="12" /> {{ balance.toLocaleString() }}</span>
          </div>
          <!-- 마이페이지·설정은 회원 전용 — 게스트에게는 헤더에서 숨긴다 -->
          <template v-if="!session.isGuest">
            <button class="menu-item" @click="onMenuNav(RouteName.MyPage)">마이페이지</button>
            <button class="menu-item" @click="onMenuNav(RouteName.AccountSettings)">설정</button>
          </template>
          <button class="menu-item" @click="onMenuLogout">{{ logoutLabel }}</button>
        </div>
      </div>
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
.coin { height: 39px; padding: 0 12px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; display: flex; align-items: center; gap: 7px; font-weight: 700; }
.coin b { color: #36a17f; }
.avatar-wrap { position: relative; }
.avatar-pill {
  height: 43px;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
}
.nickname { font-size: 14px; font-weight: 700; }
.avatar-circle {
  width: 43px;
  height: 43px;
  border: var(--border);
  border-radius: 50%;
  background: var(--c-mint-soft);
  display: grid;
  place-items: center;
  font-size: 20px;
}

.account-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 180px;
  border: var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 30;
}
.menu-head {
  display: flex;
  border-bottom: var(--border);
  padding: 12px 8px;
}
.menu-head > span {
  flex: 1;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.menu-item {
  display: block;
  width: 100%;
  border: 0;
  border-top: var(--border);
  background: #fff;
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
}
.menu-item:hover { background: var(--c-mint-soft); }

@media (max-width: 720px) {
  .top { gap: 14px; }
  .brand { min-width: 0; }
  .user-pill, .coin { display: none; }
}
</style>
