<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ shy?: boolean }>()

const stage = ref<HTMLElement>()
let frame = 0

function followPointer(event: PointerEvent) {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const el = stage.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (window.innerWidth * .42)))
    const dy = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height * .42)) / (window.innerHeight * .42)))
    el.style.setProperty('--eye-x', `${dx * 3}px`)
    el.style.setProperty('--eye-y', `${dy * 2}px`)
  })
}

function resetEyes() {
  stage.value?.style.setProperty('--eye-x', '0px')
  stage.value?.style.setProperty('--eye-y', '0px')
}

onMounted(() => {
  window.addEventListener('pointermove', followPointer, { passive: true })
  document.documentElement.addEventListener('mouseleave', resetEyes)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('pointermove', followPointer)
  document.documentElement.removeEventListener('mouseleave', resetEyes)
})
</script>

<template>
  <!--
    cat-mask의 왼쪽 끝은 left:100%로 카드 오른쪽 테두리에 정확히 맞춘다.
    overflow:hidden이 그 경계에서 무조건 잘라주므로, 안쪽 cat-stage의 위치를
    px로 아무리 잘못 잡아도 카드 위로 넘쳐 보일 수 없다 (수동 clip-path 계산 제거).
  -->
  <div class="cat-mask">
    <div ref="stage" class="cat-stage" :class="{ shy }" aria-hidden="true">
      <img class="layer tail" src="/assets/auth/cat/꼬리.png" alt="" />
      <!-- 꼬리만 남기고 나머지(몸통·귀·눈·하트)는 통째로 숨었다 나온다 -->
      <div class="cat-body">
        <img class="layer body" src="/assets/auth/cat/몸통.png" alt="" />
        <img class="layer ear ear-left" src="/assets/auth/cat/왼쪽귀.png" alt="" />
        <img class="layer ear ear-right" src="/assets/auth/cat/오른쪽귀.png" alt="" />
        <img class="layer eyes" src="/assets/auth/cat/눈.png" alt="" />
        <img class="layer heart" src="/assets/auth/cat/하트.png" alt="" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cat-mask {
  position: absolute;
  z-index: -1;
  top: 0;
  bottom: 0;
  /* left:100%는 카드의 padding-box 기준이라 테두리 두께(4px)만큼 카드 안쪽으로
     치우친다. 게다가 카드에는 box-shadow: 9px 9px 0 (검은 픽셀 그림자)가 오른쪽으로
     9px 더 튀어나와 있으므로, 그림자 바깥 끝까지 마스크를 밀어야 꼬리가 그림자
     뒤로 완전히 숨는다. */
  left: calc(100% + 4px + 9px);
  width: 260px;
  overflow: hidden;
  pointer-events: none;
}

.cat-stage {
  --eye-x: 0px;
  --eye-y: 0px;
  position: absolute;
  right: auto;
  left: -121px;
  bottom: 48px;
  width: 340px;
  aspect-ratio: 1;
  filter: drop-shadow(7px 8px 0 rgba(56, 38, 61, .15));
}

.layer {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  transform-origin: center;
}

/*
 * 꼬리를 제외한 몸통 그룹. 평소엔 z-index:2였던 body의 자리를 그대로 차지한다.
 * 숨을 때는 cat-mask(overflow:hidden, 카드 오른쪽 경계에 딱 맞춰진 마스크)의
 * 왼쪽 경계 밖으로 완전히 밀어 넣어서, 이미 검증된 클리핑 경계에 걸려
 * 카드 뒤로 확실히 사라지게 한다 (어중간하게 줄이고 돌리는 방식 대신).
 */
.cat-body {
  position: absolute;
  inset: 0;
  z-index: 2;
  transform: translateX(0);
  /* 다시 나타날 때: 튕기지 않고 바로 제자리로 */
  transition: transform 0.22s ease-out;
}
.cat-stage.shy .cat-body {
  transform: translateX(-320px);
  /* 숨을 때: 재빠르게 훅 */
  transition: transform 0.22s cubic-bezier(0.55, 0, 1, 0.45);
}

.body { z-index: 2; }
.tail {
  z-index: 1;
  transform-origin: 44% 83%;
  animation: tail-sway 2.5s ease-in-out infinite;
}
.ear { z-index: 3; }
.ear-left {
  transform-origin: 47% 28%;
  animation: ear-left-twitch 4.8s ease-in-out infinite;
}
.ear-right {
  transform-origin: 70% 38%;
  animation: ear-right-twitch 5.6s ease-in-out 1.1s infinite;
}
.eyes {
  z-index: 4;
  transform: translate(var(--eye-x), var(--eye-y));
  transition: transform 90ms ease-out;
}
.heart {
  z-index: 5;
  animation: heart-pop 1.8s steps(3) infinite;
}

@keyframes tail-sway {
  0%, 100% { transform: rotate(-4deg); }
  45% { transform: rotate(7deg) translateY(-2px); }
  70% { transform: rotate(3deg); }
}
@keyframes ear-left-twitch {
  0%, 84%, 100% { transform: rotate(0); }
  88% { transform: rotate(-7deg); }
  92% { transform: rotate(4deg); }
  96% { transform: rotate(-3deg); }
}
@keyframes ear-right-twitch {
  0%, 78%, 100% { transform: rotate(0); }
  82% { transform: rotate(7deg); }
  87% { transform: rotate(-4deg); }
  92% { transform: rotate(2deg); }
}
@keyframes heart-pop {
  0%, 100% { transform: translateY(0) scale(1); opacity: .92; }
  50% { transform: translateY(-5px) scale(1.06); opacity: 1; }
}

@media (max-width: 1040px) {
  .cat-mask { width: 200px; }
  .cat-stage { left: -105px; bottom: 58px; width: 270px; }
}
@media (max-width: 780px) {
  .cat-mask { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tail, .ear, .heart { animation: none; }
  .eyes { transition: none; transform: none; }
  .cat-body { transition: none; }
}
</style>
