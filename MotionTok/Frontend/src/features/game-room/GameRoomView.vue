<script setup lang="ts">
/** 게임룸 — 화상 파티룸(자기/친구 타일), 무대 데모, 채팅, 게임 선택, 컨트롤 바. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useCamera } from '@/composables/useCamera'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { LEFT_FRIENDS, MOVE_PATHS, RIGHT_FRIENDS, type GameEntry } from './data'
import FriendTile from './components/FriendTile.vue'
import GamePicker from './components/GamePicker.vue'

const route = useRoute()
const router = useRouter()
const camera = useCamera()
const bgm = useBgm()
const { message: toast, flash } = useToast(2600)

const roomCode = computed(() => (route.query.room as string) || 'MP-4X9K')
const roomGame = computed(() => (route.query.game as string) || 'DANCE BATTLE')
const isHost = computed(() => route.query.host === '1')

// ── 데모 상태 ────────────────────────────────
const micOn = ref(true)
const camOn = ref(false)
const speakerOn = ref(true)
const screenOn = ref(false)
const combo = ref(32)
const judgement = ref('GREAT!')
const selectedMove = ref(0)
const picker = ref(false)

const videoEl = ref<HTMLVideoElement>()
watch(camera.stream, (s) => {
  if (videoEl.value) videoEl.value.srcObject = s
})

let comboTimer: ReturnType<typeof setInterval>
let greetTimer: ReturnType<typeof setTimeout>
const JUDGES = ['GREAT!', 'PERFECT!', 'NICE!', 'COOL!']

onMounted(() => {
  comboTimer = setInterval(() => {
    combo.value += 1
    judgement.value = JUDGES[combo.value % JUDGES.length] ?? 'GREAT!'
  }, 1700)
  greetTimer = setTimeout(() => pushChat('곧 시작할게요! 준비됐죠? 🎮', false, 'Alex'), 1500)
})
onBeforeUnmount(() => {
  clearInterval(comboTimer)
  clearTimeout(greetTimer)
})

// ── 채팅 ────────────────────────────────────
interface ChatMsg { id: number; name: string; text: string; me: boolean }
const chat = ref<ChatMsg[]>([])
const draft = ref('')
let msgId = 0

function pushChat(text: string, me = true, name = 'You') {
  const id = ++msgId
  chat.value.push({ id, name, text, me })
  setTimeout(() => (chat.value = chat.value.filter((m) => m.id !== id)), 5200)
}
function send() {
  const t = draft.value.trim()
  if (!t) return
  pushChat(t, true, 'You')
  draft.value = ''
}

// ── 카메라 / 컨트롤 ─────────────────────────
async function toggleCam() {
  if (camOn.value) {
    camera.stop()
    camOn.value = false
    return
  }
  const s = await camera.start({ video: { width: 640, height: 400 }, audio: false })
  if (s) camOn.value = true
  else flash('카메라 권한을 허용해 주세요')
}

// ── 게임 선택 ────────────────────────────────
function openPicker() {
  if (isHost.value) picker.value = true
  else flash('게임 시작은 방장만 할 수 있어요')
}
function launch(g: GameEntry) {
  // 실제 게임 빌드가 아직 없음 → 준비 중 안내. (연동 시 여기서 게임 URL/캔버스 로드)
  flash(`${g.name} 는 준비 중이에요`)
}

function copyCode() {
  navigator.clipboard?.writeText(roomCode.value)
  flash('룸 코드를 복사했어요')
}
function showResult() {
  router.push({
    name: RouteName.GameResult,
    query: { game: roomGame.value, room: roomCode.value },
  })
}
function leave() {
  camera.stop()
  router.push({ name: RouteName.Lobby })
}
function goLobby() {
  camera.stop()
  router.push({ name: RouteName.Lobby })
}

const moves = computed(() => MOVE_PATHS.map((path, i) => ({ path, sel: selectedMove.value === i })))
const startLabel = computed(() => (isHost.value ? 'START' : 'WAIT'))
const startHint = computed(() =>
  isHost.value ? '게임을 선택하고 시작!' : '방장이 게임을 선택 중이에요',
)

// 게임룸 진입/이탈 시 BGM 볼륨 유지 (게임 실제 실행 시 suspendForGame 사용 예정)
onMounted(() => bgm.setVolume(0.2))
</script>

<template>
  <div class="room-shell">
    <!-- 상단 바 -->
    <header class="room-header">
      <div class="logo-group">
        <div class="px logo">M</div>
        <div>
          <div class="px title"><span class="c-y">MOVE</span><span class="c-g">PARTY</span></div>
          <div class="sub">함께 움직여요!</div>
        </div>
      </div>

      <nav class="nav">
        <button class="px active" @click="goLobby">LOBBY</button>
        <button class="px" @click="openPicker">GAMES</button>
        <button class="px">AVATARS</button>
        <button class="px">RANK</button>
      </nav>

      <div class="px coin"><span class="coin-dot" /><span class="c-y">1250</span><span class="c-g plus">+</span></div>
      <div class="me">
        <div class="me-avatar">😎</div>
        <div class="me-text"><div class="px">P1</div><div class="lv">LV.12</div></div>
      </div>
    </header>

    <!-- 본문 -->
    <main class="room-main">
      <!-- 좌측: 자기 화면 + 친구 -->
      <section class="people">
        <div class="self-tile">
          <video v-show="camOn" ref="videoEl" autoplay playsinline muted class="self-video" />
          <div v-if="!camOn" class="cam-off">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">
              <path d="M2 6h11v12H2zM16 10l6-4v12l-6-4" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <button class="px cam-on-btn" @click="toggleCam">CAM ON</button>
          </div>
          <div class="self-label">
            <span class="c-g">{{ isHost ? 'YOU · HOST' : 'YOU' }}</span>
            <span :style="{ color: micOn ? '#5cbf4a' : '#e85d6e' }">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
            </span>
          </div>
        </div>
        <FriendTile v-for="f in LEFT_FRIENDS" :key="f.name" :name="f.name" :crown="f.crown" />
      </section>

      <!-- 중앙: 무대 -->
      <section class="center">
        <div class="stage">
          <div class="stage-glow" />
          <div class="stage-toys">
            <i class="token tok-note">♫</i><i class="token tok-star">★</i>
            <i class="token tok-hand">✋</i><i class="token tok-drum">🥁</i>
          </div>

          <!-- 게임명 + 진행 + 타이머 -->
          <div class="stage-top">
            <div class="px game-chip">
              <span class="c-y">♪</span>
              <span>{{ roomGame }}</span>
              <span class="progress"><i class="on" /><i class="on" /><i class="on" /><i /><i /></span>
            </div>
            <div class="px timer">01:30</div>
          </div>

          <!-- 판정 -->
          <div class="px judgement">{{ judgement }}</div>

          <!-- 픽셀 댄서 -->
          <div class="dancer">
            <svg width="150" height="210" viewBox="0 0 60 84" shape-rendering="crispEdges">
              <rect x="24" y="6" width="12" height="12" fill="#ffd9a8" /><rect x="24" y="4" width="12" height="4" fill="#8a5cd6" />
              <rect x="24" y="12" width="3" height="3" fill="#2b2333" /><rect x="33" y="12" width="3" height="3" fill="#2b2333" />
              <rect x="22" y="20" width="16" height="20" fill="#5cbf4a" /><rect x="26" y="24" width="8" height="4" fill="#f5c518" />
              <rect x="12" y="14" width="6" height="6" fill="#ffd9a8" /><rect x="14" y="20" width="6" height="8" fill="#5cbf4a" /><rect x="18" y="26" width="4" height="8" fill="#5cbf4a" />
              <rect x="42" y="14" width="6" height="6" fill="#ffd9a8" /><rect x="40" y="20" width="6" height="8" fill="#5cbf4a" /><rect x="38" y="26" width="4" height="8" fill="#5cbf4a" />
              <rect x="22" y="40" width="6" height="16" fill="#4a7fd6" /><rect x="32" y="40" width="6" height="16" fill="#4a7fd6" />
              <rect x="20" y="56" width="10" height="5" fill="#fff" /><rect x="30" y="56" width="10" height="5" fill="#fff" />
            </svg>
          </div>

          <!-- 콤보 -->
          <div class="px combo">
            <span class="combo-cap">COMBO</span>
            <span class="combo-val">{{ combo }}</span>
          </div>

          <!-- 동작 선택 -->
          <div class="moves">
            <button
              v-for="(m, i) in moves"
              :key="i"
              class="move"
              :class="{ sel: m.sel }"
              @click="selectedMove = i"
            >
              <svg width="30" height="36" viewBox="0 0 40 48" fill="none" :stroke="m.sel ? '#f0a815' : '#8a8072'" stroke-width="4" stroke-linecap="square">
                <rect x="16" y="3" width="8" height="8" :fill="m.sel ? '#f0a815' : '#8a8072'" stroke="none" />
                <path :d="m.path" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 액션 행 -->
        <div class="action-row">
          <button class="px start-btn" :class="{ off: !isHost }" :disabled="!isHost" @click="openPicker">
            <span class="play-ico">▶</span>
            <span class="start-text"><span class="start-title">{{ startLabel }}</span><span class="start-hint">{{ startHint }}</span></span>
          </button>
          <div class="code-box">
            <span class="px code-cap">ROOM CODE</span>
            <div class="code-line">
              <span class="px code-val">{{ roomCode }}</span>
              <button class="copy" @click="copyCode">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="9" width="11" height="11" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
              </button>
            </div>
            <span class="code-note">현재 6/8명 · 링크 공유 가능</span>
          </div>
        </div>
      </section>

      <!-- 우측: 친구 -->
      <section class="people">
        <FriendTile v-for="f in RIGHT_FRIENDS" :key="f.name" :name="f.name" :muted="f.muted" />
      </section>
    </main>

    <!-- 하단 바 -->
    <footer class="room-footer">
      <div class="controls">
        <button class="ctrl" :class="{ off: !speakerOn }" title="스피커" @click="speakerOn = !speakerOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 9a3.5 3.5 0 010 6" /></svg>
        </button>
        <button class="ctrl" :class="{ off: !micOn }" title="마이크" @click="micOn = !micOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
        </button>
        <button class="ctrl" :class="{ on: camOn }" title="카메라" @click="toggleCam">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="6" width="14" height="12" /><path d="M16 10l6-4v12l-6-4" /></svg>
        </button>
        <button class="ctrl" :class="{ on: screenOn }" title="화면 공유" @click="screenOn = !screenOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="4" width="20" height="13" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        </button>
        <button class="ctrl" title="아바타"><span class="px">☻</span></button>
      </div>

      <!-- 채팅 독 -->
      <div class="chat-dock">
        <div class="chat-log">
          <div
            v-for="c in chat"
            :key="c.id"
            class="px bubble"
            :class="{ me: c.me }"
          >
            <span class="bubble-name" :class="{ me: c.me }">{{ c.name }}</span> {{ c.text }}
          </div>
        </div>
        <span class="chat-face">☺</span>
        <input v-model="draft" placeholder="메시지 입력..." @keydown.enter="send" />
        <button class="chat-send" @click="send">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
        </button>
      </div>

      <div class="footer-right">
        <button class="px result-demo" @click="showResult">RESULT DEMO</button>
        <button class="px leave" @click="leave">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 16l4-4-4-4M13 12H3" /></svg>
          LEAVE
        </button>
      </div>
    </footer>

    <!-- 게임 선택 모달 -->
    <GamePicker v-if="picker" @close="picker = false" @launch="launch" />

    <!-- 토스트 -->
    <Transition name="toast">
      <div v-if="toast" class="px room-toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.room-shell {
  width: 100vw;
  height: 100vh;
  min-width: 1120px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: auto;
  background-color: var(--c-paper);
  background-image: radial-gradient(circle at 1px 1px, rgba(56, 38, 61, 0.095) 1.2px, transparent 1.5px);
  background-size: 18px 18px;
  color: var(--c-ink-soft);
  font-family: var(--font-pixel);
}
.px { font-family: var(--font-pixel); }
.c-y { color: #f0a815; }
.c-g { color: #5cbf4a; }

/* 상단 바 */
.room-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 22px;
  background: #fffdf3;
  border-bottom: var(--border-thick);
}
.logo-group { display: flex; align-items: center; gap: 12px; }
.logo {
  width: 44px; height: 44px;
  background: var(--c-yellow);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: var(--c-ink-soft);
  border: 3px solid var(--c-ink-soft);
  border-radius: 13px;
  box-shadow: 4px 4px 0 var(--c-ink-soft);
}
.title { font-size: 15px; }
.sub { font-size: 11px; color: #a99f86; margin-top: 4px; }
.nav { display: flex; gap: 8px; margin: 0 auto; }
.nav button {
  padding: 11px 16px; font-size: 9px;
  border: 3px solid var(--c-ink-soft);
  background: #fff; color: var(--c-ink-soft);
  border-radius: 11px;
  box-shadow: 3px 3px 0 var(--c-ink-soft);
}
.nav button.active { background: var(--c-yellow); }
.coin {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 11px; background: #fff;
  border: 3px solid var(--c-ink-soft);
  box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.2);
}
.coin-dot { width: 12px; height: 12px; background: #f5c518; box-shadow: 0 -4px 0 #f5c518, 0 4px 0 #f5c518, -4px 0 0 #f5c518, 4px 0 0 #f5c518; }
.coin .plus { font-size: 13px; cursor: pointer; }
.me { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; background: #fff; border: 3px solid var(--c-ink-soft); box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.2); }
.me-avatar { width: 38px; height: 38px; display: grid; place-items: center; background: #f3ead2; border: 2px solid var(--c-ink-soft); font-size: 20px; }
.me-text { line-height: 1.5; }
.me-text .px { font-size: 9px; }
.lv { font-size: 10px; color: #a99f86; margin-top: 3px; }

/* 본문 그리드 */
.room-main {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: 250px minmax(520px, 1fr) 250px;
  gap: 18px;
  padding: 18px 24px;
}
.people { display: flex; flex-direction: column; gap: 12px; min-height: 0; }

/* 자기 타일 */
.self-tile {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  background: #fff; border: 3px solid #5cbf4a;
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.self-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #eee6cf; }
.cam-off { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; background: #f3ead2; color: #a99f86; }
.cam-on-btn { padding: 10px 16px; border: 3px solid var(--c-ink-soft); background: #5cbf4a; color: #fff; font-size: 9px; box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.25); }
.self-label { position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 7px; padding: 6px 9px; background: #fffdf3; border: 2px solid var(--c-ink-soft); font-size: 9px; }

/* 중앙 */
.center { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.stage {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  background: #fff6d9;
  border: var(--border-thick);
  border-radius: 20px 20px 15px 20px;
  box-shadow: var(--shadow-xl);
}
.stage-glow {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(48deg, rgba(255, 182, 193, 0.22) 0 70px, rgba(197, 180, 255, 0.22) 70px 140px, rgba(160, 225, 200, 0.22) 140px 210px, rgba(255, 222, 153, 0.22) 210px 280px);
  -webkit-mask-image: radial-gradient(75% 75% at 50% 80%, #000 0%, transparent 82%);
  mask-image: radial-gradient(75% 75% at 50% 80%, #000 0%, transparent 82%);
}
.stage::before { content: 'MOVE!'; position: absolute; left: 24px; bottom: 22px; font-size: 10px; color: var(--c-coral); transform: rotate(-8deg); z-index: 2; }
.stage::after { content: '★ PARTY ★'; position: absolute; right: 20px; bottom: 22px; font-size: 8px; color: var(--c-blue); transform: rotate(6deg); z-index: 2; }
.stage-toys { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.token { position: absolute; display: grid; place-items: center; border: 3px solid var(--c-ink-soft); box-shadow: 4px 4px 0 var(--c-ink-soft); background: #fff; animation: token-spin 2.5s steps(3) infinite; }
.tok-note { left: 6%; top: 12%; width: 48px; height: 48px; border-radius: 50%; background: #e0d3fb; color: var(--c-violet); font-size: 24px; }
.tok-star { right: 5%; top: 13%; width: 48px; height: 48px; border-radius: 15px; background: var(--c-yellow); font-size: 23px; animation-delay: 0.6s; }
.tok-hand { left: 5%; bottom: 15%; width: 51px; height: 46px; border-radius: 15px; background: #d5f4ea; font-size: 24px; animation-delay: 1s; }
.tok-drum { right: 4%; bottom: 14%; width: 55px; height: 49px; border-radius: 50%; background: #ffe0a8; font-size: 25px; animation-delay: 1.4s; }

.stage-top { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; z-index: 2; }
.game-chip { display: flex; align-items: center; gap: 9px; padding: 9px 13px; background: #fff; border: 3px solid var(--c-ink-soft); box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); font-size: 9px; }
.progress { display: flex; gap: 4px; margin-left: 2px; }
.progress i { width: 7px; height: 7px; background: #e0d6bd; }
.progress i.on { background: #f5c518; }
.timer { padding: 9px 13px; background: #fff; border: 3px solid var(--c-ink-soft); font-size: 11px; color: #f0a815; box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); }

.judgement { position: absolute; left: 11%; top: 33%; padding: 11px 15px; background: #fff; font-size: 11px; border: 3px solid var(--c-ink-soft); box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.25); z-index: 2; }
.dancer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; animation: px-bob 1.4s steps(2) infinite; }
.dancer svg { filter: drop-shadow(4px 4px 0 rgba(43, 35, 51, 0.25)); }
.combo { position: absolute; right: 9%; top: 36%; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 18px; background: #fff; border: 3px solid #f0a815; box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.25); z-index: 2; }
.combo-cap { font-size: 9px; color: #a99f86; }
.combo-val { font-size: 26px; color: #f0a815; }

.moves { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 9px; z-index: 2; }
.move { width: 66px; height: 66px; background: #fff; border: 3px solid var(--c-ink-soft); display: flex; align-items: center; justify-content: center; box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.2); }
.move.sel { background: #fff4cc; border-color: #f0a815; }

/* 액션 행 */
.action-row { flex: none; display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; height: 104px; }
.start-btn {
  border: var(--border-thick); background: #5cbf4a; color: #fff;
  display: flex; align-items: center; gap: 16px; padding: 0 22px;
  border-radius: 15px 15px 11px 15px;
  box-shadow: 7px 7px 0 var(--c-ink-soft); text-align: left;
}
.start-btn.off { background: #bcb3b6; }
.start-btn:disabled { cursor: not-allowed; }
.play-ico { font-size: 30px; }
.start-text { line-height: 1.6; }
.start-title { display: block; font-size: 15px; }
.start-hint { display: block; font-size: 9px; opacity: 0.85; margin-top: 6px; }
.code-box { border: var(--border-thick); background: #fff; padding: 12px 16px; display: flex; flex-direction: column; justify-content: center; gap: 6px; border-radius: 15px 15px 11px 15px; box-shadow: 6px 6px 0 var(--c-ink-soft); }
.code-cap { font-size: 8px; color: #a99f86; }
.code-line { display: flex; align-items: center; gap: 8px; }
.code-val { font-size: 15px; color: #f0a815; }
.copy { width: 28px; height: 28px; background: #f3ead2; border: 2px solid var(--c-ink-soft); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }
.code-note { font-size: 10px; color: #a99f86; }

/* 하단 바 */
.room-footer {
  flex: none; position: relative;
  display: flex; align-items: center; gap: 16px;
  padding: 14px 22px;
  background: #fffdf3;
  border-top: var(--border-thick);
}
.controls { position: absolute; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; }
.ctrl { width: 50px; height: 50px; border: 3px solid var(--c-ink-soft); background: #fff; color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.2); }
.ctrl.on { background: #d9f2cf; color: #5cbf4a; }
.ctrl.off { background: #fbdbe0; color: #e85d6e; }

.chat-dock { position: relative; flex: none; width: 300px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; height: 52px; background: #fff; border: 3px solid var(--c-ink-soft); box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.2); }
.chat-log { position: absolute; bottom: 62px; left: 0; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.bubble { max-width: 360px; padding: 9px 12px; font-size: 9px; line-height: 1.7; border: 2px solid var(--c-ink-soft); background: #fff; box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); animation: px-bubble 0.2s steps(3); }
.bubble.me { background: #fff4cc; }
.bubble-name { color: #5cbf4a; }
.bubble-name.me { color: #f0a815; }
.chat-face { color: #a99f86; font-size: 16px; }
.chat-dock input { flex: 1; background: transparent; border: none; outline: none; color: var(--c-ink-soft); font-size: 13px; }
.chat-send { width: 38px; height: 38px; border: 2px solid var(--c-ink-soft); background: #f5c518; color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

.footer-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.result-demo { padding: 9px 12px; border: 2px solid var(--c-ink-soft); border-radius: 10px; background: var(--c-yellow); font-size: 8px; }
.leave { display: flex; align-items: center; gap: 9px; padding: 0 18px; height: 52px; border: 3px solid var(--c-ink-soft); background: #e85d6e; color: #fff; font-size: 9px; box-shadow: 3px 3px 0 rgba(43, 35, 51, 0.25); }

.room-toast { position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 13px 20px; background: #fffdf3; border: 3px solid #f0a815; color: #f0a815; font-size: 9px; line-height: 1.7; box-shadow: 5px 5px 0 rgba(43, 35, 51, 0.25); }
.toast-enter-active { animation: px-pop 0.18s steps(3); }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }

@keyframes px-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes px-bubble { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes token-spin { 0%, 100% { transform: rotate(-5deg) scale(1); } 50% { transform: rotate(5deg) scale(0.92); } }

@media (max-width: 1280px) {
  .room-main { grid-template-columns: 220px minmax(480px, 1fr) 220px; }
}
@media (prefers-reduced-motion: reduce) {
  .dancer, .token { animation: none; }
}
</style>
