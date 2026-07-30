<script setup lang="ts">
// 앱 셸: 라우팅된 화면을 그대로 렌더. 각 화면이 자체 전체화면 레이아웃을 소유합니다.
// 화면 공통 오버레이도 여기서 띄웁니다.
//  - 회원 전용 화면 진입 차단 안내(라우터 가드)
//  - 세션 만료 안내(액세스·리프레시 토큰이 모두 죽어 더 이상 이어갈 수 없을 때)
//  - 계정 정지 안내(관리자 제재로 세션이 끊겼을 때)
//  - 관리자 경고 안내(접근은 유지되지만 읽혀야 제재가 성립한다)
//  - 게스트 회원가입 유도(게임 종료 시)
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import {
  onAccountBlocked,
  onSessionExpired,
  type AccountBlockKind,
  type SessionEndReason,
} from '@/api/authEvents'
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
import { useWarningNotice, currentWarning } from '@/composables/useWarningNotice'
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
// 관리자 경고(-105) — 어느 화면에 있든 떠야 하고, 확인을 눌러야 서버가 전달됐음을 안다.
// 위 단일 세션과 달리 세션을 끊지 않는다 — 경고는 접근을 막지 않는다.
const { acknowledge: acknowledgeWarning } = useWarningNotice()
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

// ── 계정 제재 ────────────────────────────────────────────────
// REST 403(AUTH_ACCOUNT_SUSPENDED·AUTH_ACCOUNT_BANNED)이나 웹소켓 1008 종료 중 먼저 도착한 쪽이 알려 준다.
// 세션 만료와 분리한 이유는 안내 문구다 — 제재된 계정은 "다시 로그인"이 애초에 막혀 있다.
// 기간 정지와 영구 정지도 문구가 갈린다: "기간이 끝나면"은 영구 제재에 거짓말이 된다.
const accountBlocked = ref<AccountBlockKind | null>(null)
let unsubscribeBlocked: (() => void) | undefined

onMounted(() => {
  unsubscribe = onSessionExpired((reason) => {
    if (sessionExpired.value) return // 동시 요청이 함께 실패해도 한 번만 안내
    // 토큰을 지우기 전에 읽어 둔다 — clear() 뒤에는 이용 시간을 알 길이 없다.
    guestMinutes.value = reason === 'guest' ? guestSessionMinutes() : null
    sessionExpired.value = reason
    session.clear()
  })
  unsubscribeBlocked = onAccountBlocked((kind) => {
    // 제재가 세션 만료 안내를 덮어써야 한다 — 사유를 아는 쪽이 정확하다.
    // (세션 만료는 이제 이유를 담는 값이라 null로 지운다)
    sessionExpired.value = null
    if (accountBlocked.value) return
    accountBlocked.value = kind
    session.clear()
  })
})
onUnmounted(() => {
  unsubscribe?.()
  unsubscribeBlocked?.()
})

function confirmSessionExpired() {
  sessionExpired.value = null
  router.replace({ name: RouteName.Auth, query: { mode: 'login' } })
}

function confirmAccountBlocked() {
  accountBlocked.value = null
  router.replace({ name: RouteName.Auth, query: { mode: 'login' } })
}

function guestPromptTo(mode: 'login' | 'signup') {
  closeGuestPrompt()
  router.push({ name: RouteName.Auth, query: { mode } })
}
// 도배 선차단 — 방 채팅(-159, GameRoomView)과 같은 형식·같은 기준(5초 5건)이다.
//
// 다만 방 채팅과 결정적으로 다른 점이 하나 있다. 채팅은 서버의 ChatRateLimiter가 최종 방어선이고
// 클라 가드는 소용없는 프레임을 줄이는 역할이지만, 귓속말에는 아직 서버 가드가 없어
// 지금은 여기가 유일한 방어선이다. 즉 devtools로 직접 발행하면 그대로 뚫린다 —
// 이 가드의 목적은 어디까지나 정상 사용자의 연타 방지이고, 서버 레이트리밋은 별도로 필요하다.
const WHISPER_BURST_MAX = 5
const WHISPER_BURST_WINDOW_MS = 5000
let whisperSentTimes: number[] = []

function sendWhisper(text: string) {
  const now = Date.now()
  whisperSentTimes = whisperSentTimes.filter((ts) => now - ts < WHISPER_BURST_WINDOW_MS)
  if (whisperSentTimes.length >= WHISPER_BURST_MAX) {
    flashWhisper('귓속말을 너무 자주 보냈어요 · 잠시 후 다시 보내 주세요')
    return
  }

  if (!whisper.openWith.value || !whisper.send(whisper.openWith.value, text)) {
    flashWhisper('실시간 연결이 끊겨 있어요. 잠시 후 다시 시도해 주세요')
    return
  }
  // 성공한 발신만 센다 — 미연결로 실패한 시도까지 카운터에 얹으면, 연결이 돌아온 직후
  // 멀쩡한 메시지가 막힌다. 서버 ChatService가 참가 검증 뒤에 세는 것과 같은 이유다(-159).
  whisperSentTimes.push(now)
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

  <!-- 제재 안내 — 남은 기간·사유는 싣지 않는다. 자기 제재 상태를 조회할 경로가 없고(관리자 전용),
       종료 프레임에도 종류만 실려 온다. 확인할 수 없는 값을 지어내지 않는다. -->
  <PixelModal v-if="accountBlocked" @close="confirmAccountBlocked">
    <div class="expired">
      <div class="icon">{{ accountBlocked === 'BANNED' ? '🚫' : '⛔' }}</div>
      <h3>{{ accountBlocked === 'BANNED' ? '계정이 영구 정지되었어요' : '계정이 정지되었어요' }}</h3>
      <p v-if="accountBlocked === 'BANNED'">
        운영 정책 위반으로 이용이 영구 제한되었어요.<br />문의가 있다면 고객센터로 연락해 주세요.
      </p>
      <p v-else>운영 정책 위반으로 이용이 제한되었어요.<br />정지 기간이 끝나면 다시 로그인할 수 있어요.</p>
      <PixelButton variant="primary" block @click="confirmAccountBlocked">확인</PixelButton>
    </div>
  </PixelModal>

  <!-- 경고 안내 — 세션을 끊지 않는다. 확인을 누르면 서버에 전달 완료로 기록되고 다음 경고로 넘어간다 -->
  <PixelModal v-if="currentWarning" @close="acknowledgeWarning">
    <div class="expired">
      <div class="icon">⚠️</div>
      <h3>운영진 경고가 도착했어요</h3>
      <p class="warn-reason">{{ currentWarning.reason }}</p>
      <p>반복되면 이용이 제한될 수 있어요.</p>
      <PixelButton variant="primary" block @click="acknowledgeWarning">확인했어요</PixelButton>
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
/* 경고 문구는 관리자가 쓴 원문이라 눈에 띄게 — 줄바꿈·긴 단어도 넘치지 않게 */
.warn-reason { margin: 0 0 12px !important; padding: 10px 12px; border: 2px dashed var(--c-ink); border-radius: 9px; background: #fff6e0; color: var(--c-ink) !important; font-weight: 700; white-space: pre-wrap; word-break: break-word; text-align: left; }
</style>
