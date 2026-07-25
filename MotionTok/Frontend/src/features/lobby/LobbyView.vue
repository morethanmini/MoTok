<script setup lang="ts">
/** 메인 로비 — 방 목록(공개방·비밀방), 친구, 빠른 메뉴, 방 만들기/코드 참가, 스플래시, BGM. */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi, ApiError, type LiveRoomSummary } from '@/api'
import { useSessionStore } from '@/stores/session'
import { useAsyncData } from '@/composables/useAsyncData'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { MOCK_FRIENDS, MOCK_ROOMS, type Room } from './data'

import AppHeader from '@/components/common/AppHeader.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import RoomCard from './components/RoomCard.vue'
import FriendItem from './components/FriendItem.vue'
import LobbySplash from './components/LobbySplash.vue'
import JoinRoomModal from './components/JoinRoomModal.vue'
import CreateRoomModal, { type NewRoom } from './components/CreateRoomModal.vue'

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

// API LiveRoomSummary → 로비 카드용 Room 매핑
// 목록 응답엔 선택 게임 정보가 없음(selectedGameId 제거). currentPlayers → participantCount.
function toRoom(s: LiveRoomSummary): Room {
  return {
    roomId: s.roomId,
    title: s.title,
    game: '게임 선택 중',
    emoji: '🎮',
    count: s.participantCount,
    max: s.maxPlayers,
    state: s.status === 'WAITING' ? '대기 중' : '게임 중',
    visibility: s.visibility === 'PUBLIC' ? '공개' : '비공개',
    disabled: s.status === 'IN_GAME' || s.participantCount >= s.maxPlayers,
    hasPassword: s.hasPassword,
  }
}
// 방 목록 (GET /v1/live-rooms?page=, 페이지당 6개 · 최신순) — 실패 시 목업 폴백
// hasNext는 응답이 알려주지만, 이전 페이지 여부는 백엔드가 안 알려줘서 page > 1로 프론트에서 직접 판단한다.
const page = ref(1)
const hasNext = ref(false)
const { data: rooms, reload: reloadRooms } = useAsyncData(async () => {
  const res = await roomsApi.list(page.value)
  hasNext.value = res.hasNext
  return res.rooms.map(toRoom)
}, MOCK_ROOMS)

const hasPrev = computed(() => page.value > 1)
function nextPage() {
  if (!hasNext.value) return
  page.value += 1
  void reloadRooms()
}
function prevPage() {
  if (!hasPrev.value) return
  page.value -= 1
  void reloadRooms()
}
function refreshRooms() {
  page.value = 1
  void reloadRooms()
}

const filteredRooms = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rooms.value.filter((r) => !q || r.title.toLowerCase().includes(q))
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

// ⚡ 빠른 시작 (POST /v1/live-rooms/quick-start) — 서버가 조건에 맞는 방을 랜덤으로 골라 입장.
// 조건에 맞는 방이 없으면 404(QUICK_START_NO_ROOM) → 방 만들기로 유도.
const quickStart = () =>
  guardMember(async () => {
    try {
      const res = await roomsApi.quickStart()
      goDevice('게임 선택 중', res.roomId)
    } catch (e) {
      if (e instanceof ApiError && e.code !== 'QUICK_START_NO_ROOM') return flash(e.message)
      flash('지금은 입장 가능한 방이 없어요. 새 방을 만들어 보세요')
      showCreate.value = true
    }
  })
const openCreate = () => guardMember(() => (showCreate.value = true))
const openJoin = () => guardMember(() => (showJoin.value = true))

// 방 입장 (POST /v1/live-rooms/{roomId}/join)
// 비밀방(hasPassword)은 비밀번호 모달을 먼저 띄운다 — 목록에 비밀방도 노출되므로(2026-07-25 회의)
// 로비에서 바로 입장을 시도하면 서버가 ROOM_PASSWORD_REQUIRED로 거절한다.
// 초대코드 입장(joinRoom)은 비밀번호를 받지 않는다(확정안 ③).
function enterRoom(room: Room) {
  guardMember(async () => {
    if (room.disabled) return
    if (!room.roomId) return goDevice(room.game, 'MP4X9K') // 목업 폴백
    if (room.hasPassword) {
      pwTarget.value = room
      pwError.value = ''
      return
    }
    try {
      const res = await roomsApi.join(room.roomId)
      goDevice(room.game, res.roomId)
    } catch (e) {
      if (e instanceof ApiError) return flash(e.message)
      goDevice(room.game, room.roomId)
    }
  })
}

