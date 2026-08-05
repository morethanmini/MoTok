<script setup lang="ts">
/**
 * '그림으로 말해요' 카드 전용 썸네일 — RhythmThumbnail.vue와 동일한 레이어드 구조.
 * background(숲속 그림판) 위에 crayon(그림판 위 크레용), squirrel(나무 그루터기의
 * 다람쥐), chick(잔디 위 병아리) 레이어를 얹는다. 평소엔 전부 정지, hover 중에만
 * 셋이 서로 다른 주기/딜레이로 둥둥 떠다닌다.
 *
 * squirrel/chick/crayon 원본(1536x1024)은 캔버스 가운데에 내용이 있고 나머지는
 * 투명 여백이라, 배포 전 이미지 최적화 단계에서 알파 bbox(alpha>8 기준)로 crop한 뒤
 * 긴 변 400px로 리사이즈해 WebP로 뽑았다. 즉 아래 left/top/width는 "crop된 결과물"
 * 기준 좌표다 — 원본 캔버스 기준이 아니므로 img에는 별도 object-fit 없이 width만
 * 지정하고 height는 auto로 둬 크롭된 원본 비율 그대로 스케일되게 한다.
 *
 * 위치값은 참고 이미지를 보고 추정한 초기값에서 육안 미세조정을 거쳤다(2026-07-30).
 * chick은 최초 추정값(left 63%)이 .detail-button 영역(대략 x 66.7~95.8%, y 79.2~94.2%
 * — RhythmThumbnail.vue 실측 주석 기준, 공용 .game-visual 구조라 동일)과 겹쳐 left를
 * 당겼고, 이후 크기를 키우는 미세조정에서도 오른쪽 끝(62%)이 버튼 좌측(66.7%)과
 * 겹치지 않도록 left를 함께 조정했다 — 자세한 계산은 각 클래스 옆 주석 참고.
 */
import background from '@/assets/games/drawing-thumbnail/background.webp'
import squirrel from '@/assets/games/drawing-thumbnail/squirrel.webp'
import chick from '@/assets/games/drawing-thumbnail/chick.webp'
import crayon from '@/assets/games/drawing-thumbnail/crayon.webp'
</script>

<template>
  <div class="drawing-thumb">
    <img class="layer drawing-background" :src="background" alt="" />
    <img class="layer drawing-crayon" :src="crayon" alt="" />
    <img class="layer drawing-squirrel" :src="squirrel" alt="" />
    <img class="layer drawing-chick" :src="chick" alt="" />
  </div>
</template>

<style scoped>
/* position:relative + z-index로 별도 스태킹 컨텍스트를 만든다 — 내부 레이어가
   부모(.game-visual)의 .detail-button(z-index:3, 공용 스타일이라 여기선 건드리지 않는다)과
   섞이지 않고 이 박스 전체가 z-index:1 한 덩어리로만 비교돼 버튼이 항상 위에 남는다. */
