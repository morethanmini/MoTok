<script setup lang="ts">
/**
 * 게임룸 참가자 슬롯 타일.
 * - view가 없으면(빈 슬롯) "대기 중" 플레이스홀더를 보여준다(아직 미참가한 자리).
 * - view가 있으면 참가자 표시: 카메라 켜짐이면 영상, 아니면 이니셜 아바타. 마이크/왕관/발화 표시.
 * LiveKit 트랙은 <video>/<audio>에 attach하고 언마운트·교체 시 detach한다.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ParticipantView } from '@/composables/useLiveKitRoom'
import { attachSpeakerGain, detachSpeakerGain } from '@/composables/useSpeakerGain'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import type { StickerSprite } from '@/features/decor/sticker'

const props = withDefaults(
  defineProps<{
    view?: ParticipantView | null
    host?: boolean
    /** 원격 참가자면 true — 오디오를 재생한다(로컬은 에코 방지로 false) */
    playAudio?: boolean
    /** 로컬 프리뷰 등 좌우 반전 표시 */
    mirror?: boolean
    compact?: boolean
    canKick?: boolean
    canInvite?: boolean
    /**
     * 영상을 가려야 할 때의 안내 문구(null이면 그대로 보여준다).
     * 게임④ 출제 중인 출제자 캠처럼 "보이면 안 되는" 화면에 쓴다 — 트랙은 그대로 붙여두고
     * 표시만 덮는다(재부착 시 깜빡임·재협상 비용을 피한다).
     */
    cover?: string | null
    /** 이 참가자 소리를 내 쪽에서 얼마나 크게 들을지(0~1) — 상대 설정과 무관한 내 전용 값 */
    volume?: number
    /**
     * 게임 송출 중에도 카메라를 기본으로 보여줄지(-164). 뷰어가 게임에 참여하지 않을 때
     * (중간 이탈·라운드 놓침) 남의 게임 화면 대신 캠이 기본이어야 한다 — 토글은 그대로 살아 있다.
     */
    preferCam?: boolean
    /** 이 참가자가 데이터 채널로 알려 준 꾸미기 배치(useDecorSync) — 발행 영상에는 안 들어 있다. */
    sprites?: StickerSprite[]
  }>(),
  {
    view: null,
    host: false,
    playAudio: false,
    mirror: false,
    compact: false,
    canKick: false,
    canInvite: false,
    cover: null,
    volume: 1,
    preferCam: false,
    sprites: () => [],
  },
)
const emit = defineEmits<{ kick: []; friend: []; volume: [value: number] }>()

const occupied = computed(() => !!props.view)
const hasVideo = computed(() => !!props.view?.cameraOn && !!props.view?.videoTrack)
const hasGame = computed(() => !!props.view?.gameTrack)

/** 게임 송출 중 이 타일에서 카메라를 보고 싶은지(뷰어별 토글). 기본값은 preferCam이 정한다. */
const showCam = ref(props.preferCam)
// 게임 송출이 새로 시작되거나 뷰어의 참여 상태가 바뀌면 기본값으로 복귀
watch(hasGame, (on) => {
  if (on) showCam.value = props.preferCam
})
watch(() => props.preferCam, (prefer) => {
  showCam.value = prefer
})

const videoEl = ref<HTMLVideoElement>()
const audioEl = ref<HTMLAudioElement>()
const videoAspect = ref(8 / 5)
function syncVideoAspect() {
  const video = videoEl.value
  if (!video?.videoWidth || !video.videoHeight) return
  // 게임 캔버스 비율은 반영하지 않는다 — 발행자 타일 폭에서 사이드바를 뺀 크기라 카메라(16:9)와
  // 전혀 다르고, 라운드마다 트랙이 교체되며 타일 폭이 튄다(게임④ 출제 중 축소 제보).
  if (showingGame.value) return
  videoAspect.value = video.videoWidth / video.videoHeight
}

