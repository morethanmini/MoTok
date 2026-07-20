<script setup lang="ts">
/** 로그인 / 회원가입 화면 — 기본은 로그인, 하단 링크로 회원가입 전환. ?mode 쿼리로 초기 모드 결정. */
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'

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
let mockEmailCode = ''
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

function sendEmailCode() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    emailFormatError.value = true
    emailShake.value = false
    nextTick(() => {
      emailShake.value = true
    })
    clearTimeout(shakeTimer)
    shakeTimer = setTimeout(() => {
      emailShake.value = false
    }, 500)
    return
  }
  emailFormatError.value = false
  codeError.value = false
  emailCode.value = ''
  // TODO: 실제 인증코드 발송 API 연동 (아래는 데모용 모의 코드)
  mockEmailCode = String(Math.floor(100000 + Math.random() * 900000))
  console.log('[demo] 이메일 인증코드:', mockEmailCode)
  emailSent.value = true
  startCountdown()
}
function verifyEmailCode() {
  if (emailCode.value.trim() !== mockEmailCode) {
    codeError.value = true
    codeShake.value = false
    nextTick(() => {
      codeShake.value = true
    })
    clearTimeout(codeShakeTimer)
    codeShakeTimer = setTimeout(() => {
      codeShake.value = false
    }, 500)
    return
  }
  codeError.value = false
  clearInterval(countdownTimer)
  // TODO: 실제 인증코드 검증 API 연동
  emailVerified.value = true
}

// 닉네임 중복확인
const nicknameChecked = ref(false)
const nicknameAvailable = ref(false)

function checkNickname() {
  // TODO: 실제 닉네임 중복확인 API 연동
  nicknameChecked.value = true
  nicknameAvailable.value = true
}

// 비밀번호 서식 / 일치 확인
const showPassword = ref(false)
const showPasswordConfirm = ref(false)

const passwordValid = computed(() => {
  const pw = password.value
  if (pw.length < 12) return false
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length
  return kinds >= 3
})
const passwordsMatch = computed(
  () => passwordConfirm.value.length > 0 && passwordConfirm.value === password.value,
)

const canSubmitSignup = computed(
  () =>
    emailVerified.value &&
    nicknameChecked.value &&
    nicknameAvailable.value &&
    passwordValid.value &&
    passwordsMatch.value,
)

function submit() {
  // TODO: 실제 인증 API 연동
  session.login({ email: email.value, nickname: nickname.value || undefined })
  router.push({ name: RouteName.Lobby })
}

const back = () => router.push({ name: RouteName.Start })
</script>

<template>
  <main class="page">
    <section class="card">
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
              :disabled="emailVerified"
              @click="sendEmailCode"
            >
              {{ emailSent ? '재전송' : '코드 보내기' }}
            </button>
          </div>
          <div v-if="emailFormatError" class="check-msg bad">
            이메일 형식을 맞추어 작성해주세요.
          </div>
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
              @click="verifyEmailCode"
            >
              인증 확인
            </button>
          </div>
          <div v-if="codeError" class="check-msg bad">인증번호가 올바르지 않아요.</div>
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
            <button type="button" class="inline-btn" @click="checkNickname">중복 확인</button>
          </div>
          <div
            v-if="nicknameChecked"
            class="check-msg"
            :class="nicknameAvailable ? 'ok' : 'bad'"
          >
            {{ nicknameAvailable ? '✓ 사용할 수 있는 닉네임이에요' : '✕ 이미 사용 중인 닉네임이에요' }}
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
          :disabled="!canSubmitSignup"
          @click="submit"
        >
          가입하기
        </PixelButton>

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
          <input v-model="password" type="password" placeholder="8자 이상 입력" />
        </label>

        <PixelButton variant="primary" size="lg" block class="submit" @click="submit">
          로그인
        </PixelButton>

        <div class="divider"><span>또는</span></div>

        <div class="social">
          <button>Google로 로그인</button>
          <button>Kakao로 로그인</button>
          <button>Naver로 로그인</button>
        </div>

        <p class="signup-cta">
          MoToK이 처음이세요?
          <button type="button" @click="mode = 'signup'">회원가입</button>
        </p>
      </template>

      <button class="back" @click="back">← 시작 화면으로</button>
    </section>
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
  gap: 8px;
}
.social button {
  height: 42px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
  box-shadow: var(--shadow-sm);
  font-size: 11px;
  font-weight: 700;
  transition: var(--t-fast);
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
</style>
