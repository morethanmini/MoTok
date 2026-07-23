<script setup lang="ts">
/** 게임룸 — 화상 파티룸(LiveKit SFU). 방 정원만큼 슬롯을 만들고, 참가자는 실시간 타일로,
 *  빈 자리는 "대기 중"으로 표시한다. 무대/채팅/게임 선택은 데모. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ConnectionState } from 'livekit-client'
import { RouteName } from '@/router/routeNames'
import { roomsApi } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { useLiveKitRoom, type ParticipantView } from '@/composables/useLiveKitRoom'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import type { GameEntry } from './data'
import ParticipantTile from './components/ParticipantTile.vue'
import GamePicker from './components/GamePicker.vue'
import AppHeader from '@/components/common/AppHeader.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const route = useRoute()
const router = useRouter()
const bgm = useBgm()
const { message: toast, flash } = useToast(2600)

// LiveKit 실시간 방 + 로컬 카메라 프리뷰 폴백(백엔드 미연동 시)
const lk = useLiveKitRoom()
const camera = useCamera()

const roomCode = computed(() => (route.query.room as string) || 'MP-4X9K')
const roomGame = computed(() => (route.query.game as string) || 'DANCE BATTLE')
const isHost = computed(() => route.query.host === '1')

// ── 방 정원/방장 (상세 조회) ─────────────────
const capacity = ref(8)
const hostId = ref<string | null>(null)

// ── 실시간 참가자 → 슬롯 매핑 ────────────────
const connected = computed(() => lk.state.value === ConnectionState.Connected)
const lkLocal = computed(() => lk.participants.value.find((p) => p.isLocal) ?? null)
const remotes = computed(() => lk.participants.value.filter((p) => !p.isLocal))
const onlineCount = computed(() => Math.max(1, lk.participants.value.length))

interface Slot { view: ParticipantView | null; host: boolean }
// self를 뺀 나머지 정원만큼 슬롯을 미리 만든다. 참가자가 있으면 채우고, 없으면 빈 자리.
const otherSlots = computed<Slot[]>(() => {
  const slots: Slot[] = []
  for (let i = 0; i < Math.max(0, capacity.value - 1); i++) {
    const view = remotes.value[i] ?? null
    slots.push({ view, host: !!view && view.identity === hostId.value })
  }
  return slots
})
// 내 캠은 왼쪽에 크게 고정, 나머지는 오른쪽 좁은 트레이에 인원수(2~8명)에 맞춰 세로로 쌓는다.
// 1~2명: 1열(위아래로 쌓임). 3명 이상: 2열.
const othersColumns = computed(() => (otherSlots.value.length <= 2 ? 1 : 2))

// ── 자기 타일 상태 (연결 시 LiveKit, 미연결 시 로컬 프리뷰) ──
const demoMic = ref(true)
const selfCamOn = computed(() => (connected.value ? !!lkLocal.value?.cameraOn : camera.isOn.value))
const selfMicOn = computed(() => (connected.value ? !!lkLocal.value?.micOn : demoMic.value))
const selfIsHost = computed(
  () => isHost.value || (!!lkLocal.value && lkLocal.value.identity === hostId.value),
)

const selfVideoEl = ref<HTMLVideoElement>()
// LiveKit 로컬 트랙(안정적 참조)만 의존. 트랙/스트림/엘리먼트가 실제 바뀔 때만 재부착(발화 이벤트로 인한 깜빡임 방지).
const selfTrack = computed(() => (lkLocal.value?.cameraOn ? (lkLocal.value.videoTrack ?? null) : null))
watch(
  [selfTrack, () => camera.stream.value, selfVideoEl],
  ([track, stream, el], _prev, onCleanup) => {
    if (!el) return
    if (track) {
      track.attach(el)
      onCleanup(() => track.detach(el))
      return
    }
    // 폴백: LiveKit 미연결 시 로컬 getUserMedia 프리뷰
    if (stream) {
      el.srcObject = stream
      onCleanup(() => {
        el.srcObject = null
      })
    }
  },
  { immediate: true },
)

// ── 데모 상태 ────────────────────────────────
const speakerOn = ref(true)
const screenOn = ref(false)
const picker = ref(false)

let greetTimer: ReturnType<typeof setTimeout>

onMounted(async () => {
  bgm.setVolume(0.2)
  greetTimer = setTimeout(() => pushChat('곧 시작할게요! 준비됐죠? 🎮', false, 'Alex'), 1500)

  // 정원/방장 조회(실패해도 진행) → LiveKit 접속(방 멤버만 토큰 발급됨)
  try {
    const d = await roomsApi.detail(roomCode.value)
    capacity.value = d.maxPlayers
    hostId.value = d.hostUserId
  } catch {
    /* 백엔드 미연동 — 기본 정원 유지 */
  }
  const ok = await lk.connect(roomCode.value)
  if (!ok) flash('실시간 서버에 연결하지 못했어요 · 카메라 미리보기만 가능해요')
})
onBeforeUnmount(() => {
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

// ── 카메라 / 마이크 컨트롤 ───────────────────
// 연결 시 LiveKit 발행 토글, 미연결 시 로컬 프리뷰 토글.
async function toggleCam() {
  if (connected.value) {
    await lk.toggleCamera()
    return
  }
  if (camera.isOn.value) camera.stop()
  else {
    const s = await camera.start({ video: { width: 640, height: 400 }, audio: false })
    if (!s) flash('카메라 권한을 허용해 주세요')
  }
}
async function toggleMic() {
  if (connected.value) {
    await lk.toggleMicrophone()
    return
  }
  demoMic.value = !demoMic.value
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
// 헤더 링크·뒤로가기 등으로 방을 벗어나려 하면 확인 모달. "나가기" 같은 의도된 이동은 통과.
let leavingIntentionally = false
const showLeaveConfirm = ref(false)
let resolveLeave: ((ok: boolean) => void) | null = null
onBeforeRouteLeave(() => {
  if (leavingIntentionally) return true
  showLeaveConfirm.value = true
  return new Promise<boolean>((resolve) => (resolveLeave = resolve))
})
function answerLeave(ok: boolean) {
  showLeaveConfirm.value = false
  resolveLeave?.(ok)
  resolveLeave = null
}

async function leave() {
  leavingIntentionally = true
  const id = route.query.room as string | undefined
  if (id) {
    try {
      await roomsApi.leave(id)
    } catch {
      // 방이 이미 없어졌거나 네트워크 오류여도 클라이언트 퇴장은 계속 진행
    }
  }
  await lk.disconnect()
  camera.stop()
  router.push({ name: RouteName.Lobby })
}

const startLabel = computed(() => (isHost.value ? 'START' : 'WAIT'))
const startHint = computed(() =>
  isHost.value ? '게임을 선택하고 시작!' : '방장이 게임을 선택 중이에요',
)
</script>

<template>
  <div class="room-shell">
    <!-- 상단 바 -->
    <AppHeader />

    <div class="room-ribbon">
      <span class="px-kicker"><i /> LIVE PARTY ROOM</span>
      <b>{{ roomGame }}</b>
      <span>친구들과 함께 준비 중이에요</span>
      <div class="ribbon-code">ROOM {{ roomCode }} · {{ onlineCount }}/{{ capacity }} ONLINE</div>
    </div>

    <!-- 본문: 내 캠을 크게, 나머지는 인원수에 맞춰 그리드로 배치 -->
    <main class="room-main">
      <div class="cam-stage">
        <!-- 내 캠 — 항상 가장 크게 -->
        <div class="self-tile self-spot">
          <video v-show="selfCamOn" ref="selfVideoEl" autoplay playsinline muted class="self-video" />
          <div v-if="!selfCamOn" class="cam-off">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">
              <path d="M2 6h11v12H2zM16 10l6-4v12l-6-4" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <button class="px cam-on-btn" @click="toggleCam">CAM ON</button>
          </div>
          <div class="self-label">
            <span class="c-g">{{ selfIsHost ? 'YOU · HOST' : 'YOU' }}</span>
            <span :style="{ color: selfMicOn ? '#5cbf4a' : '#e85d6e' }">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
            </span>
          </div>
        </div>

        <!-- 나머지 참가자 — 인원수(2~8명)에 맞춰 열 수가 달라지는 그리드 -->
        <div class="others-tray" :style="{ '--cols': othersColumns }">
          <ParticipantTile
            v-for="(slot, i) in otherSlots"
            :key="i"
            :view="slot.view"
            :host="slot.host"
            play-audio
          />
        </div>
      </div>

    </main>

    <!-- 하단 바 -->
    <footer class="room-footer">
      <div class="controls">
        <button class="ctrl" :class="{ off: !speakerOn }" title="스피커" @click="speakerOn = !speakerOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 9a3.5 3.5 0 010 6" /></svg>
        </button>
        <button class="ctrl" :class="{ off: !selfMicOn }" title="마이크" @click="toggleMic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
        </button>
        <button class="ctrl" :class="{ on: selfCamOn }" title="카메라" @click="toggleCam">
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

      <!-- 게임 시작 (메시지창 오른쪽) -->
      <button class="px start-btn" :class="{ off: !isHost }" :disabled="!isHost" @click="openPicker">
        <span class="play-ico">▶</span>
        <span class="start-text"><span class="start-title">{{ startLabel }}</span><span class="start-hint">{{ startHint }}</span></span>
      </button>

      <div class="footer-right">
        <!-- 방 코드 (나가기 버튼 왼쪽) -->
        <div class="code-box">
          <span class="px code-cap">ROOM CODE</span>
          <div class="code-line">
            <span class="px code-val">{{ roomCode }}</span>
            <button class="copy" @click="copyCode">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="9" width="11" height="11" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
            </button>
          </div>
        </div>
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

    <PixelModal v-if="showLeaveConfirm" @close="answerLeave(false)">
      <h3 class="leave-title">🚪 게임을 떠나시겠어요?</h3>
      <p class="leave-desc">지금 나가면 진행 중인 방에서 나가게 돼요.</p>
      <div class="leave-actions">
        <PixelButton block @click="answerLeave(false)">취소</PixelButton>
        <PixelButton variant="primary" block @click="answerLeave(true)">나가기</PixelButton>
      </div>
    </PixelModal>
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
  background-color: #fff8e9;
  background-image:
    linear-gradient(25deg, transparent 0 47%, rgba(120, 206, 177, 0.1) 47% 53%, transparent 53%),
    linear-gradient(155deg, transparent 0 47%, rgba(239, 104, 114, 0.08) 47% 53%, transparent 53%),
    radial-gradient(rgba(56, 38, 61, 0.09) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 18px 18px;
  color: var(--c-ink-soft);
  font-family: var(--font-pixel);
}
.px { font-family: var(--font-pixel); }
.c-y { color: #f0a815; }
.c-g { color: #5cbf4a; }

/* 이탈 확인 모달 */
.leave-title { margin: 0 0 8px; font-size: 15px; }
.leave-desc { margin: 0 0 18px; font-size: 11px; color: var(--c-muted); line-height: 1.6; }
.leave-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.room-ribbon { flex: none; height: 54px; padding: 0 28px; display: flex; align-items: center; gap: 14px; border-bottom: 2px solid rgba(56, 38, 61, .18); background: linear-gradient(110deg, rgba(207, 244, 231, .95), rgba(255, 240, 185, .95)); z-index: 5; }
.room-ribbon .px-kicker { padding: 5px 9px; font-size: 8px; }
.room-ribbon .px-kicker i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-coral); animation: px-blink 1s steps(2) infinite; }
.room-ribbon b { font-size: 12px; }
.room-ribbon > span:not(.px-kicker) { color: var(--c-muted); font-size: 9px; }
.ribbon-code { margin-left: auto; padding: 7px 10px; border: 2px solid var(--c-ink); border-radius: 9px; background: #fff; font-size: 8px; font-weight: 700; }

/* 본문 */
.room-main {
  flex: 1; min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 24px;
}

/* 캠 영역 — 내 캠(왼쪽, 크게) + 나머지 참가자(오른쪽, 인원수에 맞춰 그리드). 화면 안에 스크롤 없이 모두 들어가고,
   카메라 비율은 유지하되 박스를 꽉 채우지는 않는다(letterbox는 object-fit: contain으로 처리). */
.cam-stage { flex: 1; min-height: 0; display: flex; flex-direction: row; gap: 14px; }

/* 자기 타일 — 항상 가장 크게 */
.self-tile.self-spot {
  flex: 0 0 62%;
  min-width: 0;
}
.self-tile {
  position: relative; min-height: 0; overflow: hidden;
  background: #fff; border: 3px solid var(--c-mint); border-radius: 14px 14px 10px 14px;
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.self-video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); background: #eee6cf; }
.cam-off { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; background: #f3ead2; color: #a99f86; }
.cam-off { background: linear-gradient(135deg, var(--c-mint-soft), #fff0c4); }
.cam-on-btn { padding: 10px 16px; border: 3px solid var(--c-ink-soft); border-radius: 11px; background: var(--c-mint); color: #fff; font-size: 9px; box-shadow: var(--shadow-sm); }
.self-label { position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 7px; padding: 6px 9px; background: #fffdf3; border: 2px solid var(--c-ink-soft); font-size: 9px; }

/* 나머지 참가자 그리드 — 열 수(--cols)는 인원수(2~8명)에 따라 스크립트에서 계산, 세로로 쌓인다 */
.others-tray {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(var(--cols, 1), 1fr);
  grid-auto-rows: 1fr;
  gap: 12px;
}

/* 게임 시작 (하단 바, 메시지창 오른쪽) */
.start-btn {
  flex: none;
  border: var(--border-thick); background: #5cbf4a; color: #fff;
  display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 16px;
  border-radius: 14px 14px 10px 14px;
  box-shadow: var(--shadow-sm); text-align: left;
}
.start-btn.off { background: #bcb3b6; }
.start-btn:disabled { cursor: not-allowed; }
.play-ico { font-size: 18px; }
.start-text { line-height: 1.4; }
.start-title { display: block; font-size: 11px; }
.start-hint { display: block; font-size: 7px; opacity: 0.85; }

/* 방 코드 (하단 바, 나가기 버튼 왼쪽) */
.code-box { border: var(--border-thick); background: #fff; padding: 0 14px; height: 52px; display: flex; align-items: center; gap: 8px; border-radius: 14px 14px 10px 14px; box-shadow: var(--shadow-sm); }
.code-cap { font-size: 7px; color: #a99f86; }
.code-line { display: flex; align-items: center; gap: 8px; }
.code-val { font-size: 12px; color: #f0a815; }
.copy { width: 24px; height: 24px; background: #f3ead2; border: 2px solid var(--c-ink-soft); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

/* 하단 바 */
.room-footer {
  flex: none; position: relative;
  display: flex; align-items: center; gap: 16px;
  padding: 14px 22px;
  background: rgba(255, 253, 247, .97);
  border-top: var(--border);
}
.controls { position: absolute; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; }
.ctrl { width: 50px; height: 50px; border: 3px solid var(--c-ink-soft); border-radius: 13px 13px 9px 13px; background: #fff; color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); }
.ctrl.on { background: #d9f2cf; color: #5cbf4a; }
.ctrl.off { background: #fbdbe0; color: #e85d6e; }

.chat-dock { position: relative; flex: none; width: 300px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; height: 52px; background: #fff; border: 3px solid var(--c-ink-soft); border-radius: 14px; box-shadow: var(--shadow-sm); }
.chat-log { position: absolute; bottom: 62px; left: 0; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.bubble { max-width: 360px; padding: 9px 12px; font-size: 9px; line-height: 1.7; border: 2px solid var(--c-ink-soft); background: #fff; box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); animation: px-bubble 0.2s steps(3); }
.bubble.me { background: #fff4cc; }
.bubble-name { color: #5cbf4a; }
.bubble-name.me { color: #f0a815; }
.chat-face { color: #a99f86; font-size: 16px; }
.chat-dock input { flex: 1; background: transparent; border: none; outline: none; color: var(--c-ink-soft); font-size: 13px; }
.chat-send { width: 38px; height: 38px; border: 2px solid var(--c-ink-soft); border-radius: 10px; background: var(--c-yellow); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

.footer-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.leave { display: flex; align-items: center; gap: 9px; padding: 0 18px; height: 52px; border: 3px solid var(--c-ink-soft); border-radius: 14px 14px 10px 14px; background: var(--c-coral); color: #fff; font-size: 9px; box-shadow: var(--shadow-sm); }

.room-toast { position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 13px 20px; background: #fffdf3; border: 3px solid #f0a815; color: #f0a815; font-size: 9px; line-height: 1.7; box-shadow: 5px 5px 0 rgba(43, 35, 51, 0.25); }
.toast-enter-active { animation: px-pop 0.18s steps(3); }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }

@keyframes px-bubble { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
</style>
