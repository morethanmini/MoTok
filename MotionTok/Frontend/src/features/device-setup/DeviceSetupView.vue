<script setup lang="ts">
/** 장치 설정 — 카메라/마이크 권한 요청 + 프리뷰 + 꾸미기. 입장 시 게임룸으로. */
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { roomsApi, type InventoryItem } from '@/api'
import { useCamera } from '@/composables/useCamera'
import { EQUIP_LIMIT, useDecoration } from '@/composables/useDecoration'
import { useMediaPermissionStore } from '@/stores/mediaPermission'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import { getLoadedImage, scaleLimits } from '@/features/decor/sticker'
import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'

const route = useRoute()
const router = useRouter()
const { stream, isOn, camOn, micOn, start, toggleCam, toggleMic } = useCamera()

const game = computed(() => (route.query.game as string) || '게임 선택 중')
const room = computed(() => (route.query.room as string) || 'MP4X9K')

const videoEl = ref<HTMLVideoElement>()

// 스트림이 준비되면 프리뷰 <video>에 연결
watch(stream, (s) => {
  if (videoEl.value) videoEl.value.srcObject = s
})

// ── 내 꾸미기 아이템 ────────────────────────────────────────
// 여기서 장착을 바꾸면 인벤토리와 같은 API를 쓰므로 그대로 저장되고, 그 상태로 방에 들어간다.
// 위치 조정은 인벤토리("내 아바타 전체 →")에서 한다.
const decor = useDecoration()
onMounted(decor.load)

