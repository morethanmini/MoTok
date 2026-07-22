<script setup lang="ts">
/** 로그인 / 회원가입 화면 — 기본은 로그인, 하단 링크로 회원가입 전환. ?mode 쿼리로 초기 모드 결정. */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import { authApi as recoveryApi } from '@/api'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelCat from './components/PixelCat.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

type Mode = 'login' | 'signup'
const mode = ref<Mode>(route.query.mode === 'signup' ? 'signup' : 'login')
const isSignup = computed(() => mode.value === 'signup')

const email = ref('')
const password = ref('')
const nickname = ref('')
const passwordConfirm = ref('')

// 이메일 인증
const emailCode = ref('')
const emailSent = ref(false)
const emailVerified = ref(false)
const emailFormatError = ref(false)
const emailShake = ref(false)
const codeError = ref(false)
const codeShake = ref(false)
/** 이메일/인증번호 영역에 띄울 서버 오류 문구 */
const emailErrorMsg = ref('')
const codeErrorMsg = ref('')
/** 인증 완료 증명 토큰 — 가입 요청에 실어 보내면 서버가 1회 소비한다 */
const verificationToken = ref('')
const sendingCode = ref(false)
const verifyingCode = ref(false)
let shakeTimer: ReturnType<typeof setTimeout> | undefined
let codeShakeTimer: ReturnType<typeof setTimeout> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined

// 인증코드 5분 카운트다운
const codeTimeLeft = ref(0)
const codeDisplay = computed(() => {
  const m = Math.floor(codeTimeLeft.value / 60)
  const s = codeTimeLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

function startCountdown() {
  clearInterval(countdownTimer)
  codeTimeLeft.value = 300
  countdownTimer = setInterval(() => {
    if (codeTimeLeft.value <= 0) {
      clearInterval(countdownTimer)
      return
    }
    codeTimeLeft.value -= 1
  }, 1000)
}

onUnmounted(() => {
  clearInterval(countdownTimer)
  clearTimeout(shakeTimer)
  clearTimeout(codeShakeTimer)
})

/** 이메일 입력칸을 흔들며 오류 표시 */
function shakeEmail() {
  emailShake.value = false
  nextTick(() => {
    emailShake.value = true
  })
  clearTimeout(shakeTimer)
  shakeTimer = setTimeout(() => {
    emailShake.value = false
  }, 500)
}

/** 인증번호 입력칸을 흔들며 오류 표시 */
function shakeCode() {
  codeShake.value = false
  nextTick(() => {
    codeShake.value = true
  })
  clearTimeout(codeShakeTimer)
  codeShakeTimer = setTimeout(() => {
    codeShake.value = false
  }, 500)
}

/**
 * 인증번호 발송. 서버가 이메일 중복을 먼저 검사하므로,
 * 이미 가입된 이메일이면 메일이 나가지 않고 409로 거절된다.
 */
async function sendEmailCode() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    emailFormatError.value = true
    emailErrorMsg.value = ''
    shakeEmail()
    return
  }
  emailFormatError.value = false
  emailErrorMsg.value = ''
  codeError.value = false
  codeErrorMsg.value = ''
  emailCode.value = ''
  sendingCode.value = true
  try {
    await authApi.sendEmailVerificationCode(email.value.trim())
    emailSent.value = true
    startCountdown()
  } catch (e) {
    emailErrorMsg.value = messageFor(e, {
      AUTH_EMAIL_ALREADY_REGISTERED: '이미 가입된 이메일입니다.',
      AUTH_RESEND_COOLDOWN: '잠시 후 다시 요청해 주세요.',
      AUTH_SEND_LIMIT_EXCEEDED: '하루 인증번호 발송 한도를 초과했습니다.',
    })
    shakeEmail()
  } finally {
    sendingCode.value = false
  }
}