// 트랙 인스턴스만 의존 대상으로 삼는다(뷰모델 객체는 이벤트마다 새로 생기므로 그대로 쓰면 재부착·깜빡임).
// videoTrack/el 중 하나가 실제로 바뀔 때만 재부착.
// 게임 화면이 송출 중이면(토글로 카메라를 고르지 않은 한) 게임 트랙을, 아니면 카메라를 표시.
const showingGame = computed(() => hasGame.value && !showCam.value)
const videoTrack = computed(() => {
  if (showingGame.value) return props.view?.gameTrack ?? null
  return hasVideo.value ? (props.view?.videoTrack ?? null) : null
})
const showingVideo = computed(() => !!videoTrack.value)
const audioTrack = computed(() => (props.playAudio ? (props.view?.audioTrack ?? null) : null))

watch(
  [videoTrack, videoEl],
  ([track, el], _prev, onCleanup) => {
    if (track && el) {
      track.attach(el)
      onCleanup(() => track.detach(el))
    }
  },
  { immediate: true },
)
watch(
  [audioTrack, audioEl],
  ([track, el], _prev, onCleanup) => {
    if (track && el) {
      track.attach(el)
      // 스피커 증폭은 트랙이 아니라 요소에 건다 — 트랙이 갈려도 요소는 같은 DOM 노드라
      // createMediaElementSource(요소당 1회 제약)를 다시 부르지 않게 된다.
      attachSpeakerGain(el)
      onCleanup(() => track.detach(el))
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (audioEl.value) detachSpeakerGain(audioEl.value)
})

const initial = computed(() => (props.view?.name || '?').slice(0, 1).toUpperCase())

// ── 개인 볼륨 (내 쪽에서만 적용) ──────────────
// 원격 참가자 타일에서만 의미가 있다(로컬 타일은 애초에 소리를 재생하지 않는다).
const canAdjustVolume = computed(() => props.playAudio && occupied.value)
const menuOpen = ref(false)
const volumePercent = computed(() => Math.round(props.volume * 100))
function onVolumeInput(e: Event) {
  emit('volume', Number((e.target as HTMLInputElement).value) / 100)
}
</script>

<template>
  <div
    class="tile"
    :class="{ empty: !occupied, speaking: occupied && view?.isSpeaking, compact, 'menu-open': menuOpen }"
    :style="{ '--camera-aspect': videoAspect }"
  >
    <!-- 참가자 있음 -->
    <template v-if="occupied">
      <video
        v-show="showingVideo"
        ref="videoEl"
        autoplay
        playsinline
        muted
        class="tile-video"
        :class="{ mirror, game: showingGame }"
        @loadedmetadata="syncVideoAspect"
      />
      <audio v-if="playAudio" ref="audioEl" autoplay />
      <div v-if="!showingVideo" class="cam-off">
        <span class="avatar">{{ initial }}</span>
      </div>

      <!-- 스티커 좌표는 카메라 프레임 기준이라 게임 화면 트랙에는 얹지 않는다.
           fit은 <video>의 object-fit과 같아야 여백이 아니라 영상 안 같은 자리에 붙는다. -->
      <StickerOverlay
        v-if="showingVideo && !showingGame && sprites.length"
        :sprites="sprites"
        :mirrored="mirror"
        fit="contain"
        :frame-aspect="videoAspect"
      />

      <!-- 가림막 — 영상 위, 라벨·왕관 아래(DOM 순서로 쌓임) -->
      <div v-if="cover" class="cover">{{ cover }}</div>

      <div class="label">
        <span v-if="host" class="crown">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="#2b2333" stroke-width="1.4">
            <path d="M3 8l4 3.5L12 4l5 7.5L21 8l-2 11H5L3 8z" />
          </svg>
        </span>
        <span class="name">{{ view?.name }}</span>
      </div>
      <span class="mic" :class="{ muted: !view?.micOn }">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square">
          <rect x="9" y="3" width="6" height="11" />
          <path d="M5 11a7 7 0 0014 0M12 18v3" />
          <path v-if="!view?.micOn" d="M4 4l16 16" stroke-width="3.4" />
        </svg>
      </span>
      <!-- 게임 송출 중 게임 화면 ↔ 카메라 전환(뷰어별) — 아이콘은 전환될 대상을 보여준다 -->
      <button
        v-if="hasGame"
        class="view-toggle"
        :title="showCam ? '게임 화면 보기' : '카메라 보기'"
        @click="showCam = !showCam"
      >
        {{ showCam ? '🎮' : '📷' }}
      </button>

      <!-- 개인 볼륨 — 이 참가자 소리를 내 쪽에서만 줄인다(상대 마이크 설정과 무관) -->
      <button
        v-if="canAdjustVolume || canInvite || canKick"
        class="vol-btn"
        :class="{ open: menuOpen }"
        :title="`${view?.name} 메뉴`"
        @click.stop="menuOpen = !menuOpen"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path v-if="volume === 0" d="M16 9l6 6M22 9l-6 6" />
          <path v-else d="M15.5 9a3.5 3.5 0 010 6" />
        </svg>
      </button>
      <div v-if="menuOpen" class="vol-bar" @click.stop>
        <div v-if="canAdjustVolume" class="menu-volume">
          <span>볼륨</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          :value="volumePercent"
          :aria-label="`${view?.name} 볼륨`"
          @input="onVolumeInput"
        />
        </div>
        <button v-if="canInvite" type="button" class="menu-action invite" @click="emit('friend')">친구 추가</button>
        <button v-if="canKick" type="button" class="menu-action kick" @click="emit('kick')">강퇴하기</button>
      </div>

    </template>

    <!-- 빈 슬롯 (미참가) -->
    <template v-else>
      <div class="placeholder">
        <span class="wait-dot" />
        <span class="wait-text">대기 중</span>
        <small>빈 자리</small>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border: 3px solid var(--c-ink-soft);
  border-radius: 14px 14px 10px 14px;
  box-shadow: none;
}
.tile.speaking {
  border-color: #5cbf4a;
  box-shadow: 0 0 0 2px #5cbf4a;
}
.tile.empty {
  border-style: dashed;
  border-color: #cbbdca;
  box-shadow: none;
  background: #faf6ee;
}
.tile.menu-open { overflow: hidden; }

