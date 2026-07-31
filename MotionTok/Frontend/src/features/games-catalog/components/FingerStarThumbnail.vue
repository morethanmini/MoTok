<script setup lang="ts">
/**
 * 핑거 스타 카드 썸네일 — 레이어형. hover 중에만 곰이 손을 흔들고 고개를 갸웃하며
 * 별자리 별이 제자리에서 돈다.
 *
 * 좌표계: .fs-scene 이 배경 비율(1224:962)을 유지하는 내부 박스이고 아래 모든 %는 그 기준이다.
 * 배경에 object-fit:cover 를 쓰면 이미지 내부 좌표와 컨테이너 % 가 어긋나 레이어가 밀린다.
 *
 * 별 위치(--fs-x/--fs-y)는 배경의 금색 연결선을 실제로 추출해 호길이 균등 분할한 값이다.
 * 눈대중이 아니므로 배경을 다시 그리면 다시 뽑아야 한다.
 */
const BG = '/assets/games/finger-star/navy_background_no_stars.webp'
const BODY = '/assets/games/finger-star/bear_body.webp'
const ARM_R = '/assets/games/finger-star/bear_arm_r.webp'
const ARM_L = '/assets/games/finger-star/bear_arm_l.webp'
const HEAD = '/assets/games/finger-star/bear_head.webp'
const STAR_A = '/assets/games/finger-star/golden-star-extra-1.webp'
const STAR_B = '/assets/games/finger-star/golden-star-extra-2.webp'

const STARS = [
  // 연결선 위 — 아래로 갈수록 작고, 곰이 잡으려는 끝이 가장 크다
  { x: 12.83, y: 81.19, size: 4.8, spin: 4200, rev: false },
  { x: 24.76, y: 71.38, size: 5.52, spin: 3100, rev: true },
  { x: 38.19, y: 70.22, size: 6.24, spin: 5300, rev: false },
  { x: 50.15, y: 60.44, size: 6.96, spin: 2700, rev: true },
  { x: 60.59, y: 48.58, size: 7.68, spin: 4700, rev: false },
  { x: 66.26, y: 32.17, size: 8.4, spin: 3500, rev: true },
  // 배경 — 빈 하늘(46px 창의 최대 밝기 < 100)에서 골랐다. 선·별·곰과 겹치지 않는다
  { x: 20.59, y: 37.63, size: 5.4, spin: 5900, rev: true },
  { x: 39.22, y: 25.16, size: 4.4, spin: 3000, rev: false },
  { x: 59.8, y: 23.91, size: 4.8, spin: 6200, rev: true },
]
</script>

<template>
  <div class="fs-thumb">
    <div class="fs-scene">
      <img class="fs-bg" :src="BG" alt="" />

      <span
        v-for="(s, i) in STARS"
        :key="i"
        class="fs-star"
        :style="{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}%` }"
      >
        <img
          :class="s.rev ? 'fs-spin-rev' : 'fs-spin'"
          :style="{ animationDuration: `${s.spin}ms` }"
          :src="i % 2 ? STAR_B : STAR_A"
          alt=""
        />
      </span>

      <img class="fs-bear fs-body" :src="BODY" alt="" />
      <img class="fs-bear fs-arm-r" :src="ARM_R" alt="" />
      <img class="fs-bear fs-arm-l" :src="ARM_L" alt="" />
      <img class="fs-bear fs-head" :src="HEAD" alt="" />
    </div>
  </div>
</template>

<style scoped>
/* z-index 로 스태킹 컨텍스트를 만들어 부모의 .detail-button(z-index:3)이 위에 남게 한다 */
.fs-thumb {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
/* 카드가 이 비율보다 항상 납작해서 폭이 기준이 되고 위아래가 잘린다 */
.fs-scene {
  position: absolute;
  left: 0;
  top: 50%;
  width: 100%;
  aspect-ratio: 1224 / 962;
  transform: translateY(-50%);
}
.fs-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 곰 4장은 같은 683x813 캔버스라 같은 박스에 겹치면 정렬된다.
   배치값은 완성본과 레이어 캔버스의 곰 bbox 를 각각 실측해 역산했다. */
.fs-bear {
  position: absolute;
  left: 64.33%;
  top: 31.04%;
  width: 32.7%;
  height: 49.53%;
}
.fs-body { z-index: 3; }
.fs-arm-r { z-index: 4; }
.fs-arm-l {
  z-index: 5;
  /* 어깨(콘텐츠 bbox 우하단)를 중심으로 — 여기가 아니면 팔이 통째로 떠서 흔들린다 */
  transform-origin: 37% 63%;
  transition: transform 220ms ease-out;
}
.fs-head {
  z-index: 6;
  /* 목(머리 아래쪽, 몸통과 겹치는 지점) — 위로 잡으면 머리가 떠 보인다 */
  transform-origin: 55% 56%;
  transition: transform 260ms ease-out;
}

/* 별 — 바깥 span 이 자리를 잡고(translate) 안쪽 img 가 돈다.
   한 요소에서 translate 와 회전을 합치면 애니메이션이 translate 를 덮어써 별이 튄다. */
.fs-star {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -50%);
}
.fs-star img {
  display: block;
  width: 100%;
  transition: transform 220ms ease-out;
}

/* ⚠ 선택자 전체를 :global() 로 감싼다 — 일부만 감싸면 빌드에서 규칙이 통째로 사라진다
   (RhythmThumbnail 주석의 .layer-bear 사례). animation 은 hover 규칙 안에서만 선언해
   평소에는 속성 자체가 없게 한다. 주기는 인라인 animationDuration 이 별마다 정한다. */
:global(.game-card:hover .fs-arm-l),
:global(.game-card:focus-visible .fs-arm-l) {
  animation: fs-wave 900ms ease-in-out infinite;
}
:global(.game-card:hover .fs-head),
:global(.game-card:focus-visible .fs-head) {
  animation: fs-tilt 1800ms ease-in-out infinite;
}
:global(.game-card:hover .fs-star .fs-spin),
:global(.game-card:focus-visible .fs-star .fs-spin) {
  animation-name: fs-spin;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
:global(.game-card:hover .fs-star .fs-spin-rev),
:global(.game-card:focus-visible .fs-star .fs-spin-rev) {
  animation-name: fs-spin-rev;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes fs-wave {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-12deg); }
  75% { transform: rotate(12deg); }
}
@keyframes fs-tilt {
  0%, 100% { transform: rotate(0deg) translateY(0); }
  30% { transform: rotate(-3.5deg) translateY(-0.6%); }
  70% { transform: rotate(3deg) translateY(0.3%); }
}
@keyframes fs-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes fs-spin-rev {
  from { transform: rotate(0deg); }
  to { transform: rotate(-360deg); }
}

/* 별을 끄는 선택자는 위 회전 규칙과 클래스 수를 맞춰야 한다 —
   .fs-star img 로 쓰면 명시도가 낮아 animation-name 이 그대로 살아 계속 돈다. */
@media (prefers-reduced-motion: reduce) {
  .fs-arm-l, .fs-head, .fs-star img { transition: none; }
  :global(.game-card:hover .fs-arm-l),
  :global(.game-card:focus-visible .fs-arm-l),
  :global(.game-card:hover .fs-head),
  :global(.game-card:focus-visible .fs-head),
  :global(.game-card:hover .fs-star .fs-spin),
  :global(.game-card:focus-visible .fs-star .fs-spin),
  :global(.game-card:hover .fs-star .fs-spin-rev),
  :global(.game-card:focus-visible .fs-star .fs-spin-rev) {
    animation: none;
  }
}
</style>
