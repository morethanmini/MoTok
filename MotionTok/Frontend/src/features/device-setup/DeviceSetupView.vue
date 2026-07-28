<script setup lang="ts">
/** 장치 설정 — 카메라/마이크 권한 요청 + 프리뷰 + 꾸미기. 입장 시 게임룸으로. */
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { useMicLevel } from '@/composables/useMicLevel'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'

const route = useRoute()
const router = useRouter()
const {
  stream,
  isOn,
  error,
  camOn,
  micOn,
  videoDevices,
  audioDevices,
  videoDeviceId,
  audioDeviceId,
  start,
  toggleCam,
  toggleMic,
  selectVideoDevice,
  selectAudioDevice,
} = useCamera()

const game = computed(() => (route.query.game as string) || '게임 선택 중')
const room = computed(() => (route.query.room as string) || 'MP4X9K')

const decor = ref<'🎩' | '⭐'>('🎩')
const videoEl = ref<HTMLVideoElement>()

// 스트림이 준비되면 프리뷰 <video>에 연결
watch(stream, (s) => {
  if (videoEl.value) videoEl.value.srcObject = s
})

// 카메라를 꺼도 <video>는 계속 렌더링되어야 다시 켤 때 스트림이 자연스럽게 이어진다 — v-show로만 가린다.
const showVideo = computed(() => isOn.value && camOn.value)

async function allow() {
  await start({ video: { width: 640, height: 400 }, audio: true })
}

/** 카메라 선택 — 프리뷰가 바로 그 카메라로 바뀌고, 고른 장치는 게임룸까지 이어진다. */
function pickCamera(e: Event) {
  void selectVideoDevice((e.target as HTMLSelectElement).value)
}
/** 마이크 선택 — 고른 장치는 게임룸 LiveKit 발행까지 이어진다. */
function pickMic(e: Event) {
  void selectAudioDevice((e.target as HTMLSelectElement).value)
}

// 입력 레벨 미터 — 고른 마이크가 실제로 소리를 받는지 눈으로 확인시켜 준다.
const MIC_SEGMENTS = 10
const { level: micLevel } = useMicLevel(stream)
// RMS를 그대로 쓰면 대화 소리에서도 막대가 거의 안 움직인다 — -60dB~0dB를 눈금 전체에 편다.
const micBars = computed(() => {
  if (micLevel.value <= 0) return 0
  const db = 20 * Math.log10(micLevel.value)
  return Math.round(Math.min(1, Math.max(0, (db + 60) / 60)) * MIC_SEGMENTS)
})

// 게임룸으로 넘어가는 건 이탈이 아니라 계속 진행이므로 퇴장 통보를 건너뛴다.
let proceedingToRoom = false
function enter() {
  if (!isOn.value) return
  proceedingToRoom = true
  router.push({
    name: RouteName.GameRoom,
    query: {
      game: game.value,
      room: room.value,
      cam: camOn.value ? '1' : '0',
      mic: micOn.value ? '1' : '0',
    },
  })
}

// 탭 닫기·주소창 이탈도 여기선 join된 상태의 이탈이다 — keepalive 퇴장 통보 + bfcache 복원 시 로비로
useRoomUnloadLeave(() => route.query.room as string | undefined)

// 로비에서 이미 join된 상태로 여기 들어오므로, 취소·로고 클릭·뒤로가기 등 어떤 경로로
// 이 화면을 벗어나도 백엔드에 퇴장을 알려야 인원수가 줄어든다.
let notified = false
async function notifyLeave() {
  if (notified) return
  notified = true
  const roomId = route.query.room as string | undefined
  if (roomId) {
    try {
      await roomsApi.leave(roomId)
    } catch {
      // 이미 방이 없어졌거나 네트워크 오류여도 화면 이동은 계속 진행
    }
  }
}

onBeforeRouteLeave(async () => {
  if (proceedingToRoom) return true
  await notifyLeave()
  return true
})

async function cancel() {
  await notifyLeave()
  router.push({ name: RouteName.Lobby })
}
// 내 아바타(인벤토리·화면 꾸미기) 전체 편집으로 이동
const goInventory = () => router.push({ name: RouteName.Inventory })
</script>

