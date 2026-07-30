<script setup lang="ts">
/**
 * '몸 끼워 맞추기' 카드 전용 썸네일 — RhythmThumbnail.vue/DrawingThumbnail.vue와 동일한
 * 레이어드 구조. background(민트색 무대 + POSE MATCH 간판 + 실루엣 보드) 위에
 * effect(반짝임, 전면 레이어) → monkey(무대 바닥 위 원숭이) 순으로 얹는다.
 * 평소엔 전부 정지, hover 중에만 둘이 서로 다른 주기/딜레이로 움직인다.
 *
 * effect.png는 반짝임이 캔버스 전체(실측 bbox 94.1% x 89.0%)에 흩뿌려진 전면 레이어라
 * crop하면 반짝임 배치가 뭉개진다 — background와 완전히 동일하게 crop 없이 통으로 쓴다.
 * monkey.png만 알파 bbox(alpha>8 기준 실측 596x657 @ (456,160))로 crop 후 리사이즈했다 —
 * 즉 monkey의 left/top/width는 "crop된 결과물" 기준 좌표이고, height는 auto로 둬
 * crop된 원본 비율(0.907) 그대로 스케일되게 한다.
 */
import background from '@/assets/games/body-thumbnail/background.webp'
import effect from '@/assets/games/body-thumbnail/effect.webp'
import monkey from '@/assets/games/body-thumbnail/monkey.webp'
</script>

<template>
  <div class="bodyfit-thumb">
    <img class="layer bodyfit-background" :src="background" alt="" />
    <img class="layer bodyfit-effect" :src="effect" alt="" />
    <img class="layer bodyfit-monkey" :src="monkey" alt="" />
  </div>
</template>

<style scoped>
/* position:relative + z-index로 별도 스태킹 컨텍스트를 만든다 — 내부 레이어가
   부모(.game-visual)의 .detail-button(z-index:3, 공용 스타일이라 여기선 건드리지 않는다)과
   섞이지 않고 이 박스 전체가 z-index:1 한 덩어리로만 비교돼 버튼이 항상 위에 남는다. */
.bodyfit-thumb {
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
.bodyfit-background {
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
   전면 레이어라 카드 아래쪽에 빈 틈이 생길 수 있는데, 미리 살짝 확대해 여유를 두면
   그 틈이 안 보인다. transition도 이 확대 상태를 기준으로 원위치(hover 해제)한다. */
.bodyfit-effect {
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
 * monkey — 무대 바닥 위, 실루엣 보드 왼쪽.
 * 위치값 산출 근거:
 * - background의 체크무늬 바닥 실측: y 790~925px = 캔버스 높이의 77%~90% 구간.
 *   발 착지 목표는 그 안쪽 87%로 고정.
 * - width%→height% 배율은 crop 비율(596x657)과 .game-visual 종횡비를 합쳐 약 1.68배
 *   (width 25%→높이 42%, 37.5%→62%로 실측 확인된 선형 관계).
 * - 2026-07-30 10% 축소(1.5배 확대판 37.5%→33.75%): 높이 = 33.75×1.68 ≈ 56.7%.
 *   발 착지(87%) 유지 → top = 87 - 56.7 = 30.3%.
 * - 발의 가로 중심(bbox 너비의 52.4%, 확대 전부터 유지해온 40.1%)에 맞춰
 *   left = 40.1 - 0.524×33.75 ≈ 22.4%.
 * - 오른쪽 끝 = 22.4+33.75 = 56.15% — 1.5배 확대판(58%)보다 살짝 안쪽으로 들어와
 *   실루엣 보드와의 겹침이 조금 줄었지만, 여전히 보드 구간(약 52~74%)에 걸치므로
 *   눈으로 확인 후 추가 조정 필요.
 */
.bodyfit-monkey {
  z-index: 3;
  left: 22.4%;
  top: 30.3%;
  width: 33.75%;
  height: auto;
}

/*
 * hover 애니메이션. RhythmThumbnail.vue/DrawingThumbnail.vue와 동일한 감지 구조(부모
 * .game-card의 hover/focus를 자식 레이어가 받음)를 그대로 재사용한다.
 *
 * ⚠️ 선택자 "일부"만 :global()로 감싸면 빌드 시 그 부분이 통째로 사라지는 버그가 있다
 * (RhythmThumbnail.vue 주석에 최초 기록). 여기서도 선택자 전체를 :global()로 감싼다.
 *
 * animation은 이 hover 규칙 안에서만 선언한다 — 평소(비-hover)에는 이 속성 자체가
 * 존재하지 않으므로 절대 재생되지 않는다. hover가 끝나면 animation이 사라지면서
 * transition이 자연스럽게 원위치(= effect는 scale(1.04))로 돌려놓는다.
 */
:global(.game-card:hover .bodyfit-monkey),
:global(.game-card:focus-visible .bodyfit-monkey) {
  animation: bodyfit-monkey-float 850ms ease-in-out infinite;
  animation-delay: 0ms;
}
:global(.game-card:hover .bodyfit-effect),
:global(.game-card:focus-visible .bodyfit-effect) {
  animation: bodyfit-effect-shimmer 1200ms ease-in-out infinite;
  animation-delay: 200ms;
}

@keyframes bodyfit-monkey-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
/* baseline scale(1.04)을 0%/100%에도 유지한 채 translateY·opacity만 오간다 —
   그래야 전면 레이어가 아래쪽에 빈 틈을 만들지 않는다(위 .bodyfit-effect 주석 참고). */
@keyframes bodyfit-effect-shimmer {
  0%, 100% { transform: scale(1.04) translateY(0); opacity: 1; }
  50% { transform: scale(1.04) translateY(-5px); opacity: 0.85; }
}

@media (prefers-reduced-motion: reduce) {
  .bodyfit-monkey,
  .bodyfit-effect {
    transition: none;
  }
  :global(.game-card:hover .bodyfit-monkey),
  :global(.game-card:focus-visible .bodyfit-monkey),
  :global(.game-card:hover .bodyfit-effect),
  :global(.game-card:focus-visible .bodyfit-effect) {
    animation: none;
  }
}
</style>
