<script setup lang="ts">
/**
 * 로비 진입 스플래시(로딩) 오버레이.
 * 여기서 모션 인식 모델(MediaPipe)을 <b>모두</b> 미리 받아 세션 싱글턴에 채워 둔다 —
 * 첫 게임 진입이 즉시 시작된다. 손(7.8MB)·포즈(9.4MB) 두 개라 합쳐서 17MB 남짓이다.
 * 로딩바는 실제 다운로드 진행률을 따라가고, 100%에 닿으면 버튼 없이 스스로 로비로 진입한다.
 * (BGM은 useBgm이 첫 사용자 상호작용에서 자동 재생하므로 입장 버튼 제스처가 더는 필요 없다.)
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { MOTION_MODELS } from '@/composables/motionModels'

const emit = defineEmits<{ enter: [] }>()

/** 0~100. 실제 모델 다운로드 진행률 + wasm/GPU 초기화 꼬리를 합친 값. */
const progress = ref(0)
const done = ref(false)
let entered = false
let holdTimer: ReturnType<typeof setTimeout>

function finish() {
  if (entered) return
  entered = true
  progress.value = 100
  done.value = true
  // 바가 100%에 닿은 걸 잠깐 보여 준 뒤 로비로 넘어간다.
  holdTimer = setTimeout(() => emit('enter'), 320)
}

/** 지금 받고 있는 모델 이름 — 17MB라 한 줄짜리 안내만으로는 멈춘 것처럼 보인다. */
const loadingLabel = ref(MOTION_MODELS[0]?.label ?? '')

onMounted(async () => {
  // 순서대로 하나씩 받는다 — 동시에 받으면 대역폭을 나눠 써서 둘 다 늦게 끝난다.
  let completed = 0
  for (const model of MOTION_MODELS) {
    loadingLabel.value = model.label
    // 로딩은 앞으로만 흐르게 한다(네트워크 재측정으로 바가 뒤로 튀지 않도록).
    await model.load((f) => {
      progress.value = Math.max(progress.value, Math.round((completed + f * model.weight) * 100))
    })
    completed += model.weight
    progress.value = Math.max(progress.value, Math.round(completed * 100))
  }
  // 성공이든 실패든 로비로 보낸다 — 로비 자체는 모델이 필요 없고, 모델 오류는 게임 화면이 따로 안내한다.
  finish()
})

onBeforeUnmount(() => clearTimeout(holdTimer))
</script>

<template>
  <div class="splash">
    <div class="splash-bg" />
    <div class="splash-panel">
      <div class="splash-title"><i /> 미니게임 놀이터에 연결 중</div>
      <div class="loading-track">
        <div class="loading-fill" :style="{ width: `${Math.max(progress, 6)}%` }" />
      </div>
      <small>
        {{ done ? '준비 완료! 로비로 이동할게요…' : `${loadingLabel} 모델을 불러오고 있어요… ${progress}%` }}
      </small>
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
  background: url('/assets/motok-v2.png') center / contain no-repeat;
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
  grid-template-columns: 1fr;
  grid-template-rows: auto auto auto;
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
  transition: width 0.2s ease-out;
}
.splash small {
  display: block;
  color: var(--c-muted);
  font-size: 8px;
  grid-column: 1;
  grid-row: 3;
  align-self: end;
}

@keyframes splash-pan {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes panel-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .splash-bg { animation: none; }
  .loading-fill { transition: none; }
}
</style>
