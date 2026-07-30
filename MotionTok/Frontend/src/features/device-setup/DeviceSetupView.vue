<script setup lang="ts">
/** 장치 설정 — 카메라/마이크 권한 확인 + 프리뷰 + 카메라 꾸미기. 입장 시 게임룸으로. */
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi, type InventoryItem } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { useMicLevel } from '@/composables/useMicLevel'
import { EQUIP_LIMIT, useDecoration } from '@/composables/useDecoration'
import { useMediaPermissionStore } from '@/stores/mediaPermission'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'

import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'
import inventoryChest from '@/assets/device-setup/inventory-chest.png'

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
/** 게임 목록에서 고른 게임의 서버 gameId — 게임룸이 입장 직후 이 게임을 자동으로 연다. */
const autostart = computed(() => (route.query.autostart as string) || '')
const showDecorInventory = ref(false)
const roomCopied = ref(false)
const videoEl = ref<HTMLVideoElement>()
watch(stream, (s) => { if (videoEl.value) videoEl.value.srcObject = s })
const showVideo = computed(() => isOn.value && camOn.value)

/**
 * 캠·마이크 초기 상태 요청(쿼리 cam=0·mic=0) — 혼자 플레이 경로가 붙여 준다.
 * 혼자 놀 방은 발행을 받을 사람이 없어 꺼진 채로 시작하는 게 기본이다(게임 입력은 로컬 캡처를 쓰므로
 * 꺼도 플레이된다 — GameRoomView가 캡처는 항상 켠다).
 *
 * <p>토글로 끄는 이유 — useCamera.start()가 스트림을 잡을 때 트랙 유무로 camOn·micOn을 다시 켜므로,
 * 값을 미리 넣어 두면 지워진다. 스트림이 선 뒤에 토글해야 트랙의 enabled까지 같이 내려간다.
 * 한 번만 적용하므로, 여기서 사용자가 다시 켜면 그 선택이 그대로 방까지 간다(enter가 쿼리로 넘긴다).</p>
 */
const wantCamOff = route.query.cam === '0'
const wantMicOff = route.query.mic === '0'
let initialDeviceStateApplied = false
watch(
  isOn,
  (on) => {
    if (!on || initialDeviceStateApplied) return
    initialDeviceStateApplied = true
    if (wantCamOff && camOn.value) toggleCam()
    if (wantMicOff && micOn.value) toggleMic()
  },
  { immediate: true },
)

// ── 권한 ────────────────────────────────────────────────
// allow()의 getUserMedia가 곧 '확인이자 요청'이다 — 앱에서 이미 허용했으면 팝업 없이 바로 열리고,
// 사이트 설정에서 취소돼 풀렸으면 여기서 다시 묻는다. 결과는 useCamera가 전역 상태에 반영한다.
// (ensure()를 따로 먼저 부르면 같은 요청이 두 번 돌아 카메라 표시등만 두 번 깜빡인다)
const permission = useMediaPermissionStore()
const checking = ref(false)

async function allow() { await start({ video: { width: 640, height: 400 }, audio: true }) }

onMounted(async () => {
  checking.value = true
  try {
    await allow()
  } finally {
    checking.value = false
  }
})

// ── 카메라 꾸미기 ───────────────────────────────────────
// 장착은 인벤토리와 같은 API라 누르는 즉시 저장되고, 위치·크기는 저장 버튼(또는 입장 시 자동 저장) 대상이다.
// 방에 들어가기 직전이 "지금 카메라에 어떻게 보이나"를 가장 정확히 확인하는 순간이라 여기서도 편집한다.
const decor = useDecoration()
onMounted(decor.load)

// 프리뷰 영상 크기 — 오버레이 기하와 스티커 크기 제한(원본 이상 확대 금지)에 쓴다.
// 카메라가 아직 안 켜졌으면 게임룸과 같은 제약값(640x400)을 가정한다.
const frameW = ref(640)
const frameH = ref(400)
const previewAspect = computed(() => frameW.value / frameH.value)

function onVideoMeta() {
  const el = videoEl.value
  if (!el?.videoWidth || !el.videoHeight) return
  frameW.value = el.videoWidth
  frameH.value = el.videoHeight
}

