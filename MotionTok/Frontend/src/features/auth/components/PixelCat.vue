<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

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
    el.style.setProperty('--eye-x', `${dx * 7}px`)
    el.style.setProperty('--eye-y', `${dy * 5}px`)
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
  <div ref="stage" class="cat-stage" aria-hidden="true">
    <img class="layer tail" src="/assets/auth/cat/꼬리.png" alt="" />
    <img class="layer body" src="/assets/auth/cat/몸통.png" alt="" />
    <img class="layer ear ear-left" src="/assets/auth/cat/왼쪽귀.png" alt="" />
    <img class="layer ear ear-right" src="/assets/auth/cat/오른쪽귀.png" alt="" />
    <img class="layer eyes" src="/assets/auth/cat/눈.png" alt="" />
    <img class="layer heart" src="/assets/auth/cat/하트.png" alt="" />
  </div>
</template>

<style scoped>
.cat-stage {
  --eye-x: 0px;
  --eye-y: 0px;
  position: absolute;
  z-index: 0;
  right: -232px;
  bottom: 48px;
  width: 340px;
  aspect-ratio: 1;
  pointer-events: none;
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
  .cat-stage { right: -178px; bottom: 58px; width: 270px; }
}
@media (max-width: 780px) {
  .cat-stage { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tail, .ear, .heart { animation: none; }
  .eyes { transition: none; transform: none; }
}
</style>
