<script setup lang="ts">
/**
 * 픽셀 모달 오버레이. 배경 클릭 시 close 이벤트, 내부 클릭은 전파 차단.
 * <PixelModal @close="..."> ...내용... </PixelModal>
 *
 * 떠 있는 동안 뒤 페이지는 스크롤되지 않는다. 여기 한 곳에서 잠그면 이 컴포넌트를 쓰는
 * 모든 팝업에 적용된다 — 화면마다 따로 걸면 새로 만든 팝업에서 빠뜨리게 된다.
 */
import { useScrollLock } from '@/composables/useScrollLock'

withDefaults(defineProps<{ variant?: 'default' | 'lobby' }>(), { variant: 'default' })
defineEmits<{ close: [] }>()

useScrollLock()
</script>

<template>
  <div class="modal-wrap" @click="$emit('close')">
    <div class="modal" :class="variant" @click.stop>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-wrap {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(56, 38, 61, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * 뒤 페이지를 잠그는 대신 오버레이가 스크롤을 받는다. 낮은 창에서 내용이 화면보다 길면
   * 뒤 스크롤이 막힌 채로는 넘치는 부분에 닿을 방법이 없어진다.
   * 가운데 정렬은 .modal의 margin:auto가 맡는다 — align-items:center로만 두면 넘칠 때
   * 위쪽이 잘려 나가 스크롤해도 못 본다.
   */
  overflow-y: auto;
  /* 배경은 즉시 표시 (애니메이션 없음) */
}
.modal {
  margin: auto;
  width: 390px;
  max-width: 92vw;
  padding: 24px;
  border: var(--border-thick);
  border-radius: var(--radius-xl);
  background: var(--c-paper);
  box-shadow: var(--shadow-xl);
  /* 창만 팝업 애니메이션 */
  animation: px-pop 0.16s ease;
}
.modal.lobby {
  width: 430px;
  padding: 30px;
  border: 3px solid #d9b77f;
  border-radius: 16px;
  background: #fffdf7;
  box-shadow: 5px 5px 0 #dfcdb0;
}
</style>
