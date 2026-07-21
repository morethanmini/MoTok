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
  <div class="app-shell px-party-bg">
    <AppHeader v-if="header" />

    <img class="page-sticker sticker-left" src="/assets/intro/console.png" alt="" />
    <img class="page-sticker sticker-right" src="/assets/intro/headset.png" alt="" />

    <main class="app-page" :style="{ zoom: String(zoom) }">
      <div v-if="$slots.hero" class="hero" :style="{ maxWidth }">
        <slot name="hero" />
      </div>

      <div class="body" :style="{ maxWidth }">
        <slot />
      </div>

      <header class="bar bottom-bar">
        <button v-if="back" class="back-btn" @click="goBack">←</button>
        <div class="titles">
          <span class="px-kicker">✦ MOTOK PLAYGROUND</span>
          <h1>{{ title }}</h1>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <div class="actions"><slot name="actions" /></div>
      </header>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100%;
  position: relative;
  overflow: hidden;
}
.app-page {
  position: relative;
  z-index: 2;
  padding: 28px clamp(16px, 5vw, 72px) 56px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 1040px;
  min-height: 112px;
  margin: 0 auto 24px;
  padding: 18px 22px;
  border: var(--border);
  border-radius: 21px 21px 15px 21px;
  background: linear-gradient(112deg, rgba(207, 244, 231, .96), rgba(255, 240, 185, .96));
  box-shadow: var(--shadow-lg);
}
.hero {
  margin: 0 auto 24px;
}
.hero :deep(> :first-child) {
  margin-top: 0;
  margin-bottom: 0;
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
.titles h1 { margin: 9px 0 0; font-size: 22px; }
.titles p { margin: 4px 0 0; font-size: 10px; color: var(--c-muted); }
.actions { margin-left: auto; display: flex; gap: 8px; }
.body { margin: 0 auto; }
.bottom-bar { margin-top: 24px; margin-bottom: 0; }
.page-sticker {
  position: fixed;
  z-index: 1;
  width: 112px;
  opacity: .22;
  pointer-events: none;
  filter: saturate(.9);
  animation: px-float 4s steps(4) infinite;
}
.sticker-left { left: -24px; bottom: 7%; transform: rotate(-12deg); }
.sticker-right { right: -27px; top: 26%; transform: rotate(12deg); animation-delay: .7s; }
@media (max-width: 900px) {
  .page-sticker { display: none; }
  .app-page { zoom: 1 !important; }
}
</style>
