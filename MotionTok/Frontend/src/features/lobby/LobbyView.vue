<script setup lang="ts">
/** 메인 로비 — 공개방 목록, 친구, 빠른 메뉴, 방 만들기/코드 참가, 스플래시, BGM. */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { MOCK_FRIENDS, MOCK_ROOMS, type Room } from './data'

import BrandLogo from '@/components/common/BrandLogo.vue'
import BgmToggle from '@/components/common/BgmToggle.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import RoomCard from './components/RoomCard.vue'
import FriendItem from './components/FriendItem.vue'
import LobbySplash from './components/LobbySplash.vue'
import JoinRoomModal from './components/JoinRoomModal.vue'
import CreateRoomModal from './components/CreateRoomModal.vue'

const router = useRouter()
const session = useSessionStore()
const bgm = useBgm()
const { message: toast, flash } = useToast()

// 스플래시(로딩)는 세션 첫 진입에만 표시. 이후 로비 재방문 시엔 건너뜀.
const SPLASH_SEEN_KEY = 'motok.splashSeen'
const showSplash = ref(sessionStorage.getItem(SPLASH_SEEN_KEY) !== '1')
const query = ref('')
const showJoin = ref(false)
const showCreate = ref(false)

const friends = MOCK_FRIENDS

const filteredRooms = computed(() => {
  const q = query.value.trim().toLowerCase()
  return MOCK_ROOMS.filter((r) => !q || r.title.toLowerCase().includes(q))
})

onMounted(() => {
  bgm.setVolume(0.2)
})

function enterLobby() {
  showSplash.value = false
  sessionStorage.setItem(SPLASH_SEEN_KEY, '1')
  void bgm.play()
}

// ── 네비게이션 ──────────────────────────────
function goDevice(game: string, room: string) {
  router.push({ name: RouteName.DeviceSetup, query: { game, room } })
}
function requireLogin() {
  if (confirm('멀티플레이는 회원 전용이에요. 로그인 화면으로 이동할까요?')) {
    router.push({ name: RouteName.Auth, query: { mode: 'login' } })
  }
}
function guardMember(action: () => void) {
  if (session.isGuest) requireLogin()
  else action()
}

const quickStart = () => guardMember(() => goDevice('리듬 펀치', 'MP7R2D'))
const openCreate = () => guardMember(() => (showCreate.value = true))
const openJoin = () => guardMember(() => (showJoin.value = true))

function enterPublic(room: Room) {
  guardMember(() => {
    if (!room.disabled) goDevice(room.game, 'MP4X9K')
  })
}

function joinRoom(code: string) {
  if (code.length < 6) {
    flash('6자리 방 코드를 입력해 주세요')
    return
  }
  showJoin.value = false
  goDevice('친구의 게임', code)
}

function createRoom(payload: { title: string }) {
  if (!payload.title.trim()) {
    flash('방 제목을 입력해 주세요')
    return
  }
  showCreate.value = false
  goDevice('게임 선택 중', 'MP' + Math.random().toString(36).slice(2, 6).toUpperCase())
}

const roomResult = computed(() => `${filteredRooms.value.length}개의 방`)
</script>