// 비밀방 비밀번호 입력 — 틀리면 모달을 닫지 않고 에러만 보여줘 재입력할 수 있게 한다.
const pwTarget = ref<Room | null>(null)
const pwError = ref('')
const pwBusy = ref(false)
async function submitRoomPassword(password: string) {
  const room = pwTarget.value
  if (!room?.roomId || pwBusy.value) return
  if (password.length < 6) {
    pwError.value = '비밀번호 6자리를 입력해 주세요'
    return
  }
  pwBusy.value = true
  try {
    const res = await roomsApi.join(room.roomId, password)
    pwTarget.value = null
    goDevice(room.game, res.roomId)
  } catch (e) {
    pwError.value = e instanceof ApiError ? e.message : '입장에 실패했어요'
  } finally {
    pwBusy.value = false
  }
}

// 코드 참가 (POST /v1/live-rooms/join-by-invite-code)
async function joinRoom(code: string) {
  if (code.length < 6) {
    flash('6자리 방 코드를 입력해 주세요')
    return
  }
  showJoin.value = false
  try {
    const res = await roomsApi.joinByInviteCode(code)
    goDevice('친구의 게임', res.roomId)
  } catch (e) {
    if (e instanceof ApiError) return flash(e.message)
    goDevice('친구의 게임', code) // 폴백
  }
}

