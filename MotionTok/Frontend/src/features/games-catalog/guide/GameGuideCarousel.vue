<script setup lang="ts">
/**
 * 게임 설명 그림을 옆으로 넘겨 보는 캐러셀.
 * 한 장 = 그림 1개 + 한 문장. 글을 읽기 전에 그림으로 먼저 알게 하는 것이 목적이라
 * 문장은 그림의 캡션이지 설명문이 아니다(길어지면 여기가 아니라 그림을 고쳐야 한다).
 *
 * 넘기는 방법은 3가지 — 화살표 버튼, 좌우 스와이프/드래그, 키보드 ←/→.
 * 순환시키지 않는다(마지막에서 처음으로 돌지 않음): 몇 장 남았는지가 진행의 단서라
 * 돌아버리면 끝을 알 수 없다.
 *
 * ## 페이지를 밖에서 쥘 수 있다 (방 안 함께 보기)
 * `page`를 주면 그 값이 진짜 페이지가 되고 내부 상태는 쓰지 않는다(`v-model:page`).
 * 방장이 넘긴 장을 방 전원 화면에 맞추는 데 쓴다 — 참가자 쪽은 `readonly`까지 켜서
 * 넘기는 조작 자체를 막는다(자기 화면만 어긋나게 만들 수 있으면 "함께 보기"가 아니다).
 * 주지 않으면 지금까지대로 스스로 페이지를 들고 있는다(게임 목록 모달).
 */
import { computed, ref, watch } from 'vue'
import type { GuidePage } from './pages'

const props = defineProps<{ pages: GuidePage[]; page?: number; readonly?: boolean }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

/** 밖에서 page를 주지 않을 때만 쓰는 내부 페이지. */
const inner = ref(0)
/** 드래그 중 손가락을 따라가는 거리(px). 놓으면 0으로 돌아간다. */
const dragPx = ref(0)
const dragging = ref(false)

const count = computed(() => props.pages.length)
// 밖에서 온 값도 범위를 다시 잡는다 — 장수가 게임마다 달라서, 5장짜리를 보다 3장짜리로
// 바뀌면 마지막 장 번호가 그대로 넘어와 빈 화면이 된다.
const index = computed(() => clamp(props.page ?? inner.value))
const current = computed(() => props.pages[index.value])

// 다른 게임을 열면 1장부터 — 앞 게임에서 보던 장 번호가 남아 있으면 안 된다.
// (밖에서 쥔 경우는 그쪽이 정하므로 건드리지 않는다)
watch(
  () => props.pages,
  () => {
    inner.value = 0
  },
)

function clamp(n: number) {
  return Math.min(count.value - 1, Math.max(0, n))
}

function go(next: number) {
  if (props.readonly) return
  const target = clamp(next)
  inner.value = target
  emit('update:page', target)
}

/** 이 거리(px)보다 적게 끌면 넘기지 않는다 — 탭이 스와이프로 오인되지 않게. */
const SWIPE_MIN = 42
let startX = 0
let startY = 0
/** 세로로 먼저 움직였으면 페이지 스크롤이므로 그 제스처는 끝까지 무시한다. */
let vertical = false

function onDown(e: PointerEvent) {
  if (props.readonly) return
  // 화살표·점 버튼 위에서 시작한 포인터는 버튼의 것이다.
  if ((e.target as HTMLElement).closest('button')) return
  dragging.value = true
  vertical = false
  startX = e.clientX
  startY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!vertical && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) vertical = true
  if (vertical) return
  // 양 끝에서는 저항을 줘서 "더 없다"를 손으로 알린다.
  const atEdge = (dx > 0 && index.value === 0) || (dx < 0 && index.value === count.value - 1)
  dragPx.value = atEdge ? dx * 0.3 : dx
}

/**
 * 그림의 좌우 이 비율만큼이 "이전/다음" 누름 영역이다. 화살표 버튼만 정확히 눌러야 넘어가면
 * 작은 원을 조준하게 되는데, 넘기는 건 이 컴포넌트에서 가장 자주 하는 동작이다.
 * 가운데를 비워 두는 이유 — 그림을 보려고 누른 것까지 페이지 넘김이 되면 안 된다.
 */
const TAP_ZONE = 0.35

function onUp(e: PointerEvent) {
  if (!dragging.value) return
  const dx = dragPx.value
  dragging.value = false
  dragPx.value = 0
  if (vertical) return
  if (Math.abs(dx) >= SWIPE_MIN) {
    go(index.value + (dx < 0 ? 1 : -1))
    return
  }
  // 끌지 않았으면 누른 것 — 누른 자리가 왼쪽/오른쪽 끝이면 넘긴다.
  // (화살표 버튼 위에서 시작한 포인터는 onDown이 걸러서 여기까지 오지 않는다)
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width) return // 아직 레이아웃이 없으면 어느 쪽인지 판단할 수 없다
  const at = (e.clientX - rect.left) / rect.width
  if (at <= TAP_ZONE) go(index.value - 1)
  else if (at >= 1 - TAP_ZONE) go(index.value + 1)
}

/** 제스처가 취소되면(창 밖으로 나감 등) 넘기지 않고 되돌리기만 한다. */
function onCancel() {
  dragging.value = false
  dragPx.value = 0
}
</script>