.tile.compact { width: 100%; aspect-ratio: var(--camera-aspect, 8 / 5); }
/* 내 타일과 같은 규칙 — 타일 비율과 영상 비율이 다를 때 잘라내지 않고 남는 자리를 회색 여백으로.
   여기 <video>는 카메라일 수도, 게임 화면 트랙일 수도 있어 비율 차이가 더 크다. */
.tile-video { width: 100%; height: 100%; object-fit: cover; background: var(--c-letterbox); }
/* 게임 화면 트랙만 여백 색을 무대 배경(three.js scene.background 0x1a1411)과 맞춘다 — 밝은 회색
   띠가 무대 옆에 남으면 화면이 잘린 것처럼 읽힌다. 비율은 위 공통 규칙(contain)을 그대로 따른다. */
.tile .tile-video.game { background: #1a1411; }
.tile-video.mirror { transform: scaleX(-1); }

.cam-off {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--c-mint-soft), #fff0c4);
}
.avatar {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 3px solid var(--c-ink-soft);
  border-radius: 50%;
  background: #fff;
  color: var(--c-ink-soft);
  font-size: 16px;
}

.cover {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 8px;
  text-align: center;
  background: repeating-linear-gradient(
    45deg,
    #2b2333,
    #2b2333 12px,
    #3b3145 12px,
    #3b3145 24px
  );
  color: #ffcf4d;
  font-size: 9px;
  line-height: 1.6;
}

