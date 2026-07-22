<script setup lang="ts">
/** 계정 설정 — 닉네임 변경 / 비밀번호 변경 / 회원 탈퇴 (API §2). */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usersApi, ApiError } from '@/api'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const session = useSessionStore()
const { message: toast, flash } = useToast()

const nickname = ref('')
const currentPassword = ref('')
const newPassword = ref('')

async function saveNickname() {
  if (!nickname.value.trim()) return flash('닉네임을 입력해 주세요')
  try {
    await usersApi.updateProfile(nickname.value.trim())
    flash('닉네임이 변경되었어요')
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '변경 실패 (백엔드 미연동)')
  }
}

async function savePassword() {
  if (!currentPassword.value || !newPassword.value) return flash('비밀번호를 모두 입력해 주세요')
  try {
    await usersApi.changePassword(currentPassword.value, newPassword.value)
    flash('비밀번호가 변경되었어요')
    currentPassword.value = ''
    newPassword.value = ''
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '변경 실패 (백엔드 미연동)')
  }
}

async function withdraw() {
  if (!confirm('정말 탈퇴하시겠어요? 계정은 비활성 처리되고 랭킹에서 제외됩니다.')) return
  try {
    await usersApi.withdraw()
    // 서버는 이미 refresh 토큰을 무효화했다 — 로컬 세션·토큰도 즉시 정리해 탈퇴 계정의 잔존 로그인 상태를 없앤다.
    // (logout()이 아니라 clear() — 죽은 계정 토큰으로 POST /auth/logout을 다시 부를 필요가 없다)
    session.clear()
    flash('탈퇴 처리되었어요')
    setTimeout(() => router.push({ name: RouteName.Start }), 1000)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '탈퇴 실패 (백엔드 미연동)')
  }
}
</script>

<template>
  <AppPage title="계정 설정" max-width="560px">
    <div class="stack">
      <PixelCard title="닉네임 변경">
        <label class="field">
          새 닉네임
          <input v-model="nickname" placeholder="변경할 닉네임 (중복 검사)" />
        </label>
        <PixelButton variant="primary" block @click="saveNickname">변경</PixelButton>
      </PixelCard>

      <PixelCard title="비밀번호 변경">
        <label class="field">
          현재 비밀번호
          <input v-model="currentPassword" type="password" />
        </label>
        <label class="field">
          새 비밀번호
          <input v-model="newPassword" type="password" placeholder="12자 이상, 영문 대/소문자·숫자·특수기호 중 3종 이상" />
        </label>
        <PixelButton variant="primary" block @click="savePassword">변경</PixelButton>
      </PixelCard>

      <PixelCard title="회원 탈퇴">
        <p class="warn">탈퇴 시 계정은 비활성 처리(soft delete)되고 랭킹 등 노출 정보에서 제외됩니다.</p>
        <PixelButton variant="primary" block @click="withdraw">회원 탈퇴</PixelButton>
      </PixelCard>
    </div>
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.stack { display: grid; gap: 16px; }
.field { display: block; margin-bottom: 14px; font-size: 9px; font-weight: 700; }
.field input {
  width: 100%; height: 44px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.warn { margin: 0 0 14px; font-size: 10px; color: var(--c-muted); line-height: 1.6; }
</style>