/** 인증번호 검증 — 성공 시 가입에 쓸 verificationToken을 받아 보관한다. */
async function verifyEmailCode() {
  const code = emailCode.value.trim()
  if (!/^\d{6}$/.test(code)) {
    codeError.value = true
    codeErrorMsg.value = '인증번호는 6자리 숫자입니다.'
    shakeCode()
    return
  }
  verifyingCode.value = true
  try {
    const res = await authApi.verifyEmailCode(email.value.trim(), code)
    verificationToken.value = res.verificationToken
    codeError.value = false
    codeErrorMsg.value = ''
    clearInterval(countdownTimer)
    emailVerified.value = true
  } catch (e) {
    codeError.value = true
    codeErrorMsg.value = messageFor(e, {
      AUTH_VERIFICATION_CODE_INVALID: '인증번호가 올바르지 않아요.',
      AUTH_VERIFY_ATTEMPT_EXCEEDED: '시도 횟수를 초과했어요. 인증번호를 다시 받아주세요.',
    })
    shakeCode()
  } finally {
    verifyingCode.value = false
  }
}

// 닉네임 중복확인
const nicknameChecked = ref(false)
const nicknameAvailable = ref(false)
const nicknameMsg = ref('')
const checkingNickname = ref(false)

async function checkNickname() {
  const value = nickname.value.trim()
  // 서버 가입 규칙(2~16자)과 동일하게 미리 거른다 — 통과시켜 놓고 가입에서 실패하면 안 된다.
  if (value.length < 2 || value.length > 16) {
    nicknameChecked.value = true
    nicknameAvailable.value = false
    nicknameMsg.value = '닉네임은 2~16자여야 해요.'
    return
  }
  checkingNickname.value = true
  try {
    const res = await authApi.checkNicknameAvailability(value)
    nicknameChecked.value = true
    nicknameAvailable.value = res.available
    nicknameMsg.value = res.available
      ? '✓ 사용할 수 있는 닉네임이에요'
      : '✕ 이미 사용 중인 닉네임이에요'
  } catch (e) {
    nicknameChecked.value = true
    nicknameAvailable.value = false
    nicknameMsg.value = messageFor(e, {})
  } finally {
    checkingNickname.value = false
  }
}

/** ApiError면 code에 매핑된 문구를, 없으면 서버 message를 그대로 쓴다. */
function messageFor(e: unknown, map: Record<string, string>): string {
  if (e instanceof ApiError) return map[e.code] ?? e.message
  if (e instanceof Error) return e.message
  return '알 수 없는 오류가 발생했습니다.'
}

// 비밀번호 서식 / 일치 확인
const showPassword = ref(false)
const showPasswordConfirm = ref(false)

// 비밀번호 입력 중엔 고양이가 쏙 숨는다
const catShy = ref(false)

// 서버 규칙과 동일: 12~64자, 소문자·대문자·숫자·특수문자 중 3종 이상
const passwordValid = computed(() => {
  const pw = password.value
  if (pw.length < 12 || pw.length > 64) return false
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length
  return kinds >= 3
})
const passwordsMatch = computed(
  () => passwordConfirm.value.length > 0 && passwordConfirm.value === password.value,
)

const canSubmitSignup = computed(
  () =>
    emailVerified.value &&
    verificationToken.value !== '' &&
    nicknameChecked.value &&
    nicknameAvailable.value &&
    passwordValid.value &&
    passwordsMatch.value,
)

/** 폼 전체에 대한 서버 오류 문구 */
const submitError = ref('')
const submitting = ref(false)

/**
 * 가입 후 곧바로 로그인한다.
 * 명세상 POST /auth/signup의 응답은 UserProfile이라 토큰이 없기 때문에,
 * 화면 상태에 남아 있는 이메일·비밀번호로 한 번 더 로그인해 토큰을 받는다.
 */
