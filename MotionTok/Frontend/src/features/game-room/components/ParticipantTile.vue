<script setup lang="ts">
/**
 * 게임룸 참가자 슬롯 타일.
 * - view가 없으면(빈 슬롯) "대기 중" 플레이스홀더를 보여준다(아직 미참가한 자리).
 * - view가 있으면 참가자 표시: 카메라 켜짐이면 영상, 아니면 이니셜 아바타. 마이크/왕관/발화 표시.
 * LiveKit 트랙은 <video>/<audio>에 attach하고 언마운트·교체 시 detach한다.
 */
import { computed, ref, watch } from 'vue'
import type { ParticipantView } from '@/composables/useLiveKitRoom'

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
    /**
     * 영상을 가려야 할 때의 안내 문구(null이면 그대로 보여준다).
     * 게임④ 출제 중인 출제자 캠처럼 "보이면 안 되는" 화면에 쓴다 — 트랙은 그대로 붙여두고
     * 표시만 덮는다(재부착 시 깜빡임·재협상 비용을 피한다).
     */
    cover?: string | null
    /** 이 참가자 소리를 내 쪽에서 얼마나 크게 들을지(0~1) — 상대 설정과 무관한 내 전용 값 */
    volume?: number
  }>(),
  {
    view: null,
    host: false,
    playAudio: false,
    mirror: false,
    compact: false,
    canKick: false,
    cover: null,
    volume: 1,
  },
)
const emit = defineEmits<{ kick: []; volume: [value: number] }>()

const occupied = computed(() => !!props.view)
const hasVideo = computed(() => !!props.view?.cameraOn && !!props.view?.videoTrack)
const hasGame = computed(() => !!props.view?.gameTrack)

/** 게임 송출 중 이 타일에서 카메라를 보고 싶은지(뷰어별 토글). 기본은 게임 화면. */
const showCam = ref(false)
// 게임 송출이 새로 시작되면 기본값(게임 화면)으로 복귀
watch(hasGame, (on) => {
  if (on) showCam.value = false
})

const videoEl = ref<HTMLVideoElement>()
const audioEl = ref<HTMLAudioElement>()
const videoAspect = ref(8 / 5)
function syncVideoAspect() {
  const video = videoEl.value
  if (!video?.videoWidth || !video.videoHeight) return
  videoAspect.value = video.videoWidth / video.videoHeight
}

// 트랙 인스턴스만 의존 대상으로 삼는다(뷰모델 객체는 이벤트마다 새로 생기므로 그대로 쓰면 재부착·깜빡임).
// videoTrack/el 중 하나가 실제로 바뀔 때만 재부착.
// 게임 화면이 송출 중이면(토글로 카메라를 고르지 않은 한) 게임 트랙을, 아니면 카메라를 표시.
const videoTrack = computed(() => {
  if (hasGame.value && !showCam.value) return props.view?.gameTrack ?? null
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
      onCleanup(() => track.detach(el))
    }
  },
  { immediate: true },
)

const initial = computed(() => (props.view?.name || '?').slice(0, 1).toUpperCase())

// ── 개인 볼륨 (내 쪽에서만 적용) ──────────────
// 원격 참가자 타일에서만 의미가 있다(로컬 타일은 애초에 소리를 재생하지 않는다).
const canAdjustVolume = computed(() => props.playAudio && occupied.value)
const volumeOpen = ref(false)
const volumePercent = computed(() => Math.round(props.volume * 100))
function onVolumeInput(e: Event) {
  emit('volume', Number((e.target as HTMLInputElement).value) / 100)
}
</script>

<template>
  <div
    class="tile"
    :class="{ empty: !occupied, speaking: occupied && view?.isSpeaking, compact }"
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
        :class="{ mirror }"
        @loadedmetadata="syncVideoAspect"
      />
      <audio v-if="playAudio" ref="audioEl" autoplay />
      <div v-if="!showingVideo" class="cam-off">
        <span class="avatar">{{ initial }}</span>
      </div>

      <!-- 가림막 — 영상 위, 라벨·왕관 아래(DOM 순서로 쌓임) -->
      <div v-if="cover" class="cover">{{ cover }}</div>

      <div class="label">
        <span class="name">{{ view?.name }}</span>
        <button v-if="canKick" class="kick-btn" title="방에서 내보내기" @click.stop="emit('kick')">강퇴</button>
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
        v-if="canAdjustVolume"
        class="vol-btn"
        :class="{ muted: volume === 0, open: volumeOpen }"
        :title="volume === 0 ? `${view?.name} 소리 끔` : `${view?.name} 소리 ${volumePercent}%`"
        @click.stop="volumeOpen = !volumeOpen"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path v-if="volume === 0" d="M16 9l6 6M22 9l-6 6" />
          <path v-else d="M15.5 9a3.5 3.5 0 010 6" />
        </svg>
      </button>
      <div v-if="canAdjustVolume && volumeOpen" class="vol-bar" @click.stop>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          :value="volumePercent"
          :aria-label="`${view?.name} 볼륨`"
          @input="onVolumeInput"
        />
        <span class="vol-val">{{ volumePercent }}%</span>
      </div>

      <div v-if="host" class="crown">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="#2b2333" stroke-width="1.4">
          <path d="M3 8l4 3.5L12 4l5 7.5L21 8l-2 11H5L3 8z" />
        </svg>
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

.tile.compact { width: 100%; aspect-ratio: var(--camera-aspect, 8 / 5); }
.tile-video { width: 100%; height: 100%; object-fit: cover; background: #eee6cf; }
.tile.compact .tile-video { object-fit: cover; }
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

.crown { position: absolute; top: 7px; right: 8px; color: #f5c518; pointer-events: none; }

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
.wait-text { font-size: 10px; }
.placeholder small { font-size: 8px; color: #bcae98; }
</style>
