<script setup lang="ts">
/**
 * 비밀번호 재설정 (API §1) — 이메일의 재설정 링크(?token=)로 접속하는 화면.
 * 로그인 창과 같은 테마(카드형)로 통일한다 — 로비 헤더가 붙는 AppPage는 쓰지 않는다.
 * 1단계: 이메일로 재설정 링크 요청(reset-request)
 * 2단계: 메일의 1회성 토큰(?token=)으로 새 비밀번호 설정(reset)
 */
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, ApiError } from '@/api'
import { RouteName } from '@/router/routeNames'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const route = useRoute()
const router = useRouter()
const token = (route.query.token as string) || ''

const email = ref('')
const newPassword = ref('')
const message = ref('')
const error = ref('')
const loading = ref(false)

async function requestLink() {
  const value = email.value.trim()
  if (!value) return
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    await authApi.requestPasswordReset(value)
    message.value = '재설정 링크를 이메일로 보냈어요. 메일함을 확인해 주세요.'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '요청에 실패했어요.'
  } finally {
    loading.value = false
  }
}

async function reset() {
  if (!newPassword.value) return
  loading.value = true
  error.value = ''
  try {
    await authApi.resetPassword(token, newPassword.value)
    message.value = '비밀번호가 변경되었어요. 다시 로그인해 주세요.'
    setTimeout(() => router.push({ name: RouteName.Auth, query: { mode: 'login' } }), 1200)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '변경에 실패했어요.'
  } finally {
    loading.value = false
  }
}

const back = () => router.push({ name: RouteName.Auth, query: { mode: 'login' } })
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="head">
        <BrandLogo size="sm" subtitle="새 비밀번호를 설정해요" title="MoToK" />
      </div>

      <template v-if="token">
        <p class="lead">새 비밀번호를 입력해 주세요.</p>
        <label class="field">
          새 비밀번호
          <input
            v-model="newPassword"
            type="password"
            placeholder="8자 이상"
            @keydown.enter="reset"
          />
        </label>
        <PixelButton
          variant="primary"
          size="lg"
          block
          class="submit"
          :disabled="loading"
          @click="reset"
        >
          {{ loading ? '변경 중…' : '비밀번호 변경' }}
        </PixelButton>
      </template>

      <template v-else>
        <p class="lead">가입한 이메일로 재설정 링크를 보내드려요.</p>
        <label class="field">
          이메일
          <input
            v-model="email"
            placeholder="play@motok.com"
            @keydown.enter="requestLink"
          />
        </label>
        <PixelButton
          variant="primary"
          size="lg"
          block
          class="submit"
          :disabled="loading"
          @click="requestLink"
        >
          {{ loading ? '전송 중…' : '재설정 링크 받기' }}
        </PixelButton>
      </template>

      <div v-if="message" class="check-msg ok">{{ message }}</div>
      <div v-if="error" class="check-msg bad">{{ error }}</div>

      <button class="back" @click="back">← 로그인으로</button>
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
}
.lead {
  margin: 0 0 16px;
  font-size: 11px;
  color: var(--c-muted);
}
.field {
  display: block;
  margin-top: 12px;
  font-size: 9px;
  font-weight: 700;
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
.submit {
  margin-top: 20px;
}
.check-msg {
  margin-top: 12px;
  font-size: 8px;
  font-weight: 700;
  color: var(--c-muted);
}
.check-msg.ok {
  color: var(--c-mint);
}
.check-msg.bad {
  color: var(--c-coral);
}
.back {
  display: block;
  margin: 16px auto 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-blue);
  font-size: 9px;
  font-weight: 700;
}
</style>
