<script setup lang="ts">
/**
 * 공통 상단 헤더 — 로비 헤더와 동일한 구성(브랜드 + nav + BGM·유저·코인·아바타).
 * 서브 페이지들이 로비와 같은 헤더를 갖도록 AppPage에 내장됩니다.
 * (Lobby/GameRoom 등 자체 헤더를 가진 코어 화면에서는 사용하지 않음)
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { readAccessClaims } from '@/api'
import { useSessionStore } from '@/stores/session'
import BrandLogo from './BrandLogo.vue'
import UserAvatar from './UserAvatar.vue'
import BgmToggle from './BgmToggle.vue'
import ChargePointsModal from './ChargePointsModal.vue'
import LoginRequiredModal from './LoginRequiredModal.vue'
import lobbyIcon from '@/assets/header/nav-lobby.png'
import gamesIcon from '@/assets/header/nav-games.png'
import rankingIcon from '@/assets/header/nav-ranking.png'
import shopIcon from '@/assets/header/nav-shop.png'
import headerCoin from '@/assets/header/header-coin.png'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()

// 로비 헤더와 동일한 nav 구성
const NAV = [
  { name: RouteName.Lobby, label: '로비', icon: lobbyIcon },
  { name: RouteName.GamesCatalog, label: '게임', icon: gamesIcon },
  { name: RouteName.Ranking, label: '랭킹', icon: rankingIcon },
  { name: RouteName.Shop, label: '상점', icon: shopIcon },
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
// 세션 프로필을 그대로 따라간다 — 스냅샷(ref)으로 들고 있으면 상점에서 구매해 잔액이 줄어도
// 헤더만 옛 값으로 남는다. 갱신은 프로필 한 곳에만 쓴다.
const balance = computed(() => session.profile?.pointBalance ?? 0)
const showCharge = ref(false)
function onCharged(amount: number) {
  if (session.profile) session.profile.pointBalance = balance.value + amount
}

// 로그아웃 — 게스트/회원 공통(세션 정리 후 시작 화면으로)
const logoutLabel = computed(() => (session.isGuest ? '나가기' : '로그아웃'))
async function onLogout() {
  await session.logout()
  router.push({ name: RouteName.Start })
}

/**
 * 관리자 여부 — 라우터 가드(router/index.ts)와 같은 근거인 토큰 role claim을 쓴다.
 * 프로필 role로 판단하면 claim이 없는 구 토큰일 때 메뉴는 보이는데 눌렀더니 튕긴다.
 * claims는 스토리지에서 읽어 반응형이 아니라, 로그인·세션 복원 시점에 다시 계산되도록
 * session.profile을 의존성으로 함께 읽는다.
 */
const isAdmin = computed(() => {
  void session.profile
  return session.isMember && readAccessClaims()?.role === 'ADMIN'
})

