<script setup lang="ts">
/**
 * 공통 페이지 셸 — 글로벌 헤더(AppHeader) + 페이지 타이틀 바(뒤로가기 + 제목 + actions) + 콘텐츠.
 * 초안 화면들이 일관된 레이아웃 + 화면 간 이동을 갖도록 하는 래퍼입니다.
 */
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import AppHeader from './AppHeader.vue'

withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    maxWidth?: string
    back?: boolean
    /** 글로벌 헤더(브랜드+nav) 표시 여부 */
    header?: boolean
    /** 페이지 전체 배율. 로비 대비 서브 페이지가 작아 보여 기본 1.1로 키움 */
    zoom?: number
  }>(),
  { subtitle: '', maxWidth: '1040px', back: true, header: true, zoom: 1.1 },
)

const router = useRouter()
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push({ name: RouteName.Lobby })
}
</script>

<template>
  <div class="app-shell px-dot-bg">
    <AppHeader v-if="header" />

    <main class="app-page" :style="{ zoom: String(zoom) }">
      <header class="bar">
        <button v-if="back" class="back-btn" @click="goBack">←</button>
        <div class="titles">
          <h1>{{ title }}</h1>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <div class="actions"><slot name="actions" /></div>
      </header>

      <div class="body" :style="{ maxWidth }">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100%;
}
.app-page {
  padding: 24px clamp(16px, 5vw, 72px) 48px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 960px;
  margin: 0 auto 20px;
}
.back-btn {
  width: 44px;
  height: 44px;
  flex: none;
  border: var(--border);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: var(--shadow-sm);
  font-size: 18px;
}
.titles h1 { margin: 0; font-size: 22px; }
.titles p { margin: 4px 0 0; font-size: 10px; color: var(--c-muted); }
.actions { margin-left: auto; display: flex; gap: 8px; }
.body { margin: 0 auto; }
</style>
