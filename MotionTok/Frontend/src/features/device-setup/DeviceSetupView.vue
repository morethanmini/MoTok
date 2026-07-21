<script setup lang="ts">
/** 장치 설정 — 카메라/마이크 권한 요청 + 프리뷰 + 꾸미기. 입장 시 게임룸으로. */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useCamera } from '@/composables/useCamera'
import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'

const route = useRoute()
const router = useRouter()
const { stream, isOn, start } = useCamera()

const game = computed(() => (route.query.game as string) || '게임 선택 중')
const room = computed(() => (route.query.room as string) || 'MP4X9K')

const decor = ref<'🎩' | '⭐'>('🎩')
const videoEl = ref<HTMLVideoElement>()

// 스트림이 준비되면 프리뷰 <video>에 연결
watch(stream, (s) => {
  if (videoEl.value) videoEl.value.srcObject = s
})

async function allow() {
  await start({ video: { width: 640, height: 400 }, audio: true })
}

function enter() {
  if (!isOn.value) return
  router.push({
    name: RouteName.GameRoom,
    query: { game: game.value, room: room.value, host: '1' },
  })
}

const cancel = () => router.push({ name: RouteName.Lobby })
// 내 아바타(인벤토리·화면 꾸미기) 전체 편집으로 이동
const goInventory = () => router.push({ name: RouteName.Inventory })
</script>

<template>
  <main class="page px-party-bg">
    <header class="top">
      <BrandLogo subtitle="PLAY CHECK STATION" />
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
            v-show="isOn"
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
.items { display: flex; gap: 8px; margin-top: 8px; }
.item { width: 52px; height: 48px; border: 2px solid var(--c-ink); border-radius: 12px; background: #fff; font-size: 23px; }
.item.on { background: #d9ccfa; box-shadow: var(--shadow-sm); }
.actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 9px; margin-top: 19px; }
</style>
