<script setup lang="ts">
/**
 * 아이디(이메일) 찾기 — 닉네임으로 마스킹된 이메일 확인 (API §1 /auth/find-id).
 * 로그인 창과 같은 테마(카드형)로 통일한다 — 로비 헤더가 붙는 AppPage는 쓰지 않는다.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authApi, ApiError } from '@/api'
import { RouteName } from '@/router/routeNames'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const router = useRouter()

const nickname = ref('')
const result = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  const value = nickname.value.trim()
  if (!value) return
  loading.value = true
  error.value = ''
  result.value = ''
  try {
    const res = await authApi.findId(value)
    result.value = res.maskedEmail
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '조회에 실패했어요.'
  } finally {
    loading.value = false
  }
}

const back = () => router.push({ name: RouteName.Auth, query: { mode: 'login' } })
</script>

<template>
  <main class="page px-paper-bg">
    <section class="card">
      <div class="head">
        <BrandLogo size="sm" subtitle="가입 시 닉네임으로 이메일을 확인해요" title="MoToK" />
      </div>

      <label class="field">
        닉네임
        <input v-model="nickname" placeholder="가입 시 닉네임" @keydown.enter="submit" />
      </label>

      <PixelButton
        variant="primary"
        size="lg"
        block
        class="submit"
        :disabled="loading"
        @click="submit"
      >
        {{ loading ? '조회 중…' : '아이디 찾기' }}
      </PixelButton>

      <div v-if="result" class="check-msg ok">가입된 이메일: {{ result }}</div>
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
  /* 벽지는 공통 유틸(px-paper-bg)이 그린다 */
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
