<script setup lang="ts">
// 앱 셸: 라우팅된 화면을 그대로 렌더. 각 화면이 자체 전체화면 레이아웃을 소유합니다.
// 화면 공통 오버레이도 여기서 띄웁니다.
//  - 회원 전용 화면 진입 차단 안내(라우터 가드)
//  - 세션 만료 안내(액세스·리프레시 토큰이 모두 죽어 더 이상 이어갈 수 없을 때)
//  - 게스트 회원가입 유도(게임 종료 시)
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { onSessionExpired, type SessionEndReason } from '@/api/authEvents'
import { guestSessionMinutes } from '@/api/token'
import { useLoginRequired } from '@/composables/useLoginRequired'
import { useAccessDenied } from '@/composables/useAccessDenied'
import { useGuestSignupPrompt } from '@/composables/useGuestSignupPrompt'
import { usePresenceHeartbeat } from '@/composables/usePresenceHeartbeat'
import { useGlobalStomp } from '@/composables/useGlobalStomp'
import { useSessionDisplaced } from '@/composables/useSessionDisplaced'
import LoginRequiredModal from '@/components/common/LoginRequiredModal.vue'
import GuestSignupPromptModal from '@/components/common/GuestSignupPromptModal.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useWhisper } from '@/composables/useWhisper'
import { stompConnected } from '@/composables/useGlobalStomp'
import WhisperModal from '@/components/common/WhisperModal.vue'
import { useToast } from '@/composables/useToast'
import { loadRemoteWordlist } from '@/utils/profanity'

const router = useRouter()
const session = useSessionStore()
const { message: loginRequired, close: closeLoginRequired } = useLoginRequired()
const { message: accessDenied, close: closeAccessDenied } = useAccessDenied()
const { open: guestPrompt, close: closeGuestPrompt } = useGuestSignupPrompt()

// 전역 STOMP 연결 — 회원 세션이 서면 열고 사라지면 끊는다(-142).
// 하트비트·친구 상태·로비 방 목록·초대·귓속말이 전부 이 연결 하나를 나눠 쓴다.
useGlobalStomp()
// 접속 상태 하트비트 — 화면과 무관하게 앱 수명 동안 돌아야 하므로 여기서 한 번만 켠다(-57).
usePresenceHeartbeat()
// 단일 세션 — 다른 곳에서 로그인하면 이 세션이 밀려난다. 게임 중에도 떠야 해서 앱 셸이 맡는다.
useSessionDisplaced()
// 비속어 사전 서버 정본(-152) — 가입 폼(비로그인)에서도 쓰이므로 앱 시작 시 한 번 받아 둔다.
// 몇 KB짜리 공개 GET이고 실패해도 번들 내장본으로 동작하므로 기다리지 않는다.
void loadRemoteWordlist()

/**
 * 귓속말 도착 알림(-150) — 어느 화면에 있든 떠야 하므로 앱 셸이 맡는다.
 *
 * 대화창을 열어 둔 상대의 말은 이미 화면에 보이므로 알리지 않는다(useWhisper가 걸러 준다).
 * 본문을 그대로 싣되 길면 잘라서 — 알림은 "누가 말을 걸었다"를 알리는 것이지 읽는 자리가 아니다.
 */
const whisper = useWhisper()
const { message: whisperToast, flash: flashWhisper } = useToast(4000)
watch(whisper.incoming, (msg) => {
  if (!msg) return
  const preview = msg.text.length > 24 ? `${msg.text.slice(0, 24)}…` : msg.text
  flashWhisper(`💬 ${msg.senderNickname}: ${preview}`)
  whisper.clearIncoming()
})

function goLogin() {
  closeLoginRequired()
  router.push({ name: RouteName.Auth, query: { mode: 'login' } })
}

// ── 세션 만료 ────────────────────────────────────────────────
// 회원은 Refresh까지 실패했을 때(http.ts), 게스트는 갱신 수단이 없어 액세스 토큰이
// 만료됐을 때(refreshScheduler) 알려 준다. 조용히 튕기면 "왜 갑자기 안 되지?"가 되므로
// 안내를 먼저 띄우고, 확인을 누르면 로그인 화면으로 보낸다.
// 게스트에게는 같은 자리에서 회원 전환을 권한다 — 만료가 곧 가입을 이야기할 기회다.
const sessionExpired = ref<SessionEndReason | null>(null)
/** 게스트 이용 시간(분). 토큰에서 읽으므로 서버 설정이 바뀌면 문구도 따라간다. */
const guestMinutes = ref<number | null>(null)
let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = onSessionExpired((reason) => {
    if (sessionExpired.value) return // 동시 요청이 함께 실패해도 한 번만 안내
    // 토큰을 지우기 전에 읽어 둔다 — clear() 뒤에는 이용 시간을 알 길이 없다.
    guestMinutes.value = reason === 'guest' ? guestSessionMinutes() : null
    sessionExpired.value = reason
    session.clear()
  })
})
onUnmounted(() => unsubscribe?.())

function confirmSessionExpired() {
  sessionExpired.value = null
  router.replace({ name: RouteName.Auth, query: { mode: 'login' } })
}

function guestPromptTo(mode: 'login' | 'signup') {
  closeGuestPrompt()
  router.push({ name: RouteName.Auth, query: { mode } })
}
function sendWhisper(text: string) {
  if (!whisper.openWith.value || !whisper.send(whisper.openWith.value, text)) {
    flashWhisper('실시간 연결이 끊겨 있어요. 잠시 후 다시 시도해 주세요')
  }
}
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>

  <PixelToast :message="whisperToast" />

  <WhisperModal
    v-if="whisper.openWith.value"
    :nickname="whisper.openNickname.value"
    :messages="whisper.messagesWith(whisper.openWith.value)"
    :connected="stompConnected"
    @close="whisper.close"
    @send="sendWhisper"
  />

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
    <div v-if="sessionExpired === 'guest'" class="expired">
      <div class="icon">🎮</div>
      <h3>게스트 시간{{ guestMinutes ? `(${guestMinutes}분)` : '' }}이 만료되었어요!</h3>
      <p>로그인하고 다양한 사람들과<br />더 많은 게임을 즐겨보세요.</p>
      <PixelButton variant="primary" block @click="confirmSessionExpired">로그인하러 가기</PixelButton>
    </div>
    <div v-else-if="sessionExpired === 'displaced'" class="expired">
      <div class="icon">🔑</div>
      <h3>다른 곳에서 로그인했어요</h3>
      <p>
        같은 계정으로 새로 로그인해서 이 화면의 연결이 끊어졌어요.<br />
        본인이 아니라면 비밀번호를 바꿔 주세요.
      </p>
      <PixelButton variant="primary" block @click="confirmSessionExpired">로그인하러 가기</PixelButton>
    </div>
    <div v-else class="expired">
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
