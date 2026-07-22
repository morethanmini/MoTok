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
  }>(),
  { view: null, host: false, playAudio: false, mirror: false },
)

const occupied = computed(() => !!props.view)
const hasVideo = computed(() => !!props.view?.cameraOn && !!props.view?.videoTrack)

const videoEl = ref<HTMLVideoElement>()
const audioEl = ref<HTMLAudioElement>()

// 트랙 인스턴스만 의존 대상으로 삼는다(뷰모델 객체는 이벤트마다 새로 생기므로 그대로 쓰면 재부착·깜빡임).
// videoTrack/el 중 하나가 실제로 바뀔 때만 재부착.
const videoTrack = computed(() => (hasVideo.value ? (props.view?.videoTrack ?? null) : null))
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
</script>

<template>
  <div class="tile" :class="{ empty: !occupied, speaking: occupied && view?.isSpeaking }">
    <!-- 참가자 있음 -->
    <template v-if="occupied">
      <video
        v-show="hasVideo"
        ref="videoEl"
        autoplay
        playsinline
        muted
        class="tile-video"
        :class="{ mirror }"
      />
      <audio v-if="playAudio" ref="audioEl" autoplay />
      <div v-if="!hasVideo" class="cam-off">
        <span class="avatar">{{ initial }}</span>
      </div>

      <div class="label">
        <span class="name">{{ view?.name }}</span>
        <span class="mic" :class="{ muted: !view?.micOn }">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square">
            <rect x="9" y="3" width="6" height="11" />
            <path d="M5 11a7 7 0 0014 0M12 18v3" />
          </svg>
        </span>
      </div>

      <span class="live">● 참가 중</span>

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
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.tile.speaking {
  border-color: #5cbf4a;
  box-shadow: 0 0 0 2px #5cbf4a, 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.tile.empty {
  border-style: dashed;
  border-color: #cbbdca;
  box-shadow: none;
  background: #faf6ee;
}

.tile-video { width: 100%; height: 100%; object-fit: cover; background: #eee6cf; }
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

.label {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  background: #fffdf3;
  border: 2px solid var(--c-ink-soft);
  pointer-events: none;
}
.name { font-size: 9px; }
.mic { color: #5cbf4a; }
.mic.muted { color: #e85d6e; }

.live {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 4px 7px;
  background: rgba(43, 35, 51, 0.72);
  color: #fff;
  font-size: 7px;
  border-radius: 6px;
}
.crown { position: absolute; top: 7px; right: 8px; color: #f5c518; pointer-events: none; }

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
