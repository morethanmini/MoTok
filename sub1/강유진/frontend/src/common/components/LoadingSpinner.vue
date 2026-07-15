<template>
  <div v-if="visible" :class="['loading-spinner-overlay', { 'is-fullscreen': fullscreen }]">
    <div class="loading-spinner"></div>
  </div>
</template>

<script>
export default {
  name: 'LoadingSpinner',

  props: {
    // 스피너 표시 여부
    visible: {
      type: Boolean,
      default: false
    },
    // true면 화면 전체를 덮음(방 목록/상세, 지난 회의 이력 등 페이지 단위 로딩용 - Sub2에서 적용 예정).
    // false(기본)면 가장 가까운 position:relative 부모(다이얼로그 등)를 덮음.
    fullscreen: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style>
.loading-spinner-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
}
.loading-spinner-overlay.is-fullscreen {
  position: fixed;
  z-index: 2000;
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #ccc;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: loading-spinner-spin 0.8s linear infinite;
}
@keyframes loading-spinner-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
