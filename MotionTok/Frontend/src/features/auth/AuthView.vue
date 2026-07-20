<script setup lang="ts">
/** 로그인 / 회원가입 화면 — 탭 전환, ?mode 쿼리로 초기 모드 결정. */
import { computed, ref } from 'vue'
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

function submit() {
  // TODO: 유효성 검증 / 중복확인 / 실제 인증 API 연동
  session.login({ email: email.value, nickname: nickname.value || undefined })
  router.push({ name: RouteName.Lobby })
}

const back = () => router.push({ name: RouteName.Start })
</script>

<template>
  <main class="page">
    <section class="card">
      <div class="head">
        <BrandLogo size="sm" subtitle="친구들과 움직일 준비를 해볼까요?" title="미니게임 놀이터" />
      </div>

      <div class="tabs">
        <button :class="{ on: !isSignup }" @click="mode = 'login'">로그인</button>
        <button :class="{ on: isSignup }" @click="mode = 'signup'">회원가입</button>
      </div>

      <label class="field">
        이메일
        <input v-model="email" placeholder="play@motok.com" />
      </label>
      <label class="field">
        비밀번호
        <input v-model="password" type="password" placeholder="8자 이상 입력" />
      </label>

      <template v-if="isSignup">
        <label class="field">
          닉네임
          <input v-model="nickname" placeholder="놀이터에서 사용할 이름" />
        </label>
        <div class="hint">이메일·닉네임 중복 확인과 입력 형식 검증이 적용됩니다.</div>
      </template>

      <PixelButton variant="primary" size="lg" block class="submit" @click="submit">
        {{ isSignup ? '가입하고 시작하기' : '로그인' }}
      </PixelButton>

      <div v-if="!isSignup" class="social">
        <button>Google</button>
        <button>Kakao</button>
        <button>Naver</button>
      </div>

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
  width: 440px;
  max-width: 92vw;
  padding: 28px;
  border: var(--border-thick);
  border-radius: var(--radius-xl);
  background: var(--c-paper);
  box-shadow: 9px 9px 0 var(--c-ink);
}
.head { margin-bottom: 4px; }

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 25px 0 19px;
}
.tabs button {
  height: 42px;
  border: 2px solid var(--c-ink);
  border-radius: var(--radius-sm);
  background: #fff;
}
.tabs button.on {
  background: var(--c-mint-soft);
  box-shadow: var(--shadow-sm);
  font-weight: 700;
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
.hint {
  font-size: 8px;
  color: var(--c-muted);
  margin-top: 5px;
}
.submit { margin-top: 20px; }

.social {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.social button {
  height: 38px;
  border: 2px solid var(--c-ink);
  border-radius: 10px;
  background: #fff;
  font-size: 9px;
}
.back {
  display: block;
  margin: 18px auto 0;
  border: 0;
  background: transparent;
  color: var(--c-blue);
}
</style>