async function submitSignup() {
  submitError.value = ''
  submitting.value = true
  try {
    await authApi.signup({
      email: email.value.trim(),
      password: password.value,
      nickname: nickname.value.trim(),
      verificationToken: verificationToken.value,
    })
    const token = await authApi.login(email.value.trim(), password.value)
    session.applyToken(token)
    router.push({ name: RouteName.Lobby })
  } catch (e) {
    submitError.value = messageFor(e, {
      AUTH_VERIFICATION_TOKEN_INVALID: '이메일 인증이 만료됐어요. 인증을 다시 진행해 주세요.',
      AUTH_EMAIL_ALREADY_REGISTERED: '이미 가입된 이메일입니다.',
      AUTH_NICKNAME_ALREADY_USED: '이미 사용 중인 닉네임이에요.',
    })
    // 인증 토큰이 만료·소모된 경우 이메일 인증 단계로 되돌린다.
    if (e instanceof ApiError && e.code === 'AUTH_VERIFICATION_TOKEN_INVALID') {
      emailVerified.value = false
      emailSent.value = false
      verificationToken.value = ''
    }
  } finally {
    submitting.value = false
  }
}

async function submitLogin() {
  submitError.value = ''
  submitting.value = true
  try {
    const token = await authApi.login(email.value.trim(), password.value, rememberMe.value)
    session.applyToken(token, rememberMe.value)
    router.push({ name: RouteName.Lobby })
  } catch (e) {
    submitError.value = messageFor(e, {
      AUTH_INVALID_CREDENTIALS: '이메일 또는 비밀번호를 확인해 주세요.',
      AUTH_ACCOUNT_NOT_ACTIVE: '이용이 제한된 계정입니다.',
    })
  } finally {
    submitting.value = false
  }
}

const rememberMe = ref(false)

function submit() {
  if (submitting.value) return
  return isSignup.value ? submitSignup() : submitLogin()
}

const back = () => router.push({ name: RouteName.Start })

// 아이디 찾기 모달 — 로그인 창 위에 오버레이로 띄운다
const findIdOpen = ref(false)
const findIdNickname = ref('')
const findIdResult = ref('')
const findIdError = ref('')
const findIdLoading = ref(false)

function openFindId() {
  findIdNickname.value = ''
  findIdResult.value = ''
  findIdError.value = ''
  findIdOpen.value = true
}
function closeFindId() {
  findIdOpen.value = false
}
async function submitFindId() {
  const value = findIdNickname.value.trim()
  if (!value) return
  findIdLoading.value = true
  findIdError.value = ''
  findIdResult.value = ''
  try {
    const res = await recoveryApi.findId(value)
    findIdResult.value = res.maskedEmail
  } catch (e) {
    findIdError.value = e instanceof ApiError ? e.message : '조회에 실패했어요.'
  } finally {
    findIdLoading.value = false
  }
}

// 비밀번호 찾기 모달 — 이메일로 재설정 링크 요청만 처리 (토큰 검증은 메일 링크 경로에서 진행)
const resetOpen = ref(false)
const resetEmail = ref('')
const resetMessage = ref('')
const resetError = ref('')
const resetLoading = ref(false)

function openResetPassword() {
  resetEmail.value = ''
  resetMessage.value = ''
  resetError.value = ''
  resetOpen.value = true
}
function closeResetPassword() {
  resetOpen.value = false
}
async function submitResetRequest() {
  const value = resetEmail.value.trim()
  if (!value) return
  resetLoading.value = true
  resetError.value = ''
  resetMessage.value = ''
  try {
    await recoveryApi.requestPasswordReset(value)
    resetMessage.value = '재설정 링크를 이메일로 보냈어요. 메일함을 확인해 주세요.'
  } catch (e) {
    resetError.value = e instanceof ApiError ? e.message : '요청에 실패했어요.'
  } finally {
    resetLoading.value = false
  }
}

// ── 게스트 시작 — 명세 POST /auth/guest (서버가 임시 닉네임·1인방 부여) ──────────
async function startGuest() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const res = await recoveryApi.guest()
    session.loginAsGuest(res.guestNickname, res.roomId)
    // 게스트는 멀티플레이 로비 대신 1인 게임 화면에서 시작 (StartView와 동일 정책)
    router.push({ name: RouteName.GamesCatalog })
  } catch (e) {
    submitError.value = messageFor(e, {})
  } finally {
    submitting.value = false
  }
}

