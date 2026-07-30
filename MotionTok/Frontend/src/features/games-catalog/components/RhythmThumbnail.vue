<script setup lang="ts">
/**
 * 리듬게임 카드 전용 썸네일 — background(주황 하늘) 위에 cat(헤드폰 낀 고양이)과
 * music1/2/3(음표 아이콘) 레이어를 얹는다. 평소엔 전부 정지, hover 중에만 cat이 통통
 *튀고 music1→2→3이 살짝 시차를 두고 튀며 커진다("박자를 타는" 느낌).
 *
 * 위치값은 PNG를 직접 디코딩한 실측(alpha>8 기준 solid bbox)에서 역산했다:
 * - cat.png(1536x1024) solid 콘텐츠 x[26.5~70.0%] y[8.6~89.5%]
 * - music1/2/3.png(각 1536x1024) solid 콘텐츠도 각각 실측 후, 화면상 서로 겹치지 않고
 *   .detail-button 영역(대략 x 66.7~95.8%, y 79.2~94.2%)도 침범하지 않도록 배치했다.
 * background.png는 알파 채널이 없는(RGB) 이미지라 애초에 투명 여백이 존재할 수 없다 —
 * 핑거스타 때의 교훈대로 확대 없이 100%로 둔다(확대는 cover의 크롭 폭만 늘린다).
 */
import background from '@/assets/games/rhythm-thumbnail/background.webp'
import cat from '@/assets/games/rhythm-thumbnail/newcat.webp'
import music1 from '@/assets/games/rhythm-thumbnail/music1.webp'
import music2 from '@/assets/games/rhythm-thumbnail/music2.webp'
import music3 from '@/assets/games/rhythm-thumbnail/music3.webp'
</script>

<template>
  <div class="rhythm-thumb">
    <img class="layer rhythm-background" :src="background" alt="" />
    <img class="layer rhythm-note rhythm-note-1" :src="music1" alt="" />
    <img class="layer rhythm-note rhythm-note-2" :src="music2" alt="" />
    <img class="layer rhythm-note rhythm-note-3" :src="music3" alt="" />
    <img class="layer rhythm-cat" :src="cat" alt="" />
  </div>
</template>

<style scoped>
/* position:relative + z-index로 별도 스태킹 컨텍스트를 만든다 — 내부 레이어(1~3)가
   부모(.game-visual)의 .detail-button(z-index:3, 공용 스타일이라 여기선 건드리지 않는다)과
   섞이지 않고 이 박스 전체가 z-index:1 한 덩어리로만 비교돼 버튼이 항상 위에 남는다. */
.rhythm-thumb {
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
   어차피 빈틈을 안 만드므로 확대가 필요 없다(확대하면 cover의 크롭 폭만 늘어난다).
   hover와 무관하게 완전히 고정 — transform 규칙 자체가 없다. */
.rhythm-background {
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: none;
}

/* cat — 박스 비율을 원본 종횡비(1536:1024)에 맞춰 object-fit:contain이 레터박스 없이
   꽉 차게 했다. 왼쪽 하단에 크게(실제 보이는 캐릭터 폭 약 45%), 카드 밖으로 안 잘리게. */
.rhythm-cat {
  z-index: 3;
  left: -23%;
  top: 9%;
  width: 103%;
  height: 96%;
  object-fit: contain;
  object-position: center;
  transform: translateY(0);
}

.rhythm-note {
  z-index: 2;
  object-fit: contain;
  object-position: center;
  transform: translateY(0) scale(1);
}
/*
 * 미세 조정(5차): 셋 다 왼쪽(고양이 방향)으로 5%p 균일 이동. left만 똑같이 -5%p씩 옮기면
 * 셋 사이의 상대 거리(서로 겹치지 않던 관계)는 평행이동이라 그대로 보존되고, 고양이와의
 * 거리만 줄어든다 — 그래서 top/width/height는 4차 값(1.5배 확대 + 재배치) 그대로 두고
 * left만 바꿨다. music1(고양이와 제일 가까움) 기준 콘텐츠 간격이 6.6%p→1.6%p로 줄었다.
 */
.rhythm-note-1 {
  left: 34.5%;
  top: 39.4%;
  width: 52.5%;
  height: 48%;
}
.rhythm-note-2 {
  left: 44.8%;
  top: -7.8%;
  width: 51%;
  height: 46.5%;
}
.rhythm-note-3 {
  left: 54.9%;
  top: 19.5%;
  width: 51.75%;
  height: 47.25%;
}

/*
 * hover 애니메이션. 캐치캐치리듬/핑거스타와 같은 감지 구조(부모 .game-card의 hover/focus를
 * 자식 레이어가 받음)를 그대로 재사용한다.
 *
 * ⚠️ 핑거스타 작업 때 :global(.game-card:hover) .layer-bear 처럼 선택자 "일부"만 :global()로
 * 감쌌다가 빌드 시 .layer-bear 부분이 통째로 사라지는 버그를 겪었다(컴파일된 CSS로 직접 확인).
 * 여기서는 그 교훈대로 선택자 전체(.game-card:hover .rhythm-cat 전부)를 :global()로 감싼다.
 *
 * animation은 이 hover 규칙 안에서만 선언한다 — 평소(비-hover)에는 이 속성 자체가 존재하지
 * 않으므로 절대 재생되지 않는다. hover가 끝나면 animation이 사라지면서 위 .layer의
 * transition(200ms)이 자연스럽게 원위치로 돌려놓는다.
 */
:global(.game-card:hover .rhythm-cat),
:global(.game-card:focus-visible .rhythm-cat) {
  animation: rhythm-cat-bounce 550ms ease-in-out infinite;
}
:global(.game-card:hover .rhythm-note-1),
:global(.game-card:focus-visible .rhythm-note-1) {
  animation: rhythm-note-bounce 550ms ease-in-out infinite;
  animation-delay: 0ms;
}
:global(.game-card:hover .rhythm-note-2),
:global(.game-card:focus-visible .rhythm-note-2) {
  animation: rhythm-note-bounce 550ms ease-in-out infinite;
  animation-delay: 130ms;
}
:global(.game-card:hover .rhythm-note-3),
:global(.game-card:focus-visible .rhythm-note-3) {
  animation: rhythm-note-bounce 550ms ease-in-out infinite;
  animation-delay: 260ms;
}

@keyframes rhythm-cat-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes rhythm-note-bounce {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-4px) scale(1.08); }
}

@media (prefers-reduced-motion: reduce) {
  .rhythm-cat,
  .rhythm-note-1,
  .rhythm-note-2,
  .rhythm-note-3 {
    transition: none;
  }
  :global(.game-card:hover .rhythm-cat),
  :global(.game-card:focus-visible .rhythm-cat),
  :global(.game-card:hover .rhythm-note-1),
  :global(.game-card:focus-visible .rhythm-note-1),
  :global(.game-card:hover .rhythm-note-2),
  :global(.game-card:focus-visible .rhythm-note-2),
  :global(.game-card:hover .rhythm-note-3),
  :global(.game-card:focus-visible .rhythm-note-3) {
    animation: none;
  }
}
</style>
