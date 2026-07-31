<script setup lang="ts">
/**
 * '모션 낚시' 카드 전용 썸네일 — RhythmThumbnail.vue/DrawingThumbnail.vue/BodyFitThumbnail.vue와
 * 동일한 레이어드 구조. background(물가) 위에 effect(반짝임, 전면 레이어) →
 * green_fish/orange_fish(작은 물고기) → pink_fish(큰 물고기) → fishing(낚싯대+줄+찌 일체형)
 * 순으로 얹는다. 평소엔 전부 정지, hover 중에만 요소별로 다른 주기/딜레이로 움직인다.
 *
 * ⚠️ background.png만 원본 비율이 1.333(1448x1086)이고 나머지 에셋·카드 박스(.game-visual)는
 * 전부 약 1.5다. object-fit:cover를 적용하면 배경 세로가 약 13%(위아래 각 6.4%) 잘린다.
 * 아래 위치값은 1.5 비율 초안 기준으로 읽은 값이라, 배경 지형지물(물가·부두·양동이)과의
 * 정렬은 실제 렌더 후 세로값을 미세조정해야 할 수 있다.
 *
 * effect.png는 반짝임이 캔버스 전체(실측 bbox 75.3% x 83.4%)에 흩뿌려진 전면 레이어라
 * crop하면 반짝임 배치가 뭉개진다 — background와 완전히 동일하게 crop 없이 통으로 쓴다.
 * fishing/pink_fish/orange_fish/green_fish는 알파 bbox(alpha>8 기준 실측)로 crop 후
 * 리사이즈했다 — 즉 이 넷의 left/top/width는 "crop된 결과물" 기준 좌표이고, height는
 * auto로 둬 crop된 원본 비율 그대로 스케일되게 한다.
 */
import background from '@/assets/games/fishing-thumbnail/background.webp'
import effect from '@/assets/games/fishing-thumbnail/effect.webp'
import fishing from '@/assets/games/fishing-thumbnail/fishing.webp'
import pinkFish from '@/assets/games/fishing-thumbnail/pink_fish.webp'
import orangeFish from '@/assets/games/fishing-thumbnail/orange_fish.webp'
import greenFish from '@/assets/games/fishing-thumbnail/green_fish.webp'
</script>

<template>
  <div class="fishing-thumb">
    <img class="layer fishing-background" :src="background" alt="" />
    <img class="layer fishing-effect" :src="effect" alt="" />
    <img class="layer fishing-green-fish" :src="greenFish" alt="" />
    <img class="layer fishing-orange-fish" :src="orangeFish" alt="" />
    <img class="layer fishing-pink-fish" :src="pinkFish" alt="" />
    <img class="layer fishing-rod" :src="fishing" alt="" />
  </div>
</template>

<style scoped>
/* position:relative + z-index로 별도 스태킹 컨텍스트를 만든다 — 내부 레이어가
   부모(.game-visual)의 .detail-button(z-index:3, 공용 스타일이라 여기선 건드리지 않는다)과
   섞이지 않고 이 박스 전체가 z-index:1 한 덩어리로만 비교돼 버튼이 항상 위에 남는다. */
.fishing-thumb {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.layer {
  position: absolute;
  pointer-events: none;
  transition: transform 200ms ease-out;
}

/* background — RGB(알파 없음)라 가장자리가 태생적으로 완전 불투명. object-fit:cover는
   어차피 빈틈을 안 만드므로 확대가 필요 없다. hover와 무관하게 완전히 고정.
   비율 불일치(1.333 vs 카드 1.5)로 세로가 일부 잘리는 점은 위 컴포넌트 헤더 주석 참고. */
.fishing-background {
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: none;
}

/* effect — background와 완전히 동일한 배치(전면 레이어, crop 없음).
   baseline에 scale(1.04)를 항상 걸어둔다 — hover 시 translateY로 위아래를 움직이면
   전면 레이어라 카드 가장자리에 빈 틈이 생길 수 있는데, 미리 살짝 확대해 여유를 두면
   그 틈이 안 보인다(BodyFitThumbnail.vue와 동일 처리). */
.fishing-effect {
  z-index: 2;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.04);
}

