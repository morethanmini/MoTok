<script setup lang="ts">
/** 아이디(이메일) 찾기 — 닉네임으로 마스킹된 이메일 확인 (API §1 /auth/find-id). */
import { ref } from 'vue'
import { authApi, ApiError } from '@/api'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const nickname = ref('')
const result = ref<string | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
  if (!nickname.value.trim()) return
  loading.value = true
  error.value = null
  result.value = null
  try {
    const res = await authApi.findId(nickname.value.trim())
    result.value = res.maskedEmail
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '조회에 실패했어요 (백엔드 미연동)'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppPage title="아이디 찾기" subtitle="가입 시 사용한 닉네임으로 이메일을 확인해요" max-width="480px">
    <PixelCard pad="24px">
      <label class="field">
        닉네임
        <input v-model="nickname" placeholder="가입 시 닉네임" @keydown.enter="submit" />
      </label>

      <PixelButton variant="primary" size="lg" block :disabled="loading" @click="submit">
        {{ loading ? '조회 중…' : '아이디 찾기' }}
      </PixelButton>

      <p v-if="result" class="ok">가입된 이메일: <b>{{ result }}</b></p>
      <p v-if="error" class="err">{{ error }}</p>
    </PixelCard>
  </AppPage>
</template>

<style scoped>
.field { display: block; margin-bottom: 16px; font-size: 9px; font-weight: 700; }
.field input {
  width: 100%; height: 45px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.ok { margin-top: 16px; padding: 12px; border: 2px solid var(--c-ink); border-radius: 11px; background: var(--c-mint-soft); font-size: 11px; }
.err { margin-top: 16px; font-size: 10px; color: var(--c-coral); }
</style>
