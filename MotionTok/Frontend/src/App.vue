<script setup lang="ts">
// 앱 셸: 라우팅된 화면을 그대로 렌더. 각 화면이 자체 전체화면 레이아웃을 소유합니다.
// 화면 공통 오버레이도 여기서 띄웁니다.
//  - 회원 전용 화면 진입 차단 안내(라우터 가드)
//  - 세션 만료 안내(액세스·리프레시 토큰이 모두 죽어 더 이상 이어갈 수 없을 때)
//  - 게스트 회원가입 유도(게임 종료 시)
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { onSessionExpired } from '@/api/authEvents'
import { useLoginRequired } from '@/composables/useLoginRequired'
import { useAccessDenied } from '@/composables/useAccessDenied'
import { useGuestSignupPrompt } from '@/composables/useGuestSignupPrompt'
import { usePresenceHeartbeat } from '@/composables/usePresenceHeartbeat'
import LoginRequiredModal from '@/components/common/LoginRequiredModal.vue'
import GuestSignupPromptModal from '@/components/common/GuestSignupPromptModal.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const router = useRouter()
const session = useSessionStore()
const { message: loginRequired, close: closeLoginRequired } = useLoginRequired()
const { message: accessDenied, close: closeAccessDenied } = useAccessDenied()
const { open: guestPrompt, close: closeGuestPrompt } = useGuestSignupPrompt()

// 접속 상태 하트비트 — 화면과 무관하게 앱 수명 동안 돌아야 하므로 여기서 한 번만 켠다(-57).
usePresenceHeartbeat()

function goLogin() {
  closeLoginRequired()
  router.push({ name: RouteName.Auth, query: { mode: 'login' } })
}

// ── 세션 만료 ────────────────────────────────────────────────
// http.ts가 Refresh까지 실패했을 때 알려 준다. 조용히 튕기면 "왜 로그아웃됐지?"가 되므로
// 안내를 먼저 띄우고, 확인을 누르면 로그인 화면으로 보낸다.
const sessionExpired = ref(false)
let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = onSessionExpired(() => {
    if (sessionExpired.value) return // 동시 요청이 함께 실패해도 한 번만 안내
    sessionExpired.value = true
    session.clear()
  })
})
onUnmounted(() => unsubscribe?.())

function confirmSessionExpired() {
  sessionExpired.value = false
  router.replace({ name: RouteName.Auth, query: { mode: 'login' } })
}

function guestPromptTo(mode: 'login' | 'signup') {
  closeGuestPrompt()
  router.push({ name: RouteName.Auth, query: { mode } })
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

  <GuestSignupPromptModal
    v-if="guestPrompt"
    @close="closeGuestPrompt"
    @signup="guestPromptTo('signup')"
    @login="guestPromptTo('login')"
  />

  <PixelModal v-if="accessDenied" @close="closeAccessDenied">
    <div class="denied">
      <div class="icon">🚫</div>
      <h3>접근 권한이 없어요</h3>
      <p>{{ accessDenied }}</p>
      <PixelButton variant="primary" block @click="closeAccessDenied">확인</PixelButton>
    </div>
  </PixelModal>

  <PixelModal v-if="sessionExpired" @close="confirmSessionExpired">
    <div class="expired">
      <div class="icon">⏰</div>
      <h3>세션이 만료되었어요</h3>
      <p>로그인 후 시간이 오래 지나 자동으로 로그아웃되었어요.<br />다시 로그인해 주세요.</p>
      <PixelButton variant="primary" block @click="confirmSessionExpired">로그인하러 가기</PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
.expired, .denied { text-align: center; }
.expired .icon, .denied .icon { font-size: 40px; }
.expired h3, .denied h3 { margin: 10px 0 8px; font-size: 16px; }
.expired p, .denied p { margin: 0 0 20px; font-size: 12px; color: var(--c-muted); line-height: 1.7; }
</style>