<template>
  <div class="shell px-paper-bg">
    <!-- 떠다니는 장식 스티커 -->
    <div class="pixel-decor">
      <i class="d-sticker d-moon">☾</i>
      <i class="d-sticker d-headphone">🎧</i>
      <i class="d-sticker d-palette">🎨</i>
      <i class="d-sticker d-fish">🐟</i>
      <i class="spark s1">✦</i>
      <i class="spark s2">★</i>
      <i class="spark s3">✦</i>
    </div>

    <!-- 상단 바 -->
    <header class="top">
      <BrandLogo class="brand" subtitle="친구와 함께 즐기는 모션 파티" />
      <nav class="nav">
        <button class="active">로비</button>
        <button @click="router.push({ name: RouteName.GamesCatalog })">게임</button>
        <button @click="router.push({ name: RouteName.Ranking })">랭킹</button>
        <button @click="router.push({ name: RouteName.Shop })">상점</button>
      </nav>
      <div class="account">
        <BgmToggle />
        <span class="user-pill">{{ session.userLabel }}</span>
        <div class="coin"><CoinIcon :size="15" /> 1,250 <b>＋</b></div>
        <button class="avatar" title="마이페이지" @click="router.push({ name: RouteName.MyPage })">😎</button>
      </div>
    </header>

    <!-- 본문 -->
    <div class="layout">
      <main class="content">
        <section class="lobby-hero">
          <div>
            <span class="eyebrow"><i class="live" /> PUBLIC LOBBY</span>
            <h1>같이 놀 방을 찾아볼까요?</h1>
            <p>대기 중인 공개방에 입장하거나 직접 새 방을 만들 수 있어요.</p>
          </div>
          <div class="hero-actions">
            <PixelButton variant="primary" @click="quickStart">⚡ 빠른 시작</PixelButton>
            <PixelButton @click="openCreate">＋ 방 만들기</PixelButton>
          </div>
        </section>

        <div v-if="session.isGuest" class="guest-note">
          👋 게스트는 1인 게임만 가능해요. 멀티플레이 방에 참여하려면 로그인해 주세요.
        </div>

        <div class="section-head">
          <h2>공개방</h2>
          <p>{{ roomResult }}</p>
          <label class="room-search">
            ⌕ <input v-model="query" placeholder="방 제목 검색" />
          </label>
          <button>새로고침 ↻</button>
        </div>

        <section class="room-list">
          <RoomCard
            v-for="(room, i) in filteredRooms"
            :key="i"
            :room="room"
            @enter="enterPublic(room)"
          />
          <div v-if="filteredRooms.length === 0" class="empty">
            검색 결과가 없어요. 다른 방 제목을 입력해보세요.
          </div>
        </section>
      </main>

      <aside class="side">
        <section class="side-card">
          <div class="side-title">빠른 메뉴 <span>ONLINE</span></div>
          <div class="quick">
            <button @click="quickStart">⚡<br />빠른 시작</button>
            <button @click="openJoin">⌁<br />코드 참가</button>
          </div>
        </section>

        <section class="side-card friends-card">
          <div class="side-title">
            접속 중인 친구
            <button class="side-link" @click="router.push({ name: RouteName.Friends })">전체 →</button>
          </div>
          <FriendItem
            v-for="(f, i) in friends"
            :key="i"
            :friend="f"
            @invite="flash(`${f.name}에게 초대를 보냈어요`)"
          />
        </section>

        <section class="side-card notice">
          <div class="side-title">📣 오늘의 소식</div>
          <p><b>주말 더블 포인트!</b><br />게임을 플레이하고 별 코인을 2배로 받아보세요.</p>
        </section>
      </aside>
    </div>

    <!-- 모달 -->
    <JoinRoomModal v-if="showJoin" @close="showJoin = false" @join="joinRoom" />
    <CreateRoomModal v-if="showCreate" @close="showCreate = false" @create="createRoom" />

    <PixelToast :message="toast" />

    <!-- 스플래시 -->
    <LobbySplash v-if="showSplash" @enter="enterLobby" />
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  min-width: 1100px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
/* 상단 무지개 스트라이프 */
.shell::before {
  content: '';
  position: absolute;
  inset: 78px 0 auto;
  height: 13px;
  z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(90deg, var(--c-yellow) 0 36px, var(--c-coral) 36px 72px, var(--c-mint) 72px 108px, var(--c-blue) 108px 144px);
  opacity: 0.24;
}

