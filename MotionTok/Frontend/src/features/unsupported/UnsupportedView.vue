<script setup lang="ts">
/**
 * 미지원 브라우저/환경 안내 (비기능 요구사항: 기준 데스크톱 Chrome + 웹캠 PC).
 * 라우터 가드나 앱 진입 시 기능 감지 후 이 페이지로 유도할 수 있습니다.
 */
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const router = useRouter()
</script>

<template>
  <main class="page px-dot-bg">
    <PixelCard pad="32px">
      <div class="icon">🖥️</div>
      <h1>이 브라우저에서는 플레이할 수 없어요</h1>
      <p>
        모톡은 <b>웹캠이 연결된 PC의 데스크톱 Chrome 최신 버전</b>을 기준으로 동작합니다.
        모션 인식·화상 통화에 필요한 카메라 접근(WebRTC·getUserMedia)이 지원되는 환경에서 접속해 주세요.
      </p>
      <ul>
        <li>✅ 데스크톱 Chrome (권장)</li>
        <li>✅ 웹캠 연결 · 최소 1280×720 해상도</li>
        <li>🚫 모바일 브라우저는 기본 지원 범위 외</li>
      </ul>
      <PixelButton variant="primary" size="lg" block @click="router.push({ name: RouteName.Start })">
        시작 화면으로
      </PixelButton>
    </PixelCard>
  </main>
</template>

<style scoped>
.page { min-height: 100%; display: grid; place-items: center; padding: 24px; }
.page :deep(.card) { max-width: 460px; text-align: center; }
.icon { font-size: 54px; }
h1 { font-size: 18px; margin: 14px 0 12px; }
p { font-size: 11px; line-height: 1.7; color: #55495a; }
ul { list-style: none; margin: 16px 0; padding: 14px; border: 2px dashed #cbbdca; border-radius: 12px; font-size: 11px; text-align: left; }
ul li { padding: 4px 0; }
</style>