/** 꾸미기 영역의 짧은 안내(저장 완료·서버 거절 사유). 잠깐 보여 주고 지운다. */
const decorMessage = ref('')
let decorMessageTimer: ReturnType<typeof setTimeout> | undefined
function flashDecorMessage(text: string) {
  decorMessage.value = text
  clearTimeout(decorMessageTimer)
  decorMessageTimer = setTimeout(() => (decorMessage.value = ''), 2600)
}

// 크기·삭제는 프리뷰의 선택 상자 핸들로 한다(별도 슬라이더 없음).
const selectedId = ref<number | null>(null)
/** 프리뷰 프레임의 실제 픽셀 — 오버레이가 크기 상한(원본 이상 확대 금지)을 계산하는 데 쓴다. */
const framePixels = computed(() => ({ w: frameW.value, h: frameH.value }))

/** 선택 상자의 ✕ — 장착 해제와 같다(해제하면 배치에서도 빠진다). */
async function removeSticker(itemId: number) {
  if (await decor.setEquipped(itemId, false)) {
    if (selectedId.value === itemId) selectedId.value = null
  } else if (decor.error.value) {
    flashDecorMessage(decor.error.value)
  }
}

const busyItemId = ref<number | null>(null)
async function toggleItem(item: InventoryItem) {
  if (busyItemId.value !== null) return
  busyItemId.value = item.itemId
  const equipped = !item.equipped
  if (await decor.setEquipped(item.itemId, equipped)) {
    // 방금 붙인 스티커를 바로 옮길 수 있게 선택 상태로 둔다.
    if (equipped) selectedId.value = item.itemId
    else if (selectedId.value === item.itemId) selectedId.value = null
  } else if (decor.error.value) {
    // 한도 초과 등 서버가 거절한 사유를 그대로 보여 준다.
    flashDecorMessage(decor.error.value)
  }
  busyItemId.value = null
}