// 프리뷰 영상 크기 — 오버레이의 레터박스 계산과 스티커 크기 제한(원본 이상 확대 금지)에 쓴다.
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
const saveMessage = ref('')
let saveMessageTimer: ReturnType<typeof setTimeout> | undefined
function flashDecorMessage(text: string) {
  saveMessage.value = text
  clearTimeout(saveMessageTimer)
  saveMessageTimer = setTimeout(() => (saveMessage.value = ''), 2600)
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

// ── 배치 편집 ────────────────────────────────────────────
// 인벤토리 화면과 같은 편집을 여기서도 한다 — 방에 들어가기 직전이 "지금 카메라에 어떻게 보이나"를
// 가장 정확히 확인하는 순간이라, 자리를 고치려고 인벤토리까지 돌아가게 하지 않는다.
const selectedId = ref<number | null>(null)
const selected = computed(
  () => decor.placements.value.find((p) => p.itemId === selectedId.value) ?? null,
)

/** 슬라이더 범위는 스티커마다 다르다 — 상한은 원본 이미지 크기, 하한은 최소 표시 픽셀. */
const scaleRange = computed(() => {
  const sprite = decor.sprites.value.find((s) => s.itemId === selectedId.value)
  const natural = sprite ? (getLoadedImage(sprite.imageUrl)?.naturalWidth ?? 0) : 0
  return scaleLimits(frameW.value, frameH.value, natural)
})

function onScale(value: number) {
  if (selectedId.value !== null) decor.setScale(selectedId.value, value)
}

async function saveDecor() {
  flashDecorMessage((await decor.save()) ? '꾸미기를 저장했어요' : (decor.error.value ?? '저장하지 못했어요'))
}

// 카메라를 꺼도 <video>는 계속 렌더링되어야 다시 켤 때 스트림이 자연스럽게 이어진다 — v-show로만 가린다.
const showVideo = computed(() => isOn.value && camOn.value)

// ── 권한 ────────────────────────────────────────────────
// 앱에서 이미 허용한 적이 있으면 여기서 다시 묻지 않는다 — 실제 상태만 확인하고 바로 카메라를 켠다.
// 확인 결과 풀려 있으면(사이트 설정에서 취소 등) 그 자리에서 다시 요청하고 전역 상태도 고쳐진다.
const permission = useMediaPermissionStore()
const checking = ref(false)

async function allow() {
  await start({ video: { width: 640, height: 400 }, audio: true })
}

// allow()의 getUserMedia가 곧 '확인이자 요청'이다 — 이미 허용돼 있으면 팝업 없이 바로 열리고,
// 풀렸으면 여기서 다시 묻는다. 결과는 useCamera가 전역 권한 상태에 반영한다.
// (별도로 ensure()를 먼저 부르면 같은 요청이 두 번 돌아 카메라 표시등만 두 번 깜빡인다)
onMounted(async () => {
  checking.value = true
  try {
    await allow()
  } finally {
    checking.value = false
  }
})

// 게임룸으로 넘어가는 건 이탈이 아니라 계속 진행이므로 퇴장 통보를 건너뛴다.
let proceedingToRoom = false
async function enter() {
  if (!isOn.value) return
  // 저장 안 한 배치가 있으면 먼저 저장한다 — 게임룸은 서버에 저장된 배치를 읽어 합성하므로,
  // 그냥 들어가면 방금 옮긴 자리가 반영되지 않는다(사용자에겐 그냥 사라진 것으로 보인다).
  if (decor.dirty.value) await decor.save()
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
            @loadedmetadata="onVideoMeta"
          />
          <!-- 장착한 스티커 미리보기. 영상이 좌우 반전(scaleX(-1))이라 mirrored,
               object-fit:contain이라 여백을 뺀 실제 영상 영역에만 얹는다. -->
          <StickerOverlay
            v-if="showVideo"
            :sprites="decor.sprites.value"
            mirrored
            editable
            fit="contain"
            :frame-aspect="previewAspect"
            :selected-id="selectedId"
            @move="decor.move"
            @select="selectedId = $event"
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
      </section>

      <!-- 설정 -->
      <section class="settings">
        <span class="setting-no">CHECK LIST · 3</span>
        <h2>입장 전 마지막 체크!</h2>

        <div class="permission" :class="{ ok: isOn }">
          <template v-if="isOn">권한이 허용되었습니다. 장치와 꾸미기를 확인한 뒤 입장하세요.</template>
          <template v-else-if="checking">권한을 확인하는 중이에요…</template>
          <template v-else-if="permission.denied">
            브라우저가 카메라·마이크를 차단하고 있어요. 주소창의 자물쇠 아이콘에서 허용으로 바꾼 뒤
            다시 시도해 주세요.
          </template>
          <template v-else>권한을 허용하지 않으면 모션 게임을 플레이할 수 없습니다.</template>
          <button class="allow" :disabled="checking" @click="allow">
            {{ isOn ? '✓ 권한 허용됨' : '카메라·마이크 권한 허용' }}
          </button>
        </div>

        <label class="field">
          카메라
          <select>
            <option>기본 HD 웹캠</option>
            <option>외장 USB 카메라</option>
          </select>
        </label>
        <label class="field">
          마이크
          <select>
            <option>기본 마이크</option>
            <option>헤드셋 마이크</option>
          </select>
        </label>

        <div class="field">
          <div class="field-head">
            <span>카메라 꾸미기</span>
            <button type="button" class="inv-link" @click="goInventory">내 아바타 전체 →</button>
          </div>
          <div v-if="decor.inventory.value.length" class="items">
            <button
              v-for="item in decor.inventory.value"
              :key="item.itemId"
              type="button"
              class="item"
              :class="{ on: item.equipped }"
              :disabled="busyItemId !== null || !decor.canEquip(item)"
              :title="decor.canEquip(item) ? item.name : `${item.name} · 장착 한도(${EQUIP_LIMIT[item.category]}개)를 넘었어요`"
              @click="toggleItem(item)"
            >
              <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" />
              <span v-else>🌟</span>
            </button>
          </div>
          <p v-else class="items-empty">
            {{ decor.loading.value ? '불러오는 중…' : '보유한 아이템이 없어요. 상점에서 구매해보세요!' }}
          </p>

          <!-- 배치 편집 — 미리보기에서 끌어 옮기고, 고른 스티커의 크기를 여기서 조절한다 -->
          <template v-if="decor.placements.value.length">
            <p class="decor-hint">미리보기에서 스티커를 끌어 자리를 정하세요.</p>
            <div v-if="selected" class="size-row">
              <label for="decor-scale">크기</label>
              <input
                id="decor-scale"
                type="range"
                :min="scaleRange.min"
                :max="scaleRange.max"
                step="0.005"
                :value="Math.min(selected.scale, scaleRange.max)"
                @input="onScale(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="size-val">{{ Math.round((Math.min(selected.scale, scaleRange.max) / scaleRange.max) * 100) }}%</span>
            </div>
            <div class="decor-save">
              <button type="button" class="inv-link" :disabled="decor.saving.value" @click="saveDecor">
                {{ decor.saving.value ? '저장 중…' : decor.dirty.value ? '꾸미기 저장 *' : '꾸미기 저장' }}
              </button>
              <span v-if="saveMessage" class="save-msg">{{ saveMessage }}</span>
            </div>
          </template>
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
  /* flex인 이유 — grid + auto 행에서는 자식 <video>의 height:100%가 순환 참조라 auto로 풀려
     실제 크기가 박스보다 커진다. 그러면 화면에 보이는 영역과 스티커 오버레이 계산이 어긋난다. */
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  text-align: center;
  overflow: hidden;
}
/* contain — 카메라 화면이 잘리지 않게 전부 넣는다(비율이 다르면 위아래·좌우에 여백). */
.cam-video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); }
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
.items { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.item { width: 52px; height: 48px; padding: 6px; border: 2px solid var(--c-ink); border-radius: 12px; background: #fff; font-size: 23px; }
.item img { width: 100%; height: 100%; object-fit: contain; }
.item.on { background: #d9ccfa; box-shadow: var(--shadow-sm); }
.item:disabled { opacity: 0.6; }
.items-empty { margin: 8px 0 0; font-size: 9px; color: var(--c-muted); }
.decor-hint { margin: 9px 0 0; font-size: 9px; color: var(--c-muted); }
.size-row { display: flex; align-items: center; gap: 9px; margin-top: 8px; font-size: 10px; font-weight: 700; color: var(--c-muted); }
.size-row input[type='range'] { flex: 1; }
.size-val { min-width: 34px; color: var(--c-ink); }
.decor-save { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
.save-msg { font-size: 9px; color: #2f8f6f; }
.actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 9px; margin-top: 19px; }
</style>
