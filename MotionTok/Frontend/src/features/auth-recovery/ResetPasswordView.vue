<script setup lang="ts">
/**
 * 비밀번호 재설정 (API §1).
 * 1단계: 이메일로 재설정 링크 요청(reset-request)
 * 2단계: 메일의 1회성 토큰(?token=)으로 새 비밀번호 설정(reset)
 */
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, ApiError } from '@/api'
import { RouteName } from '@/router/routeNames'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const route = useRoute()
const router = useRouter()
const token = (route.query.token as string) || ''

const email = ref('')
const newPassword = ref('')
const message = ref<string | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

async function requestLink() {
  loading.value = true
  error.value = null
  message.value = null
  try {
    await authApi.requestPasswordReset(email.value.trim())
    message.value = '재설정 링크를 이메일로 보냈어요. 메일함을 확인해 주세요.'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '요청에 실패했어요 (백엔드 미연동)'
  } finally {
    loading.value = false
  }
}

async function reset() {
  loading.value = true
  error.value = null
  try {
    await authApi.resetPassword(token, newPassword.value)
    message.value = '비밀번호가 변경되었어요. 다시 로그인해 주세요.'
    setTimeout(() => router.push({ name: RouteName.Auth, query: { mode: 'login' } }), 1200)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '변경에 실패했어요 (백엔드 미연동)'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppPage title="비밀번호 재설정" max-width="480px">
    <PixelCard pad="24px">
      <!-- 2단계: 토큰이 있으면 새 비밀번호 입력 -->
      <template v-if="token">
        <p class="lead">새 비밀번호를 입력해 주세요.</p>
        <label class="field">
          새 비밀번호
          <input v-model="newPassword" type="password" placeholder="8자 이상" />
        </label>
        <PixelButton variant="primary" size="lg" block :disabled="loading" @click="reset">
          비밀번호 변경
        </PixelButton>
      </template>

      <!-- 1단계: 이메일로 재설정 링크 요청 -->
      <template v-else>
        <p class="lead">가입한 이메일로 재설정 링크를 보내드려요.</p>
        <label class="field">
          이메일
          <input v-model="email" placeholder="play@motok.com" @keydown.enter="requestLink" />
        </label>
        <PixelButton variant="primary" size="lg" block :disabled="loading" @click="requestLink">
          재설정 링크 받기
        </PixelButton>
      </template>

      <p v-if="message" class="ok">{{ message }}</p>
      <p v-if="error" class="err">{{ error }}</p>
    </PixelCard>
  </AppPage>
</template>

<style scoped>
.lead { margin: 0 0 16px; font-size: 11px; color: var(--c-muted); }
.field { display: block; margin-bottom: 16px; font-size: 9px; font-weight: 700; }
.field input {
  width: 100%; height: 45px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.ok { margin-top: 16px; padding: 12px; border: 2px solid var(--c-ink); border-radius: 11px; background: var(--c-mint-soft); font-size: 11px; }
.err { margin-top: 16px; font-size: 10px; color: var(--c-coral); }
</style>