.label {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  padding: 6px 9px;
  background: #fffdf7;
  border: 2px solid #b78d5d;
  border-radius: 6px;
  box-shadow: 2px 2px 0 #e2d0b5;
  color: #403124;
  pointer-events: auto;
}
.name { font-size: 9px; }
.mic {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  color: #5b8d45;
}
.mic.muted { color: #d45c63; }
.kick-btn {
  margin-left: 5px;
  padding: 2px 5px;
  border: 1px solid #a94d52;
  border-radius: 5px;
  background: #ffe2e3;
  color: #a94d52;
  font-family: inherit;
  font-size: 7px;
  line-height: 1.25;
  cursor: pointer;
}

.crown { display: inline-flex; flex: none; color: #f5c518; pointer-events: none; }

/* 개인 볼륨 — 버튼은 왼쪽 아래, 슬라이더는 타일 하단을 가로지른다(타일이 작아도 넘치지 않게) */
.vol-btn {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  padding: 4px;
  border: 2px solid var(--c-ink-soft);
  border-radius: 8px;
  background: rgba(255, 253, 247, 0.92);
  color: #403124;
  cursor: pointer;
}
.vol-btn.muted { background: #ffe2e3; color: #a94d52; }
.vol-btn.open { background: var(--c-mint-soft); }
.vol-bar {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  border: 2px solid var(--c-ink-soft);
  border-radius: 8px;
  background: rgba(255, 253, 247, 0.94);
}
.vol-bar input { flex: 1; min-width: 0; accent-color: #5cbf4a; }
.vol-val { font-size: 8px; color: #403124; }
.vol-btn { top: 8px; right: 8px; bottom: auto; left: auto; width: 30px; height: 24px; padding: 0; border: 2px solid #b78d5d; border-radius: 6px; background: #fff8e9; box-shadow: 2px 2px 0 #e2d0b5; color: #74513c; }.vol-btn:hover { background: #fff0b6; }.vol-btn svg { display: none; }.vol-btn::after { width: 13px; height: 2px; border-radius: 1px; background: currentColor; box-shadow: 0 4px currentColor, 0 8px currentColor; content: ''; transform: translateY(-4px); }.vol-btn.open { background: #f2d9a8; color: #65432f; box-shadow: 1px 1px 0 #d2af7c; }.vol-bar { top: 38px; right: 8px; bottom: auto; left: auto; width: 154px; display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px; border-color: #b78d5d; background: #fffdf7; box-shadow: 3px 3px 0 rgba(92, 63, 44, .22); }.vol-bar input { grid-column: 1; }.vol-val { grid-column: 2; }.menu-action { grid-column: 1 / -1; min-height: 29px; border: 0; border-radius: 5px; font-family: inherit; font-size: 9px; font-weight: 700; cursor: pointer; }.menu-action.invite { background: #dff0d0; color: #47763e; }.menu-action.kick { background: #ffe3e3; color: #a94d52; }
.vol-bar { width: min(184px, calc(100% - 16px)); max-width: calc(100% - 16px); max-height: calc(100% - 46px); box-sizing: border-box; display: block; overflow-y: auto; padding: 8px 12px; border: 3px solid #8d6048; border-radius: 12px; background: #fff8e9; box-shadow: none; }.menu-head { padding: 9px 4px 12px; border-bottom: 2px dashed #d7b58e; color: #573a2b; font-size: 12px; font-weight: 700; text-align: center; }.menu-volume { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; padding: 12px 10px; border-bottom: 2px dashed #ead5b8; color: #5a3e30; font-size: 11px; }.menu-volume input { grid-column: auto; width: 100%; min-width: 0; margin: 0; accent-color: #6c9b54; }.vol-val { color: #6c9b54; font-size: 10px; }.menu-action { display: block; width: 100%; min-height: 0; margin: 0; padding: 12px 10px; border: 0; border-radius: 0; background: transparent; color: #5a3e30; text-align: center; font-size: 12px; }.menu-action.invite { background: transparent; color: #5a3e30; }.menu-action.kick { border-top: 2px dashed #ead5b8; background: transparent; color: #c45c52; }.menu-action:hover, .menu-action.invite:hover { background: #fff0b6; color: #5a3e30; }.menu-action.kick:hover { background: transparent; color: #a8433b; }

.view-toggle {
  position: absolute;
  bottom: 8px;
  right: 42px;
  padding: 5px 8px;
  font-size: 12px;
  line-height: 1;
  background: rgba(255, 253, 247, 0.92);
  border: 2px solid var(--c-ink-soft);
  border-radius: 8px;
  cursor: pointer;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: center;
  justify-content: center;
  color: #a99f86;
}
.wait-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #d3c7b4;
  animation: px-blink 1.2s steps(2) infinite;
}
.wait-text { font-size: 14px; }
.placeholder small { font-size: 11px; color: #bcae98; }
</style>