// 아바타 클릭 시 토글되는 계정 메뉴
const showAccountMenu = ref(false)
const accountMenuRef = ref<HTMLElement | null>(null)
// 게스트는 서버가 준 임시 닉네임, 회원은 프로필 닉네임.
// 임의의 기본값(P1)을 쓰지 않는다 — 세션이 복원되지 않았는데 로그인한 것처럼 보이던 원인이었다.
const nickname = computed(() =>
  session.isGuest ? (session.guestNickname ?? '게스트') : (session.profile?.nickname ?? '…'),
)
// 게스트에게는 프로필 자체가 없다(사진을 올릴 경로도 없다) — 기본 이모지로 둔다.
const avatarUrl = computed(() => (session.isGuest ? null : (session.profile?.avatarUrl ?? null)))

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
        <img class="nav-icon" :src="item.icon" alt="" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="account">
      <BgmToggle />
      <button class="coin" title="포인트 충전" @click="showCharge = true">
        <img class="coin-icon" :src="headerCoin" alt="" aria-hidden="true" /> {{ balance.toLocaleString() }} <b>＋</b>
      </button>
      <div class="avatar-wrap" ref="accountMenuRef">
        <button class="avatar-pill" title="계정 메뉴" @click="toggleAccountMenu">
          <span class="nickname">{{ nickname }}</span>
          <span class="avatar-pixel-frame">
          <UserAvatar class="avatar-circle" :src="avatarUrl" :alt="`${nickname} 프로필 사진`" />
          </span>
        </button>
        <div v-if="showAccountMenu" class="account-menu">
          <div class="menu-head">
            <span>{{ nickname }}</span>
            <span><img class="coin-icon menu-coin-icon" :src="headerCoin" alt="" aria-hidden="true" /> {{ balance.toLocaleString() }}</span>
          </div>
          <!-- 마이페이지·설정은 회원 전용 — 게스트에게는 헤더에서 숨긴다 -->
          <template v-if="!session.isGuest">
            <button v-if="isAdmin" class="menu-item" @click="onMenuNav(RouteName.Admin)">게임 관리</button>
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
.nav button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; padding: 11px 15px; border-radius: 12px; font-weight: 700; }
.nav-icon { width: 27px; height: 27px; object-fit: contain; image-rendering: pixelated; image-rendering: crisp-edges; }
.nav button.active {
  position: relative;
  isolation: isolate;
  padding: 12px 18px;
  border: 0;
  border-radius: 0;
  background: #bb804d;
  color: #2d211b !important;
  box-shadow: 3px 3px 0 #e5cca0;
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px);
}
.nav button.active::before {
  content: '';
  position: absolute;
  z-index: 0;
  inset: 3px;
  background: linear-gradient(135deg, #fff2be 0%, #ffe89a 55%, #f7d979 100%);
  clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px), 0 6px);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.75), inset -2px -2px 0 #e9c668;
  pointer-events: none;
}
.nav button.active .nav-icon,
.nav button.active span {
  position: relative;
  z-index: 1;
  color: #2d211b !important;
}

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
.nickname { font-size: 17px; font-weight: 700; }
.coin-icon { width: 18px; height: 18px; object-fit: contain; image-rendering: pixelated; }
.menu-coin-icon { width: 14px; height: 14px; }
.avatar-pixel-frame {
  order: -1;
  flex: none;
  width: 50px;
  height: 50px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  margin: -3.5px;
  padding: 3px;
  border: 2px solid #8e714e;
  border-radius: 50%;
  background: #fff0b9;
  box-shadow: none;
  transform: scale(.86);
}
.avatar-circle {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f8dca5;
  image-rendering: pixelated;
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

/* Account dropdown: lobby wooden notice board */
.account-menu { width: 184px; padding: 8px 12px; border: 3px solid #8d6048; border-radius: 12px; background: #fff8e9; box-shadow: 5px 5px 0 #c79b77; overflow: visible; }
.menu-head { margin: 0; padding: 9px 4px 12px; border: 0; border-bottom: 2px dashed #d7b58e; border-radius: 0; background: transparent; }.menu-head > span { color: #573a2b; font-size: 12px; }.menu-item { margin: 0; padding: 12px 10px; border: 0; border-radius: 0; background: transparent; color: #5a3e30; text-align: center; font-size: 14px; }.menu-item + .menu-item { border-top: 2px dashed #ead5b8; }.menu-item:hover { background: #fff0b6; }.menu-item:last-child { margin-top: 4px; padding-bottom: 8px; border-top: 2px dashed #ead5b8; background: transparent; color: #c45c52; }.menu-item:last-child:hover { background: transparent; color: #a8433b; }

@media (max-width: 720px) {
  .top { gap: 14px; }
  .brand { min-width: 0; }
  .user-pill, .coin { display: none; }
}

/* Header remains shared, with the lobby's cream-and-gold game navigation language. */
.top { min-height: 78px; background: rgba(255, 250, 240, .97); border-bottom-color: #bd6d45; }
.nav button { color: #443127; border: 2px solid transparent; border-radius: 9px; font-size: 15px; }
.coin { border-color: #d4b17a; border-radius: 9px; box-shadow: 2px 2px 0 #ead8b9; }
@media (min-width: 851px) and (max-width: 1120px) {
  .top { min-height: 68px; padding: 0 22px; gap: 14px; }
  .brand :deep(.name) { font-size: 17px; }
  .nav { gap: 2px; }
  .nav button { padding: 8px 7px; font-size: 13px; }
  .account { gap: 6px; }
  .coin { height: 35px; padding: 0 9px; font-size: 12px; }
  .coin-icon { width: 16px; height: 16px; }
  .nickname { font-size: 15px; }
  .avatar-pill { height: 38px; gap: 5px; }
  .avatar-pixel-frame { transform: scale(.76); }
}
@media (max-width: 850px) {
  .top { height: auto; min-height: 68px; padding: 10px 16px; gap: 12px; flex-wrap: wrap; }
  .brand { min-width: 125px; }
  .nav { order: 3; width: 100%; justify-content: space-between; }
  .nav button { flex: 1; padding: 8px 6px; font-size: 12px; }
  .account { gap: 6px; }
}
@media (max-width: 480px) {
  .top { padding: 8px 12px; }
  .brand :deep(.name) { font-size: 16px; }
  .brand :deep(.mark) { width: 38px; height: 38px; font-size: 19px; }
  .account .coin, .nickname { display: none; }
}
</style>
