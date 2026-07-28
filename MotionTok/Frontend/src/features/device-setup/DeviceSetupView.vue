<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'
import inventoryChest from '@/assets/device-setup/inventory-chest.png'

const route = useRoute()
const router = useRouter()
const { stream, isOn, camOn, micOn, start, toggleCam, toggleMic } = useCamera()
const game = computed(() => (route.query.game as string) || '게임 선택 중')
const room = computed(() => (route.query.room as string) || 'MP4X9K')
const showDecorInventory = ref(false)
const roomCopied = ref(false)
const videoEl = ref<HTMLVideoElement>()
watch(stream, (s) => { if (videoEl.value) videoEl.value.srcObject = s })
const showVideo = computed(() => isOn.value && camOn.value)
async function allow() { await start({ video: { width: 640, height: 400 }, audio: true }) }
async function copyRoomCode() {
  try {
    await navigator.clipboard.writeText(room.value)
    roomCopied.value = true
    window.setTimeout(() => { roomCopied.value = false }, 1800)
  } catch {
    window.prompt('룸 코드를 복사하세요.', room.value)
  }
}

let proceedingToRoom = false
function enter() {
  if (!isOn.value) return
  proceedingToRoom = true
  router.push({ name: RouteName.GameRoom, query: { game: game.value, room: room.value, cam: camOn.value ? '1' : '0', mic: micOn.value ? '1' : '0' } })
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
      <button type="button" class="logo-btn" aria-label="로비로 돌아가기" @click="cancel"><BrandLogo subtitle="READY ROOM" /></button>
      <div class="header-title">
        <span>GAME ROOM · STEP 01</span>
        <h1>카메라와 마이크를 확인해 주세요</h1>
      </div>
      <div class="room-code"><small>ROOM CODE</small><div><strong>{{ room }}</strong><button type="button" class="copy-room-code" :class="{ copied: roomCopied }" :aria-label="roomCopied ? '룸 코드 복사 완료' : '룸 코드 복사'" @click="copyRoomCode"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="1" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></svg></button></div></div>
    </header>

    <div class="waiting-layout">
      <section class="camera-panel">
        <div class="panel-heading"><span>CAMERA PREVIEW</span><b :class="{ ready: isOn }">{{ isOn ? '준비 완료' : '권한 필요' }}</b></div>
        <div class="camera-frame">
          <video v-show="showVideo" ref="videoEl" autoplay playsinline muted class="cam-video" />
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
            <div class="mini-inventory-items"><span>현재 적용할 수 있는 꾸미기 아이템이 없어요.</span></div>
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
          <div><strong>{{ isOn ? '기기 연결이 완료됐어요' : '카메라와 마이크 권한이 필요해요' }}</strong><p>{{ isOn ? '카메라와 마이크를 개별로 켜고 끌 수 있어요.' : '모션 게임을 위해 두 기기를 모두 사용해요.' }}</p></div>
          <button type="button" class="allow-button" :disabled="isOn" @click="allow">{{ isOn ? '연결됨' : '권한 허용하기' }}</button>
        </section>

        <label class="setting-field">카메라
          <select><option>기본 HD 카메라</option><option>외장 USB 카메라</option></select>
        </label>
        <label class="setting-field">마이크
          <select><option>기본 마이크</option><option>헤드셋 마이크</option></select>
        </label>
        <div class="actions"><PixelButton @click="cancel">취소</PixelButton><PixelButton variant="primary" :disabled="!isOn" @click="enter">대기실 입장</PixelButton></div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.waiting-room { min-height: 100%; box-sizing: border-box; padding: 22px clamp(18px, 4vw, 62px) 34px; color: #402f25; }
.waiting-header { display: flex; align-items: center; max-width: 1460px; margin: 0 auto 20px; gap: 14px; }.logo-btn { flex: none; border: 0; background: transparent; padding: 0; cursor: pointer; }.header-title span, .setup-intro > span, .panel-heading > span { color: #ad7652; font-size: 10px; font-weight: 700; letter-spacing: .8px; }.header-title h1 { margin: 5px 0 0; font-family: var(--font-pixel); font-size: 25px; font-weight: 400; }.room-code { margin-left: auto; min-width: 96px; text-align: center; transform: translateY(7px); }.room-code small { display: block; color: #a47f60; font-size: 8px; font-weight: 700; }.room-code > div { display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 2px; }.room-code strong { color: #60422e; font-family: var(--font-pixel); font-size: 17px; font-weight: 400; }.copy-room-code { display: grid; width: 20px; height: 20px; place-items: center; padding: 0; border: 0; background: transparent; color: #9b765d; }.copy-room-code:hover, .copy-room-code.copied { color: #d67862; }.copy-room-code svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.waiting-layout { display: grid; grid-template-columns: minmax(0, 1.48fr) minmax(355px, .72fr); gap: 22px; max-width: 1460px; margin: 0 auto; }.camera-panel, .setup-panel { border: 3px solid #d5b98e; border-radius: 15px; background: #fffdf7; box-shadow: 5px 5px 0 #dfcdb0; }.camera-panel { padding: 18px; }.panel-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }.panel-heading b { padding: 5px 9px; border-radius: 5px; background: #f9dfb0; color: #805b42; font-size: 10px; }.panel-heading b.ready { background: #dcecbf; color: #56743e; }
.camera-frame { position: relative; display: grid; width: 100%; aspect-ratio: 16 / 9; place-items: center; overflow: hidden; border: 3px solid #8d6a54; border-radius: 10px; background: #53423c; }.camera-frame::before { content: ''; position: absolute; inset: 9px; z-index: 1; border: 1px solid rgba(255,255,255,.34); border-radius: 4px; pointer-events: none; }.cam-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }.camera-empty { z-index: 2; text-align: center; color: #fff9ef; }.camera-empty h2 { margin: 15px 0 5px; font-size: 17px; }.camera-empty p { margin: 0; color: #ded0c3; font-size: 12px; }.camera-icon, .camera-off-icon { position: relative; width: 54px; height: 38px; margin: auto; border: 3px solid #f5deb7; border-radius: 5px; }.camera-icon::after, .camera-off-icon::after { content: ''; position: absolute; top: 8px; right: -16px; width: 12px; height: 17px; border: 3px solid #f5deb7; border-left: 0; }.camera-off-icon::before { content: ''; position: absolute; top: 16px; left: -10px; width: 69px; height: 3px; background: #e77771; transform: rotate(-34deg); }
.device-controls { position: absolute; z-index: 3; bottom: 18px; left: 50%; display: flex; gap: 8px; transform: translateX(-50%); }.device-controls button { display: inline-flex; align-items: center; gap: 7px; height: 39px; padding: 0 12px; border: 2px solid #8d6a54; border-radius: 6px; background: #fffdf7; color: #563e2f; box-shadow: 2px 2px 0 rgba(45,28,17,.35); font-size: 11px; font-weight: 700; }.device-controls button.off { background: #f8d9d5; color: #a45a56; }.device-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }.preview-note { margin: 12px 2px 0; color: #998170; font-size: 10px; }
.inventory-shortcut { position: absolute; z-index: 3; right: 15px; bottom: 15px; display: inline-flex; align-items: center; gap: 7px; height: 45px; padding: 0 10px 0 6px; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; color: #5e4432; box-shadow: 3px 3px 0 rgba(45,28,17,.35); font-size: 10px; font-weight: 700; }.inventory-shortcut:hover, .inventory-shortcut.active { transform: translate(-1px, -1px); background: #fff4d6; }.inventory-shortcut img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }.mini-inventory { position: absolute; z-index: 4; right: 149px; bottom: 15px; width: 210px; overflow: hidden; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; box-shadow: 4px 4px 0 rgba(45,28,17,.4); color: #533d2f; }.mini-inventory-head { display: flex; align-items: center; justify-content: space-between; padding: 9px 10px; border-bottom: 2px solid #dec79e; background: #f7e5bb; font-size: 11px; }.mini-inventory-head button { width: 19px; height: 19px; border: 0; background: transparent; color: #79553d; font-size: 19px; line-height: 1; }.mini-inventory-items { display: grid; min-height: 57px; padding: 10px; place-items: center; color: #8f7868; text-align: center; font-size: 10px; line-height: 1.4; }
.setup-panel { display: flex; flex-direction: column; padding: 24px; }.setup-intro h2 { margin: 6px 0 6px; font-family: var(--font-pixel); font-size: 21px; font-weight: 400; }.setup-intro p { margin: 0; color: #8c7564; font-size: 12px; }.permission-card { display: grid; gap: 13px; margin-top: 22px; padding: 15px; border: 2px solid #dfc391; border-radius: 8px; background: #fff2cb; }.permission-card.ok { background: #e2f0d0; border-color: #b6d38d; }.permission-card strong { font-size: 13px; }.permission-card p { margin: 5px 0 0; color: #806c5c; font-size: 11px; line-height: 1.45; }.allow-button { height: 38px; border: 2px solid #9a694d; border-radius: 6px; background: #edc66e; color: #543a29; font-size: 12px; font-weight: 700; }.allow-button:disabled { border-color: #9db47b; background: #cfe5aa; color: #526e3e; }
.setting-field { display: grid; gap: 7px; margin-top: 17px; color: #584234; font-size: 12px; font-weight: 700; }.setting-field select { height: 40px; padding: 0 10px; border: 2px solid #d5b98e; border-radius: 6px; background: #fffdf7; color: #604a3a; }.actions { display: grid; grid-template-columns: .8fr 1.2fr; gap: 9px; margin-top: auto; padding-top: 24px; }.actions :deep(.px-btn) { border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 14px; }
@media (max-width: 900px) { .waiting-room { min-height: 100vh; }.waiting-layout { grid-template-columns: 1fr; }.setup-panel { order: 2; } }
@media (max-width: 560px) { .waiting-header { flex-wrap: wrap; gap: 12px; }.header-title { order: 3; width: 100%; }.header-title h1 { font-size: 20px; }.room-code { margin-left: auto; }.camera-panel, .setup-panel { padding: 14px; }.device-controls { width: calc(100% - 22px); justify-content: center; }.device-controls button { padding: 0 9px; font-size: 10px; } }
</style>
