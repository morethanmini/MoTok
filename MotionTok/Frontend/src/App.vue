<script setup lang="ts">
// 앱 셸: 라우팅된 화면을 그대로 렌더. 각 화면이 자체 전체화면 레이아웃을 소유합니다.
// 라우터 가드가 회원 전용 화면 진입을 막았을 때의 안내 모달도 여기서 띄웁니다(화면 공통).
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useLoginRequired } from '@/composables/useLoginRequired'
import LoginRequiredModal from '@/components/common/LoginRequiredModal.vue'

const router = useRouter()
const { message: loginRequired, close: closeLoginRequired } = useLoginRequired()

function goLogin() {
  closeLoginRequired()
  router.push({ name: RouteName.Auth, query: { mode: 'login' } })
}
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>

  <LoginRequiredModal
    v-if="loginRequired"
    :message="loginRequired"
    @close="closeLoginRequired"
    @login="goLogin"
  />
</template>
