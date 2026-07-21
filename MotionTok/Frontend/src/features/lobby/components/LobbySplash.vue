<script setup lang="ts">
/**
 * 로비 진입 스플래시(로딩) 오버레이.
 * 로딩바가 채워지면 입장 버튼 활성화 → 클릭 시 enter (이 사용자 제스처로 BGM 재생 시작).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PixelButton from '@/components/common/PixelButton.vue'

const emit = defineEmits<{ enter: [] }>()

const loading = ref(true)
let timer: ReturnType<typeof setTimeout>

onMounted(() => {
  timer = setTimeout(() => (loading.value = false), 900)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="splash">
    <div class="splash-bg" />
    <div class="splash-panel">
      <div class="splash-title"><i /> 미니게임 놀이터에 연결 중</div>
      <div class="loading-track"><div class="loading-fill" /></div>
      <small>{{ loading ? '별과 게임을 불러오고 있어요…' : '준비 완료! 친구들이 기다리고 있어요.' }}</small>
      <PixelButton
        class="enter-btn"
        variant="yellow"
        :disabled="loading"
        @click="emit('enter')"
      >
        {{ loading ? 'LOADING…' : '▶ 메인 로비 입장' }}
      </PixelButton>
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 18px 18px;
  background: #fff4d7;
  overflow: hidden;
}
.splash-bg {
  position: absolute;
  inset: 0 0 122px;
  background: url('/assets/motok-v1.png') center / contain no-repeat;
  animation: splash-pan 5s steps(10) infinite;
}
.splash::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 126px;
  z-index: 2;
  background: linear-gradient(180deg, rgba(255, 244, 215, 0), #fff4d7 18%, #fff4d7 100%);
  border-top: 3px solid rgba(56, 38, 61, 0.14);
}
.splash-panel {
  position: relative;
  z-index: 5;
  width: min(720px, 88vw);
  height: 108px;
  padding: 11px 16px 12px;
  border: var(--border);
  border-radius: 17px 17px 13px 17px;
  background: var(--c-paper);
  box-shadow: var(--shadow-lg);
  display: grid;
  grid-template-columns: 1fr 210px;
  grid-template-rows: auto auto auto;
  column-gap: 17px;
  align-items: center;
  animation: panel-rise 0.3s steps(4) both;
}
.splash-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  font-weight: 700;
  grid-column: 1;
  grid-row: 1;
}
.splash-title i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c-mint);
  animation: px-blink 1s steps(2) infinite;
}
.loading-track {
  height: 17px;
  margin: 5px 0 0;
  padding: 3px;
  border: var(--border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  grid-column: 1;
  grid-row: 2;
}
.loading-fill {
  height: 100%;
  border-radius: 3px;
  background: repeating-linear-gradient(90deg, var(--c-mint) 0 18px, #73d8bd 18px 22px);
  animation: loadbar 0.85s steps(7) forwards;
}
.splash small {
  display: block;
  color: var(--c-muted);
  font-size: 8px;
  grid-column: 1;
  grid-row: 3;
  align-self: end;
}
.enter-btn {
  grid-column: 2;
  grid-row: 1 / 4;
  width: 100%;
  height: 48px;
}

@keyframes splash-pan {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes loadbar {
  from { width: 8%; }
  to { width: 100%; }
}
@keyframes panel-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .splash-bg, .loading-fill { animation: none; }
  .loading-fill { width: 100%; }
}
</style>