.drawing-thumb {
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
   어차피 빈틈을 안 만드므로 확대가 필요 없다. hover와 무관하게 완전히 고정. */
.drawing-background {
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: none;
}

/* crayon — 그림판 위, 비행기가 그려진 쪽(오른쪽)을 향하도록 배치. crop된 원본 비율을
   그대로 유지해야 해서 height는 지정하지 않고 width%만 준다(auto 스케일). */
.drawing-crayon {
  z-index: 2;
  left: 62%;
  top: 44%;
  width: 15.5%;
  height: auto;
}

/* squirrel — 왼쪽 하단, 배경의 나무 그루터기 위에 앉은 느낌.
   2026-07-30 재조정: 다람쥐가 그루터기 위에 서 있지 않고 초안보다 작아 보인다는
   피드백으로 실측 기반 재계산.
   - squirrel.webp는 꼬리가 왼쪽으로 커서 에셋 박스 중심 ≠ 몸통(발) 중심이다.
     에셋 하단 8% 구간(발)을 실측하니 발의 가로 중심은 에셋 너비의 63.5% 지점 —
     박스 중심을 그루터기 중심에 맞추면 실제 발은 오른쪽으로 밀려 그루터기를 벗어난다.
   - background.webp의 그루터기 윗면 실측: x 150~415px(중심 18.4%), 앉는 면 높이
     y 805~865px(약 81%).
   - 에셋이 400x381(거의 정사각)이라 width 23%면 높이는 약 33%.
   - 검증(계산치): 발 중심 = left(4%) + 0.635 × width(23%) = 18.6% ≈ 그루터기 중심 18.4%.
     발 높이 = top(49%) + 높이(33%) = 82% ≈ 그루터기 앉는 면 81%.
     오른쪽 끝 = 4 + 23 = 27% — .detail-button(x 66.7%~)과 무관해 안전.
   - 2026-07-30 재조정 #2: 실제로는 다람쥐가 그루터기 위에 떠 보임 — 카드 박스 비율
     (.game-visual 실측 약 1.6:1)이 배경 원본 비율(1536:1024=1.5:1)보다 납작해서,
     width%로 지정한 height:auto 결과가 세로로 계산치보다 짧게 렌더링되기 때문.
     left(4%)·width(23%)는 가로 정렬이 맞으므로 그대로 두고, top만 49%→52%로
     내려 발 위치를 그루터기 앉는 면에 맞춘다. */
.drawing-squirrel {
  z-index: 2;
  left: 4%;
  top: 52%;
  width: 23%;
  height: auto;
}

/* chick — 오른쪽 하단 잔디 위.
   width 9%→14%, left 53%→48% (2026-07-30 육안 미세조정, squirrel과 동일 이유로 확대).
   width만 키우면 오른쪽 끝이 53+14=67%가 되어 .detail-button(x 66.7%~)과 겹치므로,
   left를 48%로 5%p 당겨 오른쪽 끝을 62%로 유지 — 최초 배치 때 확보했던 버튼과의
   여유(약 4.7%p)를 그대로 보존한다. top(71%)은 그대로 두고, 커지며 아래로 자라는
   방향이 초안 속 발 위치(캔버스 기준 y≈92%)에 더 가까워진다. */
.drawing-chick {
  z-index: 3;
  left: 48%;
  top: 71%;
  width: 14%;
  height: auto;
}

/*
 * hover 애니메이션. RhythmThumbnail.vue와 동일한 감지 구조(부모 .game-card의
 * hover/focus를 자식 레이어가 받음)를 그대로 재사용한다.
 *
 * ⚠️ 별따라 손따라 작업 때 선택자 "일부"만 :global()로 감쌌다가 빌드 시 그 부분이 통째로
 * 사라지는 버그를 겪었다(RhythmThumbnail.vue 주석에도 동일 기록). 여기서도 선택자
 * 전체(.game-card:hover .drawing-xxx 전부)를 :global()로 감싼다.
 *
 * animation은 이 hover 규칙 안에서만 선언한다 — 평소(비-hover)에는 이 속성 자체가
 * 존재하지 않으므로 절대 재생되지 않는다. hover가 끝나면 animation이 사라지면서 위
 * .layer의 transition(200ms)이 자연스럽게 원위치로 돌려놓는다. 셋을 0/150/300ms로
 * 시차를 둬 따로 떠다니는 느낌을 낸다.
 */
:global(.game-card:hover .drawing-squirrel),
:global(.game-card:focus-visible .drawing-squirrel) {
  animation: drawing-squirrel-float 900ms ease-in-out infinite;
  animation-delay: 0ms;
}
:global(.game-card:hover .drawing-chick),
:global(.game-card:focus-visible .drawing-chick) {
  animation: drawing-chick-float 800ms ease-in-out infinite;
  animation-delay: 150ms;
}
:global(.game-card:hover .drawing-crayon),
:global(.game-card:focus-visible .drawing-crayon) {
  animation: drawing-crayon-float 1000ms ease-in-out infinite;
  animation-delay: 300ms;
}

@keyframes drawing-squirrel-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes drawing-chick-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes drawing-crayon-float {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-4px) rotate(2deg); }
}

@media (prefers-reduced-motion: reduce) {
  .drawing-squirrel,
  .drawing-chick,
  .drawing-crayon {
    transition: none;
  }
  :global(.game-card:hover .drawing-squirrel),
  :global(.game-card:focus-visible .drawing-squirrel),
  :global(.game-card:hover .drawing-chick),
  :global(.game-card:focus-visible .drawing-chick),
  :global(.game-card:hover .drawing-crayon),
  :global(.game-card:focus-visible .drawing-crayon) {
    animation: none;
  }
}
</style>