// ── 소셜 로그인 (google · kakao) — 명세 POST /auth/social/{provider} ──────────
// client_id(구글)·REST 키(카카오)는 authorize URL에 노출되는 공개값이라 VITE_ 환경변수로 둔다.
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY ?? ''
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const SOCIAL_REDIRECT_URI = `${window.location.origin}/auth`

/** provider authorize 페이지로 이동. 콜백은 이 화면(/auth)으로 돌아온다. */
function startSocial(provider: 'google' | 'kakao') {
  const clientId = provider === 'kakao' ? KAKAO_REST_KEY : GOOGLE_CLIENT_ID
  if (!clientId) {
    submitError.value = `${provider} 로그인이 아직 설정되지 않았어요.`
    return
  }
  sessionStorage.setItem('social_provider', provider)
  const base =
    provider === 'kakao'
      ? 'https://kauth.kakao.com/oauth/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth'
  const scope = provider === 'google' ? '&scope=openid%20email%20profile' : ''
  window.location.href =
    `${base}?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(SOCIAL_REDIRECT_URI)}` +
    `&response_type=code${scope}`
}

// provider가 ?code=로 돌아오면 백엔드로 넘겨 JWT를 받고 로비로 이동
onMounted(async () => {
  const code = route.query.code
  if (typeof code !== 'string') return
  const provider = sessionStorage.getItem('social_provider') as 'google' | 'kakao' | null
  sessionStorage.removeItem('social_provider')
  if (!provider) return
  try {
    const token = await recoveryApi.social(provider, {
      authorizationCode: code,
      redirectUri: SOCIAL_REDIRECT_URI,
    })
    session.applyToken(token)
    router.replace({ name: RouteName.Lobby })
  } catch (e) {
    submitError.value = messageFor(e, { AUTH_SOCIAL_LOGIN_FAILED: '소셜 로그인에 실패했어요.' })
    router.replace({ name: RouteName.Auth }) // URL에서 code 제거
  }
})
</script>