/*
 * 위치값은 전부 초안 이미지에서 각 요소의 위치를 읽어 퍼센트로 환산한 값이다(1.5 비율 기준).
 * pink_fish만 초안 그대로(left 67%, top 55%)를 쓰면 오른쪽 아래 끝이 98%/90%가 되어
 * .detail-button 영역(x 66.7~95.8%, y 79.2~94.2%)과 정면으로 겹쳐서, left 58%/top 43%로
 * 왼쪽 위로 옮겼다 — 오른쪽 끝 88%, 아래 끝 77.5%로 버튼 상단(79.2%)을 벗어난다.
 * green_fish 오른쪽 끝 63%(<버튼 좌측 66.7%)는 초안 위치 그대로 둬도 버튼과 무관해
 * 조정하지 않았다. fishing(낚싯대)의 산출 근거는 아래 .fishing-rod 옆 주석 참고.
 */
/* green_fish — 2026-07-31 미세조정: 아래로 살짝(top +3%p). 오른쪽 끝(63%)은 변함없이
   버튼 좌측(66.7%)보다 안쪽이라 이 이동으로 새로 생기는 겹침은 없다. */
.fishing-green-fish {
  z-index: 3;
  left: 57%;
  top: 86%;
  width: 6%;
  height: auto;
}
.fishing-orange-fish {
  z-index: 3;
  left: 43%;
  top: 77%;
  width: 10%;
  height: auto;
}
/*
 * pink_fish — 2026-07-31 1.2배 확대(width 30%→36%, 높이 배율 1.15 그대로 적용해
 * 34.5%→41.4%). 원래 안전선은 "아래 끝이 버튼 상단(79.2%)을 벗어난다"였는데(가로는
 * 원래도 88%로 버튼 x범위 안이었지만 세로로 안 겹쳤다), 단순 확대로 left/top을 그대로
 * 두면 아래 끝이 84.4%가 되어 버튼과 겹친다. 그래서 아래 끝을 원래와 같은 77.5%로
 * 유지하도록 top만 보정: top = 77.5 - 41.4 = 36.1%. left(58%)는 그대로 둔다.
 */
.fishing-pink-fish {
  z-index: 4;
  left: 58%;
  top: 36.1%;
  width: 36%;
  height: auto;
}
/*
 * fishing(낚싯대) — 2026-07-31 원복 후 1.2배 확대(width 49%→58.8%, 높이 배율 1.4
 * 그대로 적용해 68.6%→82.32%). 원래 찌 위치(에셋 너비의 약 92% 지점)를 기준으로 뒀다 —
 * 원래(left 11.5%, width 49%) 찌 위치 = 11.5 + 0.92×49 = 56.6%. 단순 확대로 left를
 * 그대로 두면 찌가 65.6%까지 밀려 버튼 좌측(66.7%)에 거의 붙는다. 그래서 찌 위치를
 * 56.6%로 유지하도록 left만 보정: left = 56.6 - 0.92×58.8 = 2.5%. top(5%)은 원복
 * 값 그대로 — 새 아래 끝(5+82.32=87.32%)이 카드 안에 들어와 내릴 필요가 없다.
 * 2026-07-31 미세조정: 오른쪽으로 살짝(left +3%p, 2.5%→5.5%). 찌 위치가 59.6%로
 * 옮겨가지만 여전히 버튼 좌측(66.7%)보다 안쪽이라 여유가 남는다.
 * 추가로 한 번 더(left +3%p, 5.5%→8.5%). 찌 위치 62.6%, 버튼 좌측(66.7%)까지 약
 * 4.1%p 남아 아직 여유 있음 — 더 옮기면 여유가 빠듯해진다.
 */
.fishing-rod {
  z-index: 5;
  left: 8.5%;
  top: 5%;
  width: 58.8%;
  height: auto;
}