<template>
  <section
    class="gg"
    role="group"
    aria-roledescription="설명 슬라이드"
    :aria-label="`게임 설명 ${count}장`"
  >
    <div
      class="gg-stage"
      :class="{ readonly }"
      :tabindex="readonly ? -1 : 0"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @keydown.left.prevent="go(index - 1)"
      @keydown.right.prevent="go(index + 1)"
    >
      <div
        class="gg-track"
        :class="{ grabbing: dragging }"
        :style="{ transform: `translateX(calc(${-index * 100}% + ${dragPx}px))` }"
      >
        <div v-for="(page, i) in pages" :key="i" class="gg-slide" :aria-hidden="i !== index">
          <component :is="page.art" />
        </div>
      </div>

      <!-- 참가자 화면(readonly)에는 조작 자체를 두지 않는다 — 눌러도 안 되는 버튼을
           남겨 두면 "내 화면이 고장 났다"로 읽힌다 -->
      <template v-if="!readonly">
        <button
          type="button"
          class="gg-nav prev"
          aria-label="이전 설명"
          :disabled="index === 0"
          @click="go(index - 1)"
        >
          ‹
        </button>
        <button
          type="button"
          class="gg-nav next"
          aria-label="다음 설명"
          :disabled="index === count - 1"
          @click="go(index + 1)"
        >
          ›
        </button>
      </template>

      <span class="gg-count">{{ index + 1 }} / {{ count }}</span>
    </div>

    <p class="gg-caption" aria-live="polite">
      <b>{{ index + 1 }}</b
      ><span>{{ current?.caption }}</span>
    </p>

    <!-- 참가자 화면에서는 점이 버튼이 아니라 진행 표시다 — 눌러도 안 되는 버튼으로 두면
         자기 화면이 고장 난 줄 안다(화살표를 아예 감추는 것과 같은 이유) -->
    <div class="gg-dots">
      <template v-if="readonly">
        <span v-for="(_, i) in pages" :key="i" class="gg-dot" :class="{ on: i === index }" />
      </template>
      <template v-else>
        <button
          v-for="(page, i) in pages"
          :key="i"
          type="button"
          class="gg-dot"
          :class="{ on: i === index }"
          :aria-label="`${i + 1}번째 설명: ${page.caption}`"
          :aria-current="i === index"
          @click="go(i)"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.gg-stage {
  position: relative;
  overflow: hidden;
  border: 2px solid #d9b77f;
  border-radius: 10px;
  background: #070b1a;
  /* 그림의 viewBox(320:220)와 같은 비율 — 어긋나면 그림이 잘리거나 여백이 생긴다 */
  aspect-ratio: 320 / 220;
  touch-action: pan-y;
  cursor: grab;
}
.gg-stage:focus-visible {
  outline: 3px solid #ffb765;
  outline-offset: 2px;
}
.gg-stage.readonly {
  cursor: default;
}
span.gg-dot {
  cursor: default;
}
.gg-track {
  display: flex;
  height: 100%;
  transition: transform 0.26s ease;
}
.gg-track.grabbing {
  transition: none;
  cursor: grabbing;
}
.gg-slide {
  flex: 0 0 100%;
  height: 100%;
}
.gg-slide :deep(svg) {
  /* 드래그 중 그림이 통째로 선택되어 파랗게 반전되는 것을 막는다 */
  pointer-events: none;
  user-select: none;
}

/* 평소에는 그림만 보이고, 마우스를 올리거나 키보드로 들어오면 화살표가 나타난다.
   더 넘길 곳이 없는 쪽(:disabled)은 올려도 나타나지 않는다 — 첫 장에 "이전"은 없다. */
.gg-nav {
  position: absolute;
  top: 50%;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  transform: translateY(-50%);
  border: 2px solid #986648;
  border-radius: 50%;
  background: #fff8e9;
  color: #704a35;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.gg-stage:hover .gg-nav:not(:disabled),
.gg-stage:focus-within .gg-nav:not(:disabled) {
  opacity: 1;
}
/* 마우스가 없는 기기는 hover가 오지 않는다 — 그쪽에선 늘 보여야 단서가 남는다 */
@media (hover: none) {
  .gg-nav:not(:disabled) {
    opacity: 1;
  }
}
.gg-nav.prev {
  left: 8px;
}
.gg-nav.next {
  right: 8px;
}
.gg-nav:disabled {
  cursor: default;
}
.gg-count {
  position: absolute;
  right: 10px;
  bottom: 8px;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(7, 11, 26, 0.65);
  color: #f4f0ff;
  font-size: 9px;
  font-weight: 700;
}

.gg-caption {
  display: flex;
  gap: 9px;
  align-items: center;
  /* 문장 길이가 달라도 그림이 위아래로 움직이지 않게 두 줄 높이를 잡아 둔다 */
  min-height: 46px;
  margin: 12px 0 0;
  padding: 10px 12px;
  border: 2px solid #dfc391;
  border-radius: 7px;
  background: #fffaf0;
  color: #5c4738;
  font-size: 14px;
  line-height: 1.45;
}
.gg-caption b {
  display: grid;
  flex: none;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: #f0d9a8;
  color: #7a5233;
  font-size: 11px;
}

.gg-dots {
  display: flex;
  gap: 7px;
  justify-content: center;
  margin-top: 11px;
}
.gg-dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border: 2px solid #c9a97c;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition:
    width 0.2s ease,
    background 0.2s ease;
}
.gg-dot.on {
  width: 20px;
  border-radius: 5px;
  background: #c9a97c;
}

@media (prefers-reduced-motion: reduce) {
  .gg-track,
  .gg-dot {
    transition: none;
  }
}
</style>