<template>
  <main class="page">
    <section class="card">
      <PixelCat :shy="catShy" />
      <div class="head">
        <BrandLogo size="sm" subtitle="친구들과 움직일 준비가 되었나요?" title="MoToK" />
      </div>

      <template v-if="isSignup">
        <label class="field">
          이메일
          <div class="input-wrap solo">
            <input
              v-model="email"
              placeholder="play@motok.com"
              :disabled="emailVerified"
              @input="emailFormatError = false"
            />
            <button
              type="button"
              class="inline-btn"
              :class="{ shake: emailShake }"
              :disabled="emailVerified || sendingCode"
              @click="sendEmailCode"
            >
              {{ sendingCode ? '전송 중…' : emailSent ? '재전송' : '코드 보내기' }}
            </button>
          </div>
          <div v-if="emailFormatError" class="check-msg bad">
            이메일 형식을 맞추어 작성해주세요.
          </div>
          <div v-else-if="emailErrorMsg" class="check-msg bad">{{ emailErrorMsg }}</div>
        </label>

        <label v-if="emailSent && !emailVerified" class="field">
          이메일 인증
          <span class="countdown" :class="{ expired: codeTimeLeft <= 0 }">{{ codeDisplay }}</span>
          <div class="input-wrap solo">
            <input
              v-model="emailCode"
              placeholder="인증번호 입력"
              maxlength="6"
              @input="codeError = false"
            />
            <button
              type="button"
              class="inline-btn"
              :class="{ shake: codeShake }"
              :disabled="verifyingCode"
              @click="verifyEmailCode"
            >
              {{ verifyingCode ? '확인 중…' : '인증 확인' }}
            </button>
          </div>
          <div v-if="codeError" class="check-msg bad">
            {{ codeErrorMsg || '인증번호가 올바르지 않아요.' }}
          </div>
        </label>
        <div v-else-if="emailVerified" class="check-msg ok">✓ 이메일 인증이 완료됐어요</div>

        <label class="field">
          닉네임
          <div class="input-wrap solo">
            <input
              v-model="nickname"
              placeholder="놀이터에서 사용할 이름"
              @input="nicknameChecked = false"
            />
            <button
              type="button"
              class="inline-btn"
              :disabled="checkingNickname"
              @click="checkNickname"
            >
              {{ checkingNickname ? '확인 중…' : '중복 확인' }}
            </button>
          </div>
          <div
            v-if="nicknameChecked"
            class="check-msg"
            :class="nicknameAvailable ? 'ok' : 'bad'"
          >
            {{ nicknameMsg }}
          </div>
        </label>

        <label class="field">
          비밀번호
          <div class="hint">12자 이상, 영문 대/소문자·숫자·특수기호 중 3가지 이상 조합</div>
          <div class="input-wrap solo has-eye">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="비밀번호 입력"
              @focus="catShy = true"
              @blur="catShy = false"
            />
            <button
              type="button"
              class="eye-btn"
              :aria-label="showPassword ? '비밀번호 숨기기' : '비밀번호 보기'"
              @click="showPassword = !showPassword"
            >
              <i
                class="eye-icon"
                :style="{ backgroundImage: `url('/assets/icons/eye-${showPassword ? 'open' : 'closed'}.svg')` }"
              />
            </button>
            <i class="dot" :class="{ ok: passwordValid, bad: password && !passwordValid }" />
          </div>
        </label>

        <label class="field">
          비밀번호 확인
          <div class="input-wrap solo has-eye">
            <input
              v-model="passwordConfirm"
              :type="showPasswordConfirm ? 'text' : 'password'"
              placeholder="비밀번호 재입력"
              @focus="catShy = true"
              @blur="catShy = false"
            />
            <button
              type="button"
              class="eye-btn"
              :aria-label="showPasswordConfirm ? '비밀번호 숨기기' : '비밀번호 보기'"
              @click="showPasswordConfirm = !showPasswordConfirm"
            >
              <i
                class="eye-icon"
                :style="{
                  backgroundImage: `url('/assets/icons/eye-${showPasswordConfirm ? 'open' : 'closed'}.svg')`,
                }"
              />
            </button>
            <i class="dot" :class="{ ok: passwordsMatch, bad: passwordConfirm && !passwordsMatch }" />
          </div>
        </label>

        <PixelButton
          variant="primary"
          size="lg"
          block
          class="submit"
          :disabled="!canSubmitSignup || submitting"
          @click="submit"
        >
          {{ submitting ? '가입 중…' : '가입하기' }}
        </PixelButton>
        <div v-if="submitError" class="check-msg bad">{{ submitError }}</div>

        <p class="signup-cta">
          <button type="button" @click="mode = 'login'">이미 계정이 있어요</button>
        </p>
      </template>

      <template v-else>
        <label class="field">
          이메일
          <input v-model="email" placeholder="play@motok.com" />
        </label>
        <label class="field">
          비밀번호
          <input
            v-model="password"
            type="password"
            placeholder="비밀번호 입력"
            @focus="catShy = true"
            @blur="catShy = false"
          />
        </label>

        <div class="remember-row">
          <label class="remember">
            <input v-model="rememberMe" type="checkbox" />
            로그인 상태 유지
          </label>
          <p class="recovery-links">
            <button type="button" @click="openFindId">아이디 찾기</button>
            <span class="sep">|</span>
            <button type="button" @click="openResetPassword">비밀번호 찾기</button>
          </p>
        </div>

        <PixelButton
          variant="primary"
          size="lg"
          block
          class="submit"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? '로그인 중…' : '로그인' }}
        </PixelButton>
        <div v-if="submitError" class="check-msg bad">{{ submitError }}</div>

        <div class="divider"><span>또는</span></div>

        <div class="social">
          <button :disabled="!GOOGLE_CLIENT_ID" @click="startSocial('google')">
            <img src="/assets/icons/google.svg" alt="" class="social-icon" />
            로그인
          </button>
          <button @click="startSocial('kakao')">
            <img src="/assets/icons/kakao.svg" alt="" class="social-icon" />
            로그인
          </button>
        </div>

        <p class="signup-cta">
          MoToK이 처음이세요?
          <button type="button" @click="mode = 'signup'">회원가입</button>
        </p>

        <p class="signup-cta">
          <button type="button" :disabled="submitting" @click="startGuest">게스트로 시작하기</button>
        </p>
      </template>

      <button class="back" @click="back">← 시작 화면으로</button>
    </section>

    <Transition name="modal">
      <div v-if="findIdOpen" class="modal-backdrop" @click.self="closeFindId">
        <section class="card modal-card">
          <button class="modal-close" aria-label="닫기" @click="closeFindId">✕</button>
          <h2 class="modal-title">아이디 찾기</h2>
          <p class="modal-desc">가입 시 사용한 닉네임으로 이메일을 확인해요</p>

          <label class="field">
            닉네임
            <input
              v-model="findIdNickname"
              placeholder="가입 시 닉네임"
              @keydown.enter="submitFindId"
            />
          </label>

          <PixelButton
            variant="primary"
            size="lg"
            block
            class="submit"
            :disabled="findIdLoading"
            @click="submitFindId"
          >
            {{ findIdLoading ? '조회 중…' : '아이디 찾기' }}
          </PixelButton>

          <div v-if="findIdResult" class="check-msg ok">가입된 이메일: {{ findIdResult }}</div>
          <div v-if="findIdError" class="check-msg bad">{{ findIdError }}</div>
        </section>
      </div>
    </Transition>

    <Transition name="modal">
      <div v-if="resetOpen" class="modal-backdrop" @click.self="closeResetPassword">
        <section class="card modal-card">
          <button class="modal-close" aria-label="닫기" @click="closeResetPassword">✕</button>
          <h2 class="modal-title">비밀번호 찾기</h2>
          <p class="modal-desc">가입한 이메일로 재설정 링크를 보내드려요</p>

          <label class="field">
            이메일
            <input
              v-model="resetEmail"
              placeholder="play@motok.com"
              @keydown.enter="submitResetRequest"
            />
          </label>

          <PixelButton
            variant="primary"
            size="lg"
            block
            class="submit"
            :disabled="resetLoading"
            @click="submitResetRequest"
          >
            {{ resetLoading ? '전송 중…' : '재설정 링크 받기' }}
          </PixelButton>

          <div v-if="resetMessage" class="check-msg ok">{{ resetMessage }}</div>
          <div v-if="resetError" class="check-msg bad">{{ resetError }}</div>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.page {
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--c-cream);
  background-image: radial-gradient(circle at 1px 1px, rgba(56, 38, 61, 0.1) 1px, transparent 1.5px);
  background-size: 18px 18px;
}
.card {
  position: relative;
  z-index: 1;
  width: 440px;
  max-width: 92vw;
  padding: 28px;
  border: var(--border-thick);
  border-radius: var(--radius-xl);
  background: var(--c-paper);
  box-shadow: 9px 9px 0 var(--c-ink);
}
.head {
  margin-bottom: 22px;
  padding-right: 76px;
}

