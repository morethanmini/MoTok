<script setup lang="ts">
/**
 * 소셜 최초 로그인 후 닉네임 설정 (-22).
 *
 * 카카오·구글 닉네임을 그대로 쓰지 않는 이유 — 그 값은 우리 운영 정책(2~16자·중복 검사)을 거치지 않았고,
 * 사용자가 모톡에서 쓰겠다고 고른 이름도 아니다. 그래서 인가만 소셜에서 받고 닉네임은 여기서 새로 정한다.
 * 라우터 가드가 nicknamePending인 동안 다른 화면으로 나가지 못하게 막는다.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { usersApi, authApi, ApiError, forceRefreshAccessToken } from '@/api'
import { reconnectGlobalStomp } from '@/composables/useGlobalStomp'
import { useSessionStore } from '@/stores/session'
import { containsProfanity } from '@/utils/profanity'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const router = useRouter()
const session = useSessionStore()

const nickname = ref('')
const checking = ref(false)
const submitting = ref(false)
const checked = ref(false)
const available = ref(false)
const message = ref('')
const error = ref('')

// 서버 규칙과 동일: 2~16자
const lengthOk = computed(() => {
  const value = nickname.value.trim()
  return value.length >= 2 && value.length <= 16
})

function onInput() {
  checked.value = false
  error.value = ''
}

async function check() {
  const value = nickname.value.trim()
  if (!lengthOk.value) {
    checked.value = true
    available.value = false
    message.value = '닉네임은 2~16자여야 해요.'
    return
  }
  // 서버(중복확인·수정 @NoProfanity)와 같은 검사를 미리 태운다 — 왕복 없이 즉시 안내
  if (containsProfanity(value)) {
    checked.value = true
    available.value = false
    message.value = '✕ 닉네임에 사용할 수 없는 단어가 있어요'
    return
  }
  checking.value = true
  try {
    const res = await authApi.checkNickname(value)
    checked.value = true
    available.value = res.available
    message.value = res.available
      ? '✓ 사용할 수 있는 닉네임이에요'
      : '✕ 이미 사용 중인 닉네임이에요'
  } catch (e) {
    checked.value = true
    available.value = false
    message.value = e instanceof ApiError ? e.message : '확인에 실패했어요.'
  } finally {
    checking.value = false
  }
}

async function submit() {
  if (submitting.value) return
  if (!checked.value || !available.value) {
    error.value = '닉네임 중복 확인을 먼저 해주세요.'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    // 서버가 여기서 다시 중복 검사를 하고(409), 성공하면 nicknamePending도 함께 해제된다.
    session.profile = await usersApi.updateProfile(nickname.value.trim())
    // 지금 액세스 토큰의 name 클레임에는 임시 닉네임(pending_*)이 남아 있다.
    // 방 참가·채팅 표시명은 서버가 이 클레임에서 읽으므로, 새 닉네임이 실린 토큰으로 회전시킨다.
    await forceRefreshAccessToken()
    // 전역 STOMP는 로그인 순간(= pending 토큰)에 이미 붙어 있고, 서버는 CONNECT 때의
    // 이름을 세션에 고정한다 — 토큰만 회전시키면 채팅이 pending_*으로 계속 나간다.
    reconnectGlobalStomp()
    router.replace({ name: RouteName.Lobby })
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 'AUTH_NICKNAME_ALREADY_USED'
        ? '방금 다른 분이 먼저 사용했어요. 다른 닉네임을 정해 주세요.'
        : e instanceof ApiError
          ? e.message
          : '저장에 실패했어요.'
    checked.value = false
  } finally {
    submitting.value = false
  }
}

/** 닉네임을 정하지 않고 나가려면 로그인 자체를 취소한다(계정은 남지만 세션은 끊는다). */
async function cancel() {
  await session.logout()
  router.replace({ name: RouteName.Start })
}
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="head">
        <BrandLogo size="sm" subtitle="모톡에서 쓸 닉네임을 정해주세요" title="MoToK" />
      </div>

      <p class="lede">
        소셜 계정으로 로그인했어요.<br />
        모톡에서 사용할 닉네임을 새로 정해주세요.
      </p>

      <label class="field">
        닉네임
        <div class="input-wrap">
          <input
            v-model="nickname"
            placeholder="2~16자"
            maxlength="16"
            @input="onInput"
            @keyup.enter="check"
          />
          <button type="button" class="inline-btn" :disabled="checking" @click="check">
            {{ checking ? '확인 중…' : '중복 확인' }}
          </button>
        </div>
        <div v-if="checked" class="check-msg" :class="available ? 'ok' : 'bad'">{{ message }}</div>
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <PixelButton variant="primary" size="lg" block :disabled="submitting" @click="submit">
        {{ submitting ? '저장 중…' : '시작하기' }}
      </PixelButton>
      <button class="cancel" @click="cancel">다른 계정으로 로그인</button>
    </section>
  </main>
</template>

<style scoped>
.page {
  height: 100%;
  display: grid;
  place-items: center;
  background-color: #fff1df;
  background-image: radial-gradient(rgba(56, 38, 61, 0.1) 1px, transparent 1.5px);
  background-size: 18px 18px;
}
.card {
  width: min(430px, 90vw);
  padding: 28px;
  border: var(--border-thick);
  border-radius: 24px;
  background: var(--c-paper);
  box-shadow: 10px 10px 0 var(--c-ink);
}
.head { margin-bottom: 18px; }
.lede { margin: 0 0 20px; font-size: 11px; line-height: 1.7; color: var(--c-muted); }
.field { display: block; margin-bottom: 18px; font-size: 9px; font-weight: 700; }
.input-wrap { position: relative; margin-top: 6px; }
.input-wrap input {
  width: 100%; height: 44px; padding: 0 88px 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.inline-btn {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  height: 32px; padding: 0 10px;
  border: 2px solid var(--c-ink); border-radius: 9px; background: var(--c-mint-soft);
  font-size: 8px; font-weight: 700; white-space: nowrap;
}
.inline-btn:disabled { background: #f0ece9; color: var(--c-muted); cursor: not-allowed; }
.check-msg { margin-top: 6px; font-size: 8px; font-weight: 700; color: var(--c-muted); }
.check-msg.ok { color: var(--c-mint); }
.check-msg.bad { color: var(--c-coral); }
.err { margin: 0 0 12px; font-size: 10px; color: var(--c-coral); }
.cancel {
  display: block; width: 100%; margin-top: 12px;
  border: 0; background: transparent; color: var(--c-muted);
  font-size: 10px; text-decoration: underline;
}
</style>
