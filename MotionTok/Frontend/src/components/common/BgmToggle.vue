<script setup lang="ts">
/** BGM 켜기/끄기 토글 버튼 (useBgm 싱글턴 구독). */
import { useBgm } from '@/composables/useBgm'
import headerBgmNote from '@/assets/header/header-bgm-note.png'

const { isPlaying, toggle } = useBgm()
</script>

<template>
  <button
    class="bgm-toggle"
    :class="{ on: isPlaying }"
    title="배경음악 켜기/끄기"
    @click="toggle"
  >
    <img class="bgm-note" :src="headerBgmNote" alt="" aria-hidden="true" />
    {{ isPlaying ? '♫' : '♪' }}
  </button>
</template>

<style scoped>
.bgm-toggle {
  position: relative;
  display: grid;
  width: 43px;
  height: 39px;
  place-items: center;
  border: 2px solid #d4b17a;
  border-radius: 9px;
  background: #fffdf7;
  box-shadow: 2px 2px 0 #ead8b9;
  font-size: 0;
}
.bgm-toggle.on {
  background: #fff3dc;
  box-shadow: inset 1px 1px 0 rgba(255,255,255,.5), 2px 2px 0 #e0c38d;
}
.bgm-note { position: absolute; inset: 0; width: 16px; height: 16px; margin: auto; object-fit: contain; image-rendering: pixelated; }
/* 꺼짐 상태 사선 표시 */
.bgm-toggle:not(.on)::after {
  content: '';
  position: absolute;
  left: 9px;
  top: 18px;
  width: 24px;
  height: 3px;
  background: var(--c-coral);
  transform: rotate(-45deg);
  pointer-events: none;
}

@media (min-width: 851px) and (max-width: 1120px) {
  .bgm-toggle { width: 38px; height: 35px; }
  .bgm-note { width: 14px; height: 14px; }
  .bgm-toggle:not(.on)::after { left: 8px; top: 16px; width: 22px; }
}
</style>
