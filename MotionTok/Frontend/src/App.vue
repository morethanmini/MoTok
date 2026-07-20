<script setup lang="ts">
// 앱 셸: 라우팅된 화면을 그대로 렌더. 각 화면이 자체 전체화면 레이아웃을 소유합니다.
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>
</template>