async function saveDecor() {
  flashDecorMessage((await decor.save()) ? '꾸미기를 저장했어요' : (decor.error.value ?? '저장하지 못했어요'))
}
async function copyRoomCode() {
  try {
    await navigator.clipboard.writeText(room.value)
    roomCopied.value = true
    window.setTimeout(() => { roomCopied.value = false }, 1800)
  } catch {
    window.prompt('룸 코드를 복사하세요.', room.value)
  }
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
async function enter() {
  if (!isOn.value) return
  // 게임룸은 서버에 저장된 배치를 읽어 방에 알리므로, 저장 안 하고 들어가면 방금 옮긴 자리가 빠진다.
  if (decor.dirty.value) await decor.save()
  proceedingToRoom = true
  // solo·autostart는 그대로 넘긴다 — 각각 게임룸의 빈 슬롯 숨김과 자동 시작에 쓰이는 값이라
  // 여기서 떨어지면 멀티 레이아웃으로 열리고 방에서 게임을 다시 골라야 한다(없으면 넣지 않는다).
  router.push({
    name: RouteName.GameRoom,
    query: {
      game: game.value,
      room: room.value,
      cam: camOn.value ? '1' : '0',
      mic: micOn.value ? '1' : '0',
      ...(route.query.solo === '1' ? { solo: '1' } : {}),
      ...(autostart.value ? { autostart: autostart.value } : {}),
    },
  })
}
useRoomUnloadLeave(() => route.query.room as string | undefined)
let notified = false
async function notifyLeave() {
  if (notified) return
  notified = true
  const roomId = route.query.room as string | undefined
  if (!roomId) return
  try { await roomsApi.leave(roomId) } catch { /* room may already have been closed */ }
}
onBeforeRouteLeave(async () => {
  if (proceedingToRoom) return true
  await notifyLeave()
  return true
})
async function cancel() { await notifyLeave(); router.push({ name: RouteName.Lobby }) }
</script>

<template>
  <main class="waiting-room px-paper-bg">
    <header class="waiting-header">
      <button type="button" class="logo-btn" aria-label="로비로 돌아가기" @click="cancel"><BrandLogo title="" /></button>
      <div class="header-title">
        <h1>카메라와 마이크를 확인해 주세요</h1>
      </div>
      <div class="room-code"><small>ROOM CODE</small><div><strong>{{ room }}</strong><button type="button" class="copy-room-code" :class="{ copied: roomCopied }" :aria-label="roomCopied ? '룸 코드 복사 완료' : '룸 코드 복사'" @click="copyRoomCode"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="1" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></svg></button></div></div>
    </header>

    <div class="waiting-layout">
      <section class="camera-panel">
        <div class="panel-heading"><span>CAMERA PREVIEW</span><b :class="{ ready: isOn }">{{ isOn ? '준비 완료' : '권한 필요' }}</b></div>
        <div class="camera-frame">
          <video
            v-show="showVideo"
            ref="videoEl"
            autoplay
            playsinline
            muted
            class="cam-video"
            @loadedmetadata="onVideoMeta"
          />
          <!-- 장착 스티커 미리보기 겸 편집. 프리뷰는 좌우 반전(scaleX(-1))이라 mirrored,
               object-fit:cover라 넘치는 영역까지 같은 기하로 맞춘다. 끌어서 자리를 정한다. -->
          <StickerOverlay
            v-if="showVideo"
            class="sticker-layer"
            :sprites="decor.sprites.value"
            mirrored
            editable
            fit="cover"
            :frame-aspect="previewAspect"
            :frame-pixels="framePixels"
            :selected-id="selectedId"
            @move="decor.move"
            @scale="decor.setScale"
            @remove="removeSticker"
            @select="selectedId = $event"
          />
          <div v-if="!isOn" class="camera-empty">
            <div class="camera-icon" aria-hidden="true" />
            <h2>카메라와 마이크를 연결해 주세요</h2>
            <p>입장 전 한 번만 권한을 허용하면 돼요.</p>
          </div>
          <div v-else-if="!camOn" class="camera-empty">
            <div class="camera-off-icon" aria-hidden="true" />
            <h2>카메라가 꺼져 있어요</h2>
          </div>
          <div v-if="isOn" class="device-controls">
            <button type="button" :class="{ off: !camOn }" @click="toggleCam"><svg class="device-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="12" height="10" rx="1" /><path d="m15 10 6-3v10l-6-3" /></svg>{{ camOn ? '카메라 켜짐' : '카메라 꺼짐' }}</button>
            <button type="button" :class="{ off: !micOn }" @click="toggleMic"><svg class="device-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></svg>{{ micOn ? '마이크 켜짐' : '마이크 꺼짐' }}</button>
          </div>
          <section v-if="showDecorInventory" class="mini-inventory" aria-label="카메라 꾸미기 인벤토리">
            <div class="mini-inventory-head"><strong>카메라 꾸미기</strong><button type="button" aria-label="인벤토리 닫기" @click="showDecorInventory = false">×</button></div>
            <div v-if="decor.inventory.value.length" class="mini-inventory-items has-items">
              <button
                v-for="item in decor.inventory.value"
                :key="item.itemId"
                type="button"
                class="decor-item"
                :class="{ on: item.equipped }"
                :disabled="busyItemId !== null || !decor.canEquip(item)"
                :title="decor.canEquip(item) ? item.name : `${item.name} · 장착 한도(${EQUIP_LIMIT[item.category]}개)를 넘었어요`"
                @click="toggleItem(item)"
              >
                <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" />
                <span v-else>🌟</span>
              </button>
            </div>
            <div v-else class="mini-inventory-items">
              <span>{{ decor.loading.value ? '불러오는 중…' : '현재 적용할 수 있는 꾸미기 아이템이 없어요.' }}</span>
            </div>

            <!-- 배치 편집 — 크기·삭제는 프리뷰의 선택 상자 핸들이 맡는다 -->
            <div v-if="decor.placements.value.length" class="mini-inventory-edit">
              <p class="decor-hint">
                프리뷰에서 끌어 자리를 정하세요. 스티커를 고르면 점선 상자의 ⤡로 크기 조절, ✕로 뗍니다.
              </p>
              <button type="button" class="decor-save" :disabled="decor.saving.value" @click="saveDecor">
                {{ decor.saving.value ? '저장 중…' : decor.dirty.value ? '꾸미기 저장 *' : '꾸미기 저장' }}
              </button>
            </div>
            <p v-if="decorMessage" class="decor-msg">{{ decorMessage }}</p>
          </section>
          <button type="button" class="inventory-shortcut" :class="{ active: showDecorInventory }" aria-label="카메라 꾸미기 인벤토리 열기" @click="showDecorInventory = !showDecorInventory">
            <img :src="inventoryChest" alt="" />
            <span>카메라 꾸미기</span>
          </button>
        </div>
        <p class="preview-note">내 화면은 다른 참가자에게 좌우 반전 없이 전달됩니다.</p>
      </section>

      <aside class="setup-panel">
        <div class="setup-intro"><span>READY CHECK</span><h2>입장 전 마지막 확인</h2><p>기기 상태를 확인하고 대기실에 들어가세요.</p></div>
        <section class="permission-card" :class="{ ok: isOn }">
          <div>
            <strong>{{ isOn ? '기기 연결이 완료됐어요' : '카메라와 마이크 권한이 필요해요' }}</strong>
            <!-- 브라우저가 차단한 경우엔 여기서 다시 물어도 팝업이 안 뜬다 — 어디서 풀어야 하는지 알려 준다. -->
            <p v-if="!isOn && permission.denied">
              브라우저가 차단하고 있어요. 주소창의 자물쇠 아이콘 → 사이트 설정에서 카메라·마이크를
              허용으로 바꾼 뒤 다시 시도해 주세요.
            </p>
            <p v-else-if="!isOn && checking">권한을 확인하는 중이에요…</p>
            <p v-else>{{ isOn ? '카메라와 마이크를 개별로 켜고 끌 수 있어요.' : '모션 게임을 위해 두 기기를 모두 사용해요.' }}</p>
          </div>
          <button type="button" class="allow-button" :disabled="isOn || checking" @click="allow">{{ isOn ? '연결됨' : '권한 허용하기' }}</button>
        </section>

        <!-- 장치 라벨은 권한 허용 후에야 채워지므로 허용 전에는 목록을 열지 않는다. -->
        <label class="setting-field">카메라
          <select :disabled="!isOn" :value="videoDeviceId ?? ''" @change="pickCamera">
            <option v-if="!isOn" value="">권한을 허용하면 카메라를 고를 수 있어요</option>
            <option v-for="(d, i) in videoDevices" :key="d.deviceId" :value="d.deviceId">
              {{ d.label || `카메라 ${i + 1}` }}
            </option>
          </select>
        </label>
        <label class="setting-field">마이크
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
        <!-- 권한 오류는 위 권한 카드가 이미 말해주므로, 여기선 장치 전환 실패만 알린다. -->
        <p v-if="error && isOn" class="field-err">{{ error }}</p>
        <div class="actions"><PixelButton @click="cancel">취소</PixelButton><PixelButton variant="primary" :disabled="!isOn" @click="enter">대기실 입장</PixelButton></div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.waiting-room { min-height: 100%; box-sizing: border-box; padding: 22px clamp(18px, 4vw, 62px) 34px; color: #402f25; }
.waiting-header { display: flex; align-items: center; max-width: 1460px; margin: 0 auto 20px; gap: 14px; }.header-title span, .setup-intro > span, .panel-heading > span { color: #ad7652; font-size: 10px; font-weight: 700; letter-spacing: .8px; }.header-title h1 { margin: 0; font-family: var(--font-pixel); font-size: 25px; font-weight: 400; }.room-code { margin-left: auto; min-width: 96px; text-align: center; transform: translateY(7px); }.room-code small { display: block; color: #a47f60; font-size: 8px; font-weight: 700; }.room-code > div { display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 2px; }.room-code strong { color: #60422e; font-family: var(--font-pixel); font-size: 17px; font-weight: 400; }.copy-room-code { display: grid; width: 20px; height: 20px; place-items: center; padding: 0; border: 0; background: transparent; color: #9b765d; }.copy-room-code:hover, .copy-room-code.copied { color: #d67862; }.copy-room-code svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.waiting-layout { display: grid; grid-template-columns: minmax(0, 1.48fr) minmax(355px, .72fr); gap: 22px; max-width: 1460px; margin: 0 auto; }.camera-panel, .setup-panel { border: 3px solid #d5b98e; border-radius: 15px; background: #fffdf7; box-shadow: 5px 5px 0 #dfcdb0; }.camera-panel { padding: 18px; }.panel-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }.panel-heading b { padding: 5px 9px; border-radius: 5px; background: #f9dfb0; color: #805b42; font-size: 10px; }.panel-heading b.ready { background: #dcecbf; color: #56743e; }
.camera-frame { position: relative; display: grid; width: 100%; aspect-ratio: 16 / 9; place-items: center; overflow: hidden; border: 3px solid #8d6a54; border-radius: 10px; background: #53423c; }.camera-frame::before { content: ''; position: absolute; inset: 9px; z-index: 1; border: 1px solid rgba(255,255,255,.34); border-radius: 4px; pointer-events: none; }.cam-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }.camera-empty { z-index: 2; text-align: center; color: #fff9ef; }.camera-empty h2 { margin: 15px 0 5px; font-size: 17px; }.camera-empty p { margin: 0; color: #ded0c3; font-size: 12px; }.camera-icon, .camera-off-icon { position: relative; width: 54px; height: 38px; margin: auto; border: 3px solid #f5deb7; border-radius: 5px; }.camera-icon::after, .camera-off-icon::after { content: ''; position: absolute; top: 8px; right: -16px; width: 12px; height: 17px; border: 3px solid #f5deb7; border-left: 0; }.camera-off-icon::before { content: ''; position: absolute; top: 16px; left: -10px; width: 69px; height: 3px; background: #e77771; transform: rotate(-34deg); }
.device-controls { position: absolute; z-index: 3; bottom: 18px; left: 50%; display: flex; gap: 8px; transform: translateX(-50%); }.device-controls button { display: inline-flex; align-items: center; gap: 7px; height: 39px; padding: 0 12px; border: 2px solid #8d6a54; border-radius: 6px; background: #fffdf7; color: #563e2f; box-shadow: 2px 2px 0 rgba(45,28,17,.35); font-size: 11px; font-weight: 700; }.device-controls button.off { background: #f8d9d5; color: #a45a56; }.device-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }.preview-note { margin: 12px 2px 0; color: #998170; font-size: 10px; }
.inventory-shortcut { position: absolute; z-index: 3; right: 15px; bottom: 15px; display: inline-flex; align-items: center; gap: 7px; height: 45px; padding: 0 10px 0 6px; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; color: #5e4432; box-shadow: 3px 3px 0 rgba(45,28,17,.35); font-size: 10px; font-weight: 700; }.inventory-shortcut:hover, .inventory-shortcut.active { transform: translate(-1px, -1px); background: #fff4d6; }.inventory-shortcut img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }.mini-inventory { position: absolute; z-index: 4; right: 149px; bottom: 15px; width: 210px; overflow: hidden; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; box-shadow: 4px 4px 0 rgba(45,28,17,.4); color: #533d2f; }.mini-inventory-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 10px; border-bottom: 2px solid #dec79e; background: #f7e5bb; font-size: 11px; }.mini-inventory-head button { width: 19px; height: 19px; border: 0; background: transparent; color: #79553d; font-size: 19px; line-height: 1; }.mini-inventory-items { display: grid; min-height: 57px; padding: 10px; place-items: center; color: #8f7868; text-align: center; font-size: 10px; line-height: 1.4; }
/* 프리뷰 <video>를 프레임에 정확히 맞춘다 — grid 자식으로 두면 height:100%가 순환 참조라
   auto로 풀려 실제 크기가 프레임과 달라지고, 스티커 오버레이 계산이 어긋난다. */
.cam-video { position: absolute; inset: 0; }
.sticker-layer { z-index: 2; }
/* 꾸미기 인벤토리 — 아이템 격자와 배치 편집 */
.mini-inventory-items.has-items { display: flex; flex-wrap: wrap; gap: 6px; place-items: stretch; }
.decor-item { width: 42px; height: 40px; padding: 4px; border: 2px solid #8d6a54; border-radius: 6px; background: #fffdf7; }
.decor-item img { width: 100%; height: 100%; object-fit: contain; }
.decor-item.on { background: #f7e5bb; box-shadow: 2px 2px 0 rgba(45,28,17,.28); }
.decor-item:disabled { opacity: .55; }
.mini-inventory-edit { padding: 0 10px 10px; border-top: 2px dashed #dec79e; }
.decor-hint { margin: 8px 0 0; color: #8f7868; font-size: 9px; line-height: 1.4; }


.decor-save { width: 100%; height: 30px; margin-top: 8px; border: 2px solid #9a694d; border-radius: 6px; background: #edc66e; color: #543a29; font-size: 10px; font-weight: 700; }
.decor-save:disabled { opacity: .6; }
.decor-msg { margin: 0; padding: 8px 10px; border-top: 2px dashed #dec79e; color: #5d7f5e; font-size: 9px; line-height: 1.4; }
/* 입력 레벨 미터 — 고른 마이크가 소리를 받는지 칸으로 표시(마이크 select 아래) */
.meter { display: flex; width: 100%; min-width: 0; gap: 3px; margin-top: 7px; box-sizing: border-box; }
.meter .seg { flex: 1; height: 11px; border: 2px solid #d5b98e; border-radius: 3px; background: #f4ecdd; }
.meter .seg.on { background: #8fc16b; }
.meter .seg.hot.on { background: #e77771; }
.meter-hint { margin: 5px 0 0; color: #8c7564; font-size: 10px; font-weight: 400; }
.field-err { margin: 8px 0 0; color: #c0564f; font-size: 10px; font-weight: 700; }
.setup-panel { display: flex; min-width: 0; flex-direction: column; box-sizing: border-box; padding: 24px; }.setup-intro h2 { margin: 6px 0 6px; font-family: var(--font-pixel); font-size: 21px; font-weight: 400; }.setup-intro p { margin: 0; color: #8c7564; font-size: 12px; }.permission-card { display: grid; min-width: 0; gap: 13px; margin-top: 22px; padding: 15px; border: 2px solid #dfc391; border-radius: 8px; background: #fff2cb; }.permission-card.ok { background: #e2f0d0; border-color: #b6d38d; }.permission-card strong { font-size: 13px; }.permission-card p { margin: 5px 0 0; color: #806c5c; font-size: 11px; line-height: 1.45; }.allow-button { height: 38px; border: 2px solid #9a694d; border-radius: 6px; background: #edc66e; color: #543a29; font-size: 12px; font-weight: 700; }.allow-button:disabled { border-color: #9db47b; background: #cfe5aa; color: #526e3e; }
.setting-field { display: grid; min-width: 0; gap: 7px; margin-top: 17px; color: #584234; font-size: 12px; font-weight: 700; }.setting-field select { width: 100%; min-width: 0; height: 40px; box-sizing: border-box; padding: 0 38px 0 10px; overflow: hidden; appearance: none; border: 2px solid #d5b98e; border-radius: 6px; background: #fffdf7 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='m1 1 5 5 5-5' fill='none' stroke='%23604a3a' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'/%3E%3C/svg%3E") no-repeat calc(100% - 14px) center / 12px 8px; color: #604a3a; text-overflow: ellipsis; }.actions { display: grid; grid-template-columns: .8fr 1.2fr; gap: 9px; margin-top: auto; padding-top: 24px; }.actions :deep(.px-btn) { min-width: 0; border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 14px; }
@media (max-width: 900px) { .waiting-room { min-height: 100vh; }.waiting-layout { grid-template-columns: 1fr; }.setup-panel { order: 2; } }
@media (max-width: 560px) { .waiting-header { flex-wrap: wrap; gap: 12px; }.header-title { order: 3; width: 100%; }.header-title h1 { font-size: 20px; }.room-code { margin-left: auto; }.camera-panel, .setup-panel { padding: 14px; }.device-controls { width: calc(100% - 22px); justify-content: center; }.device-controls button { padding: 0 9px; font-size: 10px; } }
.logo-btn { flex: none; border: 0; background: transparent; padding: 0; cursor: pointer; }
</style>