.field {
  display: block;
  margin-top: 12px;
  font-size: 9px;
  font-weight: 700;
}
.countdown {
  margin-left: 6px;
  font-size: 9px;
  font-weight: 700;
  color: var(--c-coral);
  letter-spacing: 0.5px;
}
.countdown.expired {
  color: var(--c-muted);
}
.field input {
  width: 100%;
  height: 45px;
  margin-top: 6px;
  padding: 0 12px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  outline: 0;
}
.hint {
  font-size: 8px;
  color: var(--c-muted);
  margin-top: 5px;
}
.submit { margin-top: 20px; }

.input-wrap {
  position: relative;
}
.input-wrap input {
  width: 100%;
  padding-right: 32px;
}
.input-wrap .dot {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
}
.input-wrap.solo {
  margin-top: 6px;
}
.input-wrap.solo input {
  margin-top: 0;
  padding-right: 84px;
}
.input-wrap.has-eye input {
  padding-right: 52px;
}
.input-wrap.has-eye .dot {
  right: 12px;
}
.inline-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 32px;
  padding: 0 10px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  background: var(--c-mint-soft);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
  transition: var(--t-fast);
}
.inline-btn:hover {
  transform: translateY(-50%) translate(-1px, -1px);
  box-shadow: var(--shadow-sm);
}
.inline-btn:active {
  transform: translateY(-50%) translate(1px, 1px);
}
.inline-btn:disabled {
  background: #f0ece9;
  color: var(--c-muted);
  cursor: not-allowed;
}
.inline-btn.shake {
  background: var(--c-coral);
  color: #fff;
  animation: btn-shake 0.4s ease;
}
@keyframes btn-shake {
  0%, 100% { transform: translateY(-50%) translateX(0); }
  20% { transform: translateY(-50%) translateX(-4px); }
  40% { transform: translateY(-50%) translateX(4px); }
  60% { transform: translateY(-50%) translateX(-3px); }
  80% { transform: translateY(-50%) translateX(3px); }
}
.eye-btn {
  position: absolute;
  right: 26px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  padding: 0;
  transition: var(--t-fast);
}
.eye-icon {
  width: 15px;
  height: 15px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
.eye-btn:hover {
  background: rgba(56, 38, 61, 0.08);
}
.dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d8cdd6;
}
.dot.ok { background: var(--c-mint); }
.dot.bad { background: var(--c-coral); }

