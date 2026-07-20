<script setup lang="ts">
/**
 * Start 화면 좌측 비주얼 — 게임 아이템들이 아래에서 위로 떠오르는 애니메이션.
 * 각 아이템의 크기/위치/속도/이미지는 데이터로 관리 (nth-child 의존 제거 → 순서 바꿔도 안전).
 */
interface FloatItem {
  img: string
  label: string
  size: number
  x: string
  duration: string
  delay: string
  plain?: boolean // 테두리/배경 없는 순수 스티커 (탬버린·게임기)
  bg?: string
}

const items: FloatItem[] = [
  { img: 'constellation', label: '핑거 스타', size: 154, x: '7%', duration: '19s', delay: '-2s' },
  { img: 'tambourine', label: '리듬 펀치', size: 88, x: '48%', duration: '14s', delay: '-12s', plain: true },
  { img: 'fishing-rod', label: '모션 피싱', size: 142, x: '68%', duration: '21s', delay: '-7s' },
  { img: 'sketchbook', label: '드로잉 릴레이', size: 168, x: '24%', duration: '23s', delay: '-16s' },
  { img: 'person', label: '포즈 매치', size: 126, x: '57%', duration: '18s', delay: '-1s' },
  { img: 'console', label: '버블 팝', size: 82, x: '82%', duration: '15s', delay: '-14s', plain: true },
]

const sparks = [
  { img: 'headset', size: 96, x: '36%', duration: '16s', delay: '-4s' },
  { img: 'moon', size: 62, x: '87%', duration: '12s', delay: '-9s' },
  { img: 'trophy', size: 74, x: '4%', duration: '18s', delay: '-7s' },
]

const url = (name: string) => `url('/assets/intro/${name}.png')`
</script>

<template>
  <div class="float-stage">
    <span class="badge">PLAY · MOVE · PARTY</span>

    <article
      v-for="(it, i) in items"
      :key="i"
      class="float-item"
      :class="{ plain: it.plain }"
      :style="{
        '--size': `${it.size}px`,
        '--x': it.x,
        '--duration': it.duration,
        '--delay': it.delay,
        background: it.plain ? (it.bg ?? 'transparent') : undefined,
      }"
    >
      <span class="art" :style="{ backgroundImage: url(it.img) }" />
      <b v-if="!it.plain">{{ it.label }}</b>
    </article>

    <i
      v-for="(s, i) in sparks"
      :key="`s${i}`"
      class="float-spark"
      :style="{
        '--size': `${s.size}px`,
        left: s.x,
        animationDuration: s.duration,
        animationDelay: s.delay,
        backgroundImage: url(s.img),
      }"
    />
  </div>
</template>

<style scoped>
.float-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.badge {
  content: 'PLAY  ·  MOVE  ·  PARTY';
  position: absolute;
  left: 7%;
  top: 7%;
  z-index: 3;
  padding: 9px 13px;
  border: var(--border);
  border-radius: 12px;
  background: var(--c-yellow);
  box-shadow: var(--shadow-md);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
}

.float-item {
  position: absolute;
  left: var(--x);
  bottom: -180px;
  z-index: 2;
  width: var(--size);
  height: calc(var(--size) * 0.82);
  padding-top: 58px;
  border: var(--border-thick);
  border-radius: 20px 20px 15px 20px;
  background-color: rgba(255, 250, 240, 0.92);
  box-shadow: 7px 7px 0 var(--c-ink);
  animation: game-rise var(--duration) linear var(--delay) infinite;
  will-change: transform;
}
.float-item .art {
  position: absolute;
  inset: 7% 0 auto;
  width: 100%;
  height: 62%;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
.float-item b {
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: 9px;
  padding: 5px 4px;
  border: 2px solid var(--c-ink);
  border-radius: 8px;
  background: var(--c-paper);
  text-align: center;
  box-shadow: 2px 2px 0 var(--c-ink);
  font-size: 9px;
  white-space: nowrap;
}
/* 순수 스티커: 테두리/그림자 제거, 이미지가 카드 전체 */
.float-item.plain {
  border: 0;
  box-shadow: none;
  padding: 0;
  border-radius: 50%;
}
.float-item.plain .art {
  inset: 0;
  height: 100%;
}

.float-spark {
  position: absolute;
  bottom: -50px;
  z-index: 1;
  width: var(--size);
  height: var(--size);
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  animation: spark-rise 11s linear infinite;
}

@keyframes game-rise {
  0%   { transform: translateY(0) rotate(-3deg); opacity: 0; }
  7%   { opacity: 1; }
  50%  { transform: translateY(-58vh) rotate(3deg); }
  93%  { opacity: 1; }
  100% { transform: translateY(-125vh) rotate(-3deg); opacity: 0; }
}
@keyframes spark-rise {
  0%   { transform: translateY(0) rotate(0); opacity: 0; }
  12%  { opacity: 1; }
  100% { transform: translateY(-115vh) rotate(220deg); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .float-item,
  .float-spark { animation-play-state: paused; }
}
@media (max-width: 1050px) {
  .float-item { --size: 92px; }
  .badge { font-size: 8px; }
}
</style>
