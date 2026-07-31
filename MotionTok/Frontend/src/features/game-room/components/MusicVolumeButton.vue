<script setup lang="ts">
/**
 * 게임방 리본의 음악 버튼 — 누르면 <b>게임 BGM</b> 볼륨 슬라이더가 열린다.
 *
 * <p>로비 테마는 건드리지 않는다. 게임방에서 듣게 되는 음악이 게임 BGM이고, 로비 음악은
 * 설정 화면에서 따로 조절한다(설정 › 소리).</p>
 *
 * <p>0.5가 기본이고 1.0이 2배다. 헤더의 {@code BgmToggle}(켜기/끄기)과 역할이 다르며,
 * 0에서 올리면 꺼둔 음악까지 되살린다.</p>
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useBgm } from '@/composables/useBgm'

const { gameMusic, isEnabled, setGameMusic } = useBgm()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const percent = computed(() => Math.round(gameMusic.value * 100))
/** 0이거나 헤더에서 꺼둔 상태 — 아이콘에 사선을 그린다 */
const silent = computed(() => percent.value === 0 || !isEnabled.value)

function onInput(e: Event) {
  setGameMusic(Number((e.target as HTMLInputElement).value) / 100)
}

// 바깥을 누르면 닫는다. 팝오버 안 클릭은 아래 @click.stop 이 막는다.
function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <div ref="root" class="ribbon-music-wrap">
    <button
      class="ribbon-music"
      :class="{ open, silent }"
      :title="`게임 음악 ${percent}%`"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">
        <path d="M9 17V6l10-2v11" />
        <circle cx="6.5" cy="17.5" r="2.6" /><circle cx="16.5" cy="15.5" r="2.6" />
      </svg>
    </button>

    <div v-if="open" class="music-pop" @click.stop>
      <span class="music-val" :class="{ boost: percent > 50 }">{{ percent }}%</span>
      <input
        class="music-slider"
        type="range"
        min="0"
        max="100"
        step="5"
        :value="percent"
        aria-label="게임 음악 볼륨"
        @input="onInput"
      />
    </div>
  </div>
</template>

<style scoped>
.ribbon-music-wrap { position: relative; display: inline-flex; }
.ribbon-music {
  display: grid;
  width: 34px;
  height: 30px;
  place-items: center;
  border: 2px solid #b78d5d;
  border-radius: 7px;
  background: #fff8e9;
  box-shadow: 2px 2px 0 #e2d0b5;
  color: #74513c;
  cursor: pointer;
}
.ribbon-music:hover { background: #fff0b6; }
.ribbon-music.open { background: #f2d9a8; color: #65432f; box-shadow: 1px 1px 0 #d2af7c; }
/* 꺼짐(0%) 표시 — BgmToggle 과 같은 사선 규약 */
.ribbon-music.silent { position: relative; color: #a94d52; }
.ribbon-music.silent::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 13px;
  width: 22px;
  height: 2.5px;
  background: var(--c-coral);
  transform: rotate(-45deg);
  pointer-events: none;
}

/* 세로 바 — 버튼 아래로 열린다. 폭을 좁게 잡아 리본 왼쪽 끝에서도 잘리지 않는다. */
.music-pop {
  position: absolute;
  z-index: 30;
  top: 34px;
  left: 50%;
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 9px 8px;
  border: 2px solid #b78d5d;
  border-radius: 9px;
  background: #fffdf7;
  box-shadow: 3px 3px 0 rgba(92, 63, 44, .22);
  transform: translateX(-50%);
}
.music-val { color: #6c9b54; font-size: 10px; font-weight: 700; white-space: nowrap; }
/* 기본(50%)을 넘긴 구간은 증폭이라 색을 달리해 되돌릴 기준을 보인다 */
.music-val.boost { color: #c07a3e; }

/*
 * 세로 슬라이더. 브라우저별로 지시자가 달라 셋을 같이 준다.
 *  - writing-mode + direction: rtl — 표준 경로(아래가 0, 위가 최대)
 *  - appearance: slider-vertical — 구형 WebKit·Blink 폴백(Chrome 121에서 제거됨)
 * direction: rtl 이 없으면 위가 0이 되어 조작 방향이 뒤집힌다.
 */
.music-slider {
  writing-mode: vertical-rl;
  direction: rtl;
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  width: 18px;
  height: 88px;
  margin: 0;
  accent-color: #6c9b54;
}
</style>