<template>
  <main class="page px-party-bg">
    <header class="top">
      <button type="button" class="logo-btn" @click="cancel">
        <BrandLogo subtitle="PLAY CHECK STATION" />
      </button>
      <div class="top-copy">
        <span class="px-kicker">STEP 01 · READY</span>
        <h1>카메라 앞에 설 준비가 됐나요?</h1>
      </div>
      <span class="step">{{ game }} · {{ room }}</span>
    </header>

    <div class="grid">
      <!-- 프리뷰 -->
      <section class="preview">
        <img class="preview-art art-note" src="/assets/intro/tambourine.png" alt="" />
        <img class="preview-art art-star" src="/assets/intro/constellation.png" alt="" />
        <span class="badge">{{ isOn ? 'CAMERA READY' : '권한 필요' }}</span>
        <div class="cam">
          <video
            v-show="showVideo"
            ref="videoEl"
            autoplay
            playsinline
            muted
            class="cam-video"
          />
          <div v-if="!isOn" class="cam-empty">
            <img src="/assets/intro/person.png" alt="카메라 준비" />
            <p>카메라·마이크 권한을 허용해 주세요</p>
          </div>
          <div v-else-if="!camOn" class="cam-empty">
            <img src="/assets/intro/person.png" alt="카메라 꺼짐" />
            <p>카메라가 꺼져 있어요</p>
          </div>
        </div>
        <div v-if="isOn" class="dev-toggles">
          <button type="button" class="dev-toggle" :class="{ off: !camOn }" @click="toggleCam">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="6" width="14" height="12" /><path d="M16 10l6-4v12l-6-4" /></svg>
            {{ camOn ? '카메라 켜짐' : '카메라 꺼짐' }}
          </button>
          <button type="button" class="dev-toggle" :class="{ off: !micOn }" @click="toggleMic">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
            {{ micOn ? '마이크 켜짐' : '마이크 꺼짐' }}
          </button>
        </div>
        <div class="decor">{{ decor }}</div>
      </section>

      <!-- 설정 -->
      <section class="settings">
        <span class="setting-no">CHECK LIST · 3</span>
        <h2>입장 전 마지막 체크!</h2>

        <div class="permission" :class="{ ok: isOn }">
          {{ isOn
            ? '권한이 허용되었습니다. 장치와 꾸미기를 확인한 뒤 입장하세요.'
            : '권한을 허용하지 않으면 모션 게임을 플레이할 수 없습니다.' }}
          <button class="allow" @click="allow">
            {{ isOn ? '✓ 권한 허용됨' : '카메라·마이크 권한 허용' }}
          </button>
        </div>

        <label class="field">
          카메라
          <!-- 장치 라벨은 권한 허용 후에야 채워지므로 허용 전에는 목록을 열지 않는다. -->
          <select :disabled="!isOn" :value="videoDeviceId ?? ''" @change="pickCamera">
            <option v-if="!isOn" value="">권한을 허용하면 카메라를 고를 수 있어요</option>
            <option v-for="(d, i) in videoDevices" :key="d.deviceId" :value="d.deviceId">
              {{ d.label || `카메라 ${i + 1}` }}
            </option>
          </select>
        </label>
        <label class="field">
          마이크
          <select :disabled="!isOn" :value="audioDeviceId ?? ''" @change="pickMic">
            <option v-if="!isOn" value="">권한을 허용하면 마이크를 고를 수 있어요</option>
            <option v-for="(d, i) in audioDevices" :key="d.deviceId" :value="d.deviceId">
              {{ d.label || `마이크 ${i + 1}` }}
            </option>
          </select>
          <!-- 입력 레벨 — 고른 마이크가 소리를 받고 있는지 바로 보인다 -->
          <div v-if="isOn" class="meter" :aria-label="`마이크 입력 레벨 ${micBars}/${MIC_SEGMENTS}`">
            <span
              v-for="i in MIC_SEGMENTS"
              :key="i"
              class="seg"
              :class="{ on: micOn && i <= micBars, hot: i > MIC_SEGMENTS - 2 }"
            />
          </div>
          <p v-if="isOn" class="meter-hint">
            {{ micOn ? '말해보세요 — 막대가 움직이면 정상이에요' : '마이크가 꺼져 있어요' }}
          </p>
        </label>
        <!-- 권한 오류는 위 안내 박스가 이미 말해주므로, 여기선 장치 전환 실패만 알린다. -->
        <p v-if="error && isOn" class="field-err">{{ error }}</p>

        <div class="field">
          <div class="field-head">
            <span>카메라 꾸미기</span>
            <button type="button" class="inv-link" @click="goInventory">내 아바타 전체 →</button>
          </div>
          <div class="items">
            <button class="item" :class="{ on: decor === '🎩' }" @click="decor = '🎩'">🎩</button>
            <button class="item" :class="{ on: decor === '⭐' }" @click="decor = '⭐'">⭐</button>
            <button class="item">🎭</button>
            <button class="item">🌈</button>
          </div>
        </div>

        <div class="actions">
          <PixelButton @click="cancel">취소</PixelButton>
          <PixelButton variant="mint" :disabled="!isOn" @click="enter">대기실 입장</PixelButton>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page { height: 100%; padding: 20px 5%; overflow: hidden; }