// 방 만들기 (POST /v1/live-rooms)
async function createRoom(payload: NewRoom) {
  if (!payload.title.trim()) {
    flash('방 제목을 입력해 주세요')
    return
  }
  showCreate.value = false
  try {
    const res = await roomsApi.create({
      title: payload.title.trim(),
      visibility: payload.visibility === '비밀' ? 'PRIVATE' : 'PUBLIC',
      maxPlayers: Number(payload.max),
      // 모달이 넘겨준 비밀번호를 그대로 전달 — 공개방이면 undefined라 요청에서 빠진다
      // (서버는 PUBLIC + password 조합을 거부한다).
      password: payload.password,
    })
    goDevice('게임 선택 중', res.roomId)
  } catch (e) {
    if (e instanceof ApiError) return flash(e.message)
    goDevice('게임 선택 중', 'MP' + Math.random().toString(36).slice(2, 6).toUpperCase())
  }
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

    <!-- 상단 바 (공용 헤더) -->
    <AppHeader />

    <!-- 본문 -->
    <div class="layout">
      <main class="content">
        <section class="lobby-hero">
          <div>
            <h1>같이 놀 방을 찾아볼까요?</h1>
            <p>대기 중인 방에 입장하거나 직접 새 방을 만들 수 있어요. 🔒 방은 비밀번호가 필요해요.</p>
          </div>
          <div class="hero-actions">
            <PixelButton variant="primary" @click="quickStart">⚡ 빠른 참가</PixelButton>
            <PixelButton @click="openJoin">⌁ 코드 참가</PixelButton>
          </div>
        </section>

        <div v-if="session.isGuest" class="guest-note">
          👋 게스트는 1인 게임만 가능해요. 멀티플레이 방에 참여하려면 로그인해 주세요.
        </div>

        <div class="section-head">
          <h2>방 목록</h2>
          <p>{{ roomResult }}</p>
          <label class="room-search">
            ⌕ <input v-model="query" placeholder="방 제목 검색" />
          </label>
          <PixelButton class="create-room-btn" @click="openCreate">＋ 방 만들기</PixelButton>
          <button class="refresh-btn" @click="refreshRooms">새로고침 ↻</button>
        </div>

        <div class="room-list-wrap">
          <section class="room-list">
            <RoomCard
              v-for="(room, i) in filteredRooms"
              :key="i"
              :room="room"
              @enter="enterRoom(room)"
            />
            <div v-if="filteredRooms.length === 0" class="empty">
              검색 결과가 없어요. 다른 방 제목을 입력해보세요.
            </div>
          </section>
        </div>

        <div class="room-pager">
          <button class="pager-btn" :disabled="!hasPrev" @click="prevPage">← 이전</button>
          <span class="pager-page">{{ page }}</span>
          <button class="pager-btn" :disabled="!hasNext" @click="nextPage">다음 →</button>
        </div>
      </main>

      <aside class="side">
        <section class="side-card friends-card">
          <div class="side-title">
            친구 목록
            <button class="side-link" @click="router.push({ name: RouteName.Friends })">친구 목록 관리 →</button>
          </div>
          <div class="friends-list">
            <FriendItem
              v-for="(f, i) in friends"
              :key="i"
              :friend="f"
              @invite="flash(`${f.name}에게 초대를 보냈어요`)"
            />
          </div>
        </section>

        <section class="side-card notice">
          <div class="side-title">📣 오늘의 소식</div>
          <p><b>주말 더블 포인트!</b><br />게임을 플레이하고 별 코인을 2배로 받아보세요.</p>
        </section>
      </aside>
    </div>

    <!-- 모달 -->
    <JoinRoomModal v-if="showJoin" @close="showJoin = false" @join="joinRoom" />

    <!-- 비밀방 입장 비밀번호 (-68) — 같은 모달을 문구·입력 규칙만 바꿔 재사용 -->
    <JoinRoomModal
      v-if="pwTarget"
      heading="비밀방 입장"
      :desc="`'${pwTarget.title}' 방의 비밀번호 6자리를 입력해 주세요.`"
      placeholder="숫자 6자리"
      submit-label="입장"
      numeric
      :error-text="pwError"
      :busy="pwBusy"
      @close="pwTarget = null"
      @join="submitRoomPassword"
    />
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
.content {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 4px 10px 6px;
  margin-left: -6px;
}
/* 방 목록만 내부 스크롤 — 헤더/검색/이전·다음 버튼은 스크롤 없이 항상 보이게 고정 */
/* 그림자(box-shadow)가 컨테이너 경계에 잘리지 않도록 최소 여백 확보 */
.room-list-wrap { flex: 1; min-height: 0; overflow: auto; scrollbar-width: none; padding: 2px 6px 4px 6px; }
.room-list-wrap::-webkit-scrollbar { display: none; }

/* 로비 히어로 배너 */
.lobby-hero {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 18px;
  min-height: 150px;
  margin-bottom: 60px;
  padding: 16px 22px;
  border: var(--border);
  border-radius: 20px;
  background: linear-gradient(110deg, #cff4e7, #fff0b9);
  box-shadow: var(--shadow-lg);
}
.lobby-hero > div:first-child { align-self: flex-start; }
.lobby-hero h1 { margin: 0; font-size: 28px; }
.lobby-hero p { margin: 8px 0 0; color: var(--c-muted); font-size: 13px; }
.lobby-hero .hero-actions { align-self: flex-end; margin: 0 0 0 auto; display: flex; gap: 10px; }

.guest-note {
  flex: none;
  margin-bottom: 12px;
  padding: 10px 13px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff1d2;
  font-size: 10px;
}

.section-head { flex: none; display: flex; align-items: center; margin: 2px 0 2px; }
.section-head h2 { margin: 0; font-size: 22px; }
.section-head p { margin: 0 0 0 9px; font-size: 13px; color: var(--c-muted); }
.create-room-btn { height: 38px; padding: 0 16px; font-size: 14px; border-radius: 11px 11px 8px 11px; margin-left: 10px; }
.room-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 13px;
  background: #fff;
  border: 2px solid var(--c-ink);
  border-radius: 11px;
  box-shadow: 2px 2px 0 #d9cbd9;
  font-size: 15px;
}
.room-search input { width: 240px; border: 0; outline: 0; background: transparent; font-size: 14px; }
.refresh-btn { margin-left: 12px; border: 0; background: transparent; color: var(--c-blue); font-size: 14px; font-weight: 700; }

.room-list { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 7px; }
.empty {
  grid-column: 1 / -1;
  padding: 40px;
  border: 3px dashed #cbbdca;
  border-radius: 18px;
  text-align: center;
  color: var(--c-muted);
  font-size: 11px;
}

.room-pager { flex: none; display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 6px; }
.pager-btn { border: 2px solid var(--c-ink); border-radius: 10px; background: #fff; padding: 8px 14px; font-size: 11px; font-weight: 700; box-shadow: var(--shadow-sm); }
.pager-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
.pager-page { min-width: 20px; text-align: center; font-size: 12px; font-weight: 700; color: var(--c-muted); }

/* 사이드 */
.side { min-height: 0; display: flex; flex-direction: column; gap: 14px; }
.side-card { border: var(--border); border-radius: 19px 19px 14px 19px; background: #fff; box-shadow: var(--shadow-lg); padding: 17px; }
.friends-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.friends-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 12px;
  margin-right: -12px;
  scrollbar-width: thin;
  scrollbar-color: var(--c-mint) #f3ecf3;
}
.friends-list::-webkit-scrollbar { width: 10px; }
.friends-list::-webkit-scrollbar-button,
.friends-list::-webkit-scrollbar-button:start:decrement,
.friends-list::-webkit-scrollbar-button:end:increment,
.friends-list::-webkit-scrollbar-button:vertical:start,
.friends-list::-webkit-scrollbar-button:vertical:end {
  display: none;
  height: 0;
  width: 0;
  -webkit-appearance: none;
}
.friends-list::-webkit-scrollbar-track { background: #f3ecf3; border-left: 2px solid var(--c-ink); }
.friends-list::-webkit-scrollbar-thumb { background: var(--c-mint); border: 2px solid var(--c-ink); border-radius: 0; }
.friends-list::-webkit-scrollbar-thumb:hover { background: var(--c-yellow); }
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