/*
 * hover 애니메이션. RhythmThumbnail.vue/DrawingThumbnail.vue/BodyFitThumbnail.vue와
 * 동일한 감지 구조(부모 .game-card의 hover/focus를 자식 레이어가 받음)를 그대로 재사용한다.
 *
 * ⚠️ 선택자 "일부"만 :global()로 감싸면 빌드 시 그 부분이 통째로 사라지는 버그가 있다
 * (RhythmThumbnail.vue 주석에 최초 기록). 여기서도 선택자 전체를 :global()로 감싼다.
 *
 * animation은 이 hover 규칙 안에서만 선언한다 — 평소(비-hover)에는 이 속성 자체가
 * 존재하지 않으므로 절대 재생되지 않는다. hover가 끝나면 animation이 사라지면서
 * transition이 자연스럽게 원위치(= effect는 scale(1.04))로 돌려놓는다.
 * background는 고정 레이어라 hover 애니메이션이 없다.
 */
:global(.game-card:hover .fishing-rod),
:global(.game-card:focus-visible .fishing-rod) {
  animation: fishing-rod-float 1100ms ease-in-out infinite;
  animation-delay: 0ms;
}
:global(.game-card:hover .fishing-pink-fish),
:global(.game-card:focus-visible .fishing-pink-fish) {
  animation: fishing-pink-fish-float 900ms ease-in-out infinite;
  animation-delay: 100ms;
}
:global(.game-card:hover .fishing-effect),
:global(.game-card:focus-visible .fishing-effect) {
  animation: fishing-effect-shimmer 1200ms ease-in-out infinite;
  animation-delay: 200ms;
}
:global(.game-card:hover .fishing-orange-fish),
:global(.game-card:focus-visible .fishing-orange-fish) {
  animation: fishing-orange-fish-float 1000ms ease-in-out infinite;
  animation-delay: 250ms;
}
:global(.game-card:hover .fishing-green-fish),
:global(.game-card:focus-visible .fishing-green-fish) {
  animation: fishing-green-fish-float 1150ms ease-in-out infinite;
  animation-delay: 400ms;
}

/* fishing(낚싯대)만 transform-origin을 왼쪽 위로 둔다 — 줄·찌가 매달린 쪽(오른쪽 아래)이
   흔들리는 느낌을 내려면 회전 축이 반대편(왼쪽 위, 낚싯대를 쥔 손 쪽)에 있어야 한다. */
.fishing-rod {
  transform-origin: top left;
}

@keyframes fishing-rod-float {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-4px) rotate(1deg); }
}
@keyframes fishing-pink-fish-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}
@keyframes fishing-orange-fish-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes fishing-green-fish-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
/* baseline scale(1.04)을 0%/100%에도 유지한 채 translateY·opacity만 오간다 —
   그래야 전면 레이어가 가장자리에 빈 틈을 만들지 않는다(위 .fishing-effect 주석 참고). */
@keyframes fishing-effect-shimmer {
  0%, 100% { transform: scale(1.04) translateY(0); opacity: 1; }
  50% { transform: scale(1.04) translateY(-5px); opacity: 0.85; }
}

@media (prefers-reduced-motion: reduce) {
  .fishing-rod,
  .fishing-pink-fish,
  .fishing-orange-fish,
  .fishing-green-fish,
  .fishing-effect {
    transition: none;
  }
  :global(.game-card:hover .fishing-rod),
  :global(.game-card:focus-visible .fishing-rod),
  :global(.game-card:hover .fishing-pink-fish),
  :global(.game-card:focus-visible .fishing-pink-fish),
  :global(.game-card:hover .fishing-effect),
  :global(.game-card:focus-visible .fishing-effect),
  :global(.game-card:hover .fishing-orange-fish),
  :global(.game-card:focus-visible .fishing-orange-fish),
  :global(.game-card:hover .fishing-green-fish),
  :global(.game-card:focus-visible .fishing-green-fish) {
    animation: none;
  }
}
</style>
