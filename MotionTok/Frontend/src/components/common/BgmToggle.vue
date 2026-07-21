<script setup lang="ts">
/** BGM 켜기/끄기 토글 버튼 (useBgm 싱글턴 구독). */
import { useBgm } from '@/composables/useBgm'

const { isPlaying, toggle } = useBgm()
</script>

<template>
  <button
    class="bgm-toggle"
    :class="{ on: isPlaying }"
    title="배경음악 켜기/끄기"
    @click="toggle"
  >
    {{ isPlaying ? '♫' : '♪' }}
  </button>
</template>

<style scoped>
.bgm-toggle {
  position: relative;
  width: 39px;
  height: 39px;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  background: #fff;
  box-shadow: 3px 3px 0 #d9cbd9;
  font-size: 16px;
}
.bgm-toggle.on {
  background: var(--c-yellow);
  box-shadow: var(--shadow-sm);
}
/* 꺼짐 상태 사선 표시 */
.bgm-toggle:not(.on)::after {
  content: '';
  position: absolute;
  left: 7px;
  top: 18px;
  width: 22px;
  height: 2px;
  background: var(--c-coral);
  transform: rotate(-45deg);
  pointer-events: none;
}
</style>