.check-msg {
  margin-top: 6px;
  font-size: 8px;
  font-weight: 700;
  color: var(--c-muted);
}
.check-msg.ok { color: var(--c-mint); }
.check-msg.bad { color: var(--c-coral); }

.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}
.remember {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  font-weight: 700;
  color: var(--c-muted);
}
.remember input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--c-ink);
}
.recovery-links {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 9px;
  color: var(--c-muted);
}
.recovery-links button {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--c-blue);
  font-size: 9px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.divider {
  position: relative;
  margin: 18px 0 14px;
  text-align: center;
  font-size: 9px;
  color: var(--c-muted);
}
.divider::before,
.divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 38%;
  height: 1px;
  background: #d8cdd6;
}
.divider::before { left: 0; }
.divider::after { right: 0; }
.divider span {
  position: relative;
  padding: 0 8px;
  background: var(--c-paper);
}

.social {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.social button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  padding: 0 8px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  box-shadow: var(--shadow-sm);
  font-size: 11px;
  font-weight: 700;
  transition: var(--t-fast);
}
.social-icon {
  width: 18px;
  height: 18px;
}
.social button:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-md);
}
.social button:active {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 var(--c-ink);
}

.signup-cta {
  margin-top: 16px;
  text-align: center;
  font-size: 10px;
  color: var(--c-muted);
}
.signup-cta button {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--c-blue);
  font-size: 10px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.back {
  position: absolute;
  top: 16px;
  right: 16px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-blue);
  font-size: 9px;
  font-weight: 700;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(56, 38, 61, 0.45);
  padding: 16px;
}
.modal-card {
  position: relative;
  width: 380px;
  max-width: 100%;
}
.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-muted);
  font-size: 14px;
  font-weight: 700;
}
.modal-title {
  margin: 0 0 6px;
  padding-right: 28px;
  font-size: 16px;
  font-weight: 800;
}
.modal-desc {
  margin: 0 0 16px;
  font-size: 10px;
  color: var(--c-muted);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .modal-card {
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease;
}
.modal-leave-active .modal-card {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  transform: scale(0.9) translateY(10px);
  opacity: 0;
}
</style>