.top { height: 76px; display: flex; align-items: center; gap: 24px; }
.logo-btn { border: 0; background: transparent; padding: 0; cursor: pointer; }
.top-copy { margin-left: 24px; }
.top h1 { margin: 8px 0 0; font-size: 18px; }
.step { font-size: 10px; padding: 7px 10px; border: 2px solid var(--c-ink); border-radius: 999px; background: #fff; }
.top .step { margin-left: auto; box-shadow: 2px 2px 0 var(--c-ink); }

.grid {
  height: calc(100% - 84px);
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: 20px;
}
.preview, .settings {
  border: var(--border-thick);
  border-radius: 22px;
  background: #fff;
  box-shadow: var(--shadow-lg);
}

.preview {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(35deg, transparent 0 46%, rgba(101,121,221,.1) 46% 53%, transparent 53%),
    linear-gradient(135deg, #dff3ee, #fff0c4);
  display: grid;
  place-items: center;
}
.cam {
  width: 68%;
  height: 68%;
  border: var(--border-thick);
  border-radius: 21px;
  background: #2b2333;
  display: grid;
  place-items: center;
  color: #fff;
  text-align: center;
  overflow: hidden;
}
.cam-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.cam-empty b { font-size: 46px; }
.cam-empty img { width: 180px; max-height: 170px; object-fit: contain; filter: drop-shadow(5px 5px 0 rgba(0,0,0,.24)); }
.cam-empty p { font-size: 10px; }
.badge {
  position: absolute;
  top: 17px;
  left: 17px;
  padding: 7px 10px;
  border: 2px solid var(--c-ink);
  border-radius: 10px;
  background: var(--c-mint-soft);
  font-size: 9px;
}
.decor { position: absolute; right: 18%; top: 25%; font-size: 42px; }
.preview-art { position: absolute; z-index: 2; width: 105px; pointer-events: none; filter: drop-shadow(4px 4px 0 rgba(56,38,61,.18)); }
.art-note { left: -24px; bottom: -12px; transform: rotate(16deg); }
.art-star { right: -32px; bottom: -12px; transform: rotate(-13deg); }

/* 입장 전 카메라·마이크 개별 온오프 */
.dev-toggles { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 3; display: flex; gap: 10px; }
.dev-toggle {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 13px;
  border: 2px solid var(--c-ink);
  border-radius: 11px;
  background: #fff;
  font-size: 9px;
  font-weight: 700;
  box-shadow: var(--shadow-sm);
}
.dev-toggle.off { background: #fbdbe0; color: var(--c-coral); }

.settings { padding: 24px; overflow: auto; background: rgba(255,255,255,.94); }
.setting-no { display: inline-block; margin-bottom: 9px; color: var(--c-coral); font-size: 9px; font-weight: 700; }
.settings h2 { font-size: 16px; margin: 0 0 16px; }
.permission {
  padding: 13px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-md);
  background: #fff3c9;
  font-size: 10px;
  line-height: 1.6;
}
.permission.ok { background: var(--c-mint-soft); }
.allow {
  width: 100%;
  height: 43px;
  margin-top: 10px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: var(--c-yellow);
  font-weight: 700;
}
.field { display: block; margin-top: 15px; font-size: 9px; font-weight: 700; }
.field-head { display: flex; align-items: center; justify-content: space-between; }
.inv-link { border: 0; background: transparent; color: var(--c-blue); font-size: 9px; font-weight: 700; }
.field select {
  width: 100%;
  height: 42px;
  margin-top: 6px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 0 10px;
}
.field select:disabled { background: #f1eef4; color: #8d8496; }
.field-err { margin: 6px 0 0; color: var(--c-coral); font-size: 9px; }
/* 입력 레벨 미터 — 픽셀 톤에 맞춰 칸으로 끊어 표시 */
.meter { display: flex; gap: 3px; margin-top: 7px; }
.meter .seg {
  flex: 1;
  height: 11px;
  border: 2px solid var(--c-ink);
  border-radius: 3px;
  background: #efe9f2;
}
.meter .seg.on { background: #5cbf4a; }
.meter .seg.hot.on { background: var(--c-coral); }
.meter-hint { margin: 5px 0 0; color: #8d8496; font-size: 8px; font-weight: 400; }
.items { display: flex; gap: 8px; margin-top: 8px; }
.item { width: 52px; height: 48px; border: 2px solid var(--c-ink); border-radius: 12px; background: #fff; font-size: 23px; }
.item.on { background: #d9ccfa; box-shadow: var(--shadow-sm); }
.actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 9px; margin-top: 19px; }
</style>