/* 떠다니는 스티커 */
.pixel-decor { position: absolute; inset: 78px 0 0; z-index: 1; pointer-events: none; overflow: hidden; }
.d-sticker {
  position: absolute;
  display: grid;
  place-items: center;
  border: var(--border);
  background: #fff;
  box-shadow: var(--shadow-md);
  animation: px-float 3.4s steps(3) infinite;
}
.d-moon { width: 48px; height: 48px; left: 9px; top: 23%; border-radius: 50%; background: #ffd34f; color: #9a6810; font-size: 24px; transform: rotate(-10deg); }
.d-headphone { width: 62px; height: 54px; right: 8px; top: 7%; border-radius: 20px; background: #d9ccfa; color: #6b45bd; font-size: 28px; animation-delay: 0.5s; }
.d-palette { width: 58px; height: 52px; left: 8px; bottom: 5%; border-radius: 50% 50% 46% 54%; background: #efbf79; font-size: 27px; animation-delay: 1s; }
.d-fish { width: 58px; height: 48px; right: 8px; bottom: 8%; border-radius: 50%; background: #cdeaff; font-size: 28px; animation-delay: 1.4s; }
.spark { position: absolute; color: var(--c-yellow); font-size: 20px; text-shadow: 2px 2px 0 var(--c-ink); animation: px-twinkle 1.8s steps(2) infinite; }
.s1 { left: 17px; top: 10%; }
.s2 { right: 24px; top: 36%; color: var(--c-coral); animation-delay: 0.4s; }
.s3 { left: 18px; bottom: 29%; color: var(--c-blue); animation-delay: 0.8s; }

/* 상단 바 */
.top {
  height: 78px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 28px;
  gap: 28px;
  background: rgba(255, 253, 247, 0.96);
  border-bottom: var(--border);
  z-index: 4;
}
.brand { min-width: 228px; }
.nav { display: flex; gap: 8px; }
.nav button { border: 0; background: transparent; padding: 11px 15px; border-radius: 12px; font-weight: 700; }
.nav button.active { background: var(--c-yellow); border: 2px solid var(--c-ink); box-shadow: var(--shadow-sm); }
.account { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.user-pill { padding: 6px 9px; border: 2px solid var(--c-ink); border-radius: 999px; background: #fff; font-size: 9px; font-weight: 700; }
.coin { height: 39px; padding: 0 12px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; display: flex; align-items: center; gap: 7px; font-weight: 700; }
.coin b { color: #36a17f; }
.avatar { width: 43px; height: 43px; border: var(--border); border-radius: var(--radius-md); background: var(--c-mint-soft); display: grid; place-items: center; box-shadow: var(--shadow-sm); font-size: 20px; }

/* 레이아웃 */
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 286px;
  gap: 20px;
  padding: 20px 28px 22px;
  z-index: 2;
}
.content { min-width: 0; overflow: auto; padding: 0 4px 10px 0; scrollbar-width: none; }
.content::-webkit-scrollbar { display: none; }

/* 로비 히어로 배너 */
.lobby-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 18px;
  padding: 18px 22px;
  border: var(--border);
  border-radius: 20px;
  background: linear-gradient(110deg, #cff4e7, #fff0b9);
  box-shadow: var(--shadow-lg);
}
.lobby-hero h1 { margin: 0; font-size: 21px; }
.lobby-hero p { margin: 5px 0 0; color: var(--c-muted); font-size: 10px; }
.lobby-hero .hero-actions { margin: 0 0 0 auto; display: flex; gap: 10px; }
.eyebrow {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  background: #fff;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  padding: 6px 11px;
  font-size: 10px;
  font-weight: 700;
}
.live { width: 7px; height: 7px; border-radius: 50%; background: var(--c-coral); animation: px-blink 1s steps(2) infinite; }

.guest-note {
  margin-bottom: 12px;
  padding: 10px 13px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff1d2;
  font-size: 10px;
}

.section-head { display: flex; align-items: center; margin: 27px 0 12px; }
.section-head h2 { margin: 0; font-size: 17px; }
.section-head p { margin: 0 0 0 9px; font-size: 10px; color: var(--c-muted); }
.room-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 11px;
  background: #fff;
  border: 2px solid var(--c-ink);
  border-radius: 11px;
  box-shadow: 2px 2px 0 #d9cbd9;
  font-size: 12px;
}
.room-search input { width: 150px; border: 0; outline: 0; background: transparent; font-size: 11px; }
.section-head > button { margin-left: 12px; border: 0; background: transparent; color: var(--c-blue); font-size: 11px; font-weight: 700; }

.room-list { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 14px; }
.empty {
  grid-column: 1 / -1;
  padding: 40px;
  border: 3px dashed #cbbdca;
  border-radius: 18px;
  text-align: center;
  color: var(--c-muted);
  font-size: 11px;
}

/* 사이드 */
.side { min-height: 0; display: flex; flex-direction: column; gap: 14px; }
.side-card { border: var(--border); border-radius: 19px 19px 14px 19px; background: #fff; box-shadow: var(--shadow-lg); padding: 17px; }
.friends-card { flex: 1; min-height: 0; overflow: auto; }
.side-title { display: flex; align-items: center; font-size: 13px; font-weight: 700; margin-bottom: 13px; }
.side-title span { margin-left: auto; font-size: 9px; color: var(--c-mint); }
.side-link { margin-left: auto; border: 0; background: transparent; color: var(--c-blue); font-size: 9px; font-weight: 700; }
.quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick button { height: 62px; border: 2px solid var(--c-ink); border-radius: var(--radius-md); background: var(--c-yellow); font-size: 11px; font-weight: 700; box-shadow: var(--shadow-sm); }
.quick button:last-child { background: var(--c-mint-soft); }
.notice { background: #fff7d9; }
.notice p { font-size: 10px; line-height: 1.65; color: #66586a; margin: 0; }
.notice b { color: var(--c-coral); }

@media (max-width: 1260px) {
  .layout { grid-template-columns: minmax(0, 1fr) 260px; }
}
</style>
