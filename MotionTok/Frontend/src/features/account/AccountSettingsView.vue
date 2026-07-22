<script setup lang="ts">
/** 계정 설정 — 닉네임 변경 / 비밀번호 변경 / 회원 탈퇴 (API §2). */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usersApi, authApi, ApiError } from '@/api'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const session = useSessionStore()
const { message: toast, flash } = useToast()

const nickname = ref('')
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')

// 비밀번호 표시/검증 — 회원가입(AuthView) 로직과 동일한 규칙
const showNewPassword = ref(false)
const showNewPasswordConfirm = ref(false)

// 서버 규칙과 동일: 12~64자, 소문자·대문자·숫자·특수문자 중 3종 이상
const newPasswordValid = computed(() => {
  const pw = newPassword.value
  if (pw.length < 12 || pw.length > 64) return false
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length
  return kinds >= 3
})
const newPasswordsMatch = computed(
  () => newPasswordConfirm.value.length > 0 && newPasswordConfirm.value === newPassword.value,
)

// 닉네임 중복확인
const nicknameChecked = ref(false)
const nicknameAvailable = ref(false)
const nicknameMsg = ref('')
const checkingNickname = ref(false)

function onNicknameInput() {
  nicknameChecked.value = false
}

// 중앙에 잠깐 떴다 사라지는 안내 (하단 토스트와 별개)
const centerNotice = ref('')
const centerNoticeKey = ref(0)
let centerNoticeTimer: ReturnType<typeof setTimeout> | undefined
function showCenterNotice(msg: string) {
  clearTimeout(centerNoticeTimer)
  centerNotice.value = msg
  centerNoticeKey.value++
  centerNoticeTimer = setTimeout(() => (centerNotice.value = ''), 1600)
}

async function checkNickname() {
  const value = nickname.value.trim()
  if (value.length < 2 || value.length > 16) {
    nicknameChecked.value = true
    nicknameAvailable.value = false
    nicknameMsg.value = '닉네임은 2~16자여야 해요.'
    return
  }
  checkingNickname.value = true
  try {
    const res = await authApi.checkNickname(value)
    nicknameChecked.value = true
    nicknameAvailable.value = res.available
    nicknameMsg.value = res.available
      ? '✓ 사용할 수 있는 닉네임이에요'
      : '✕ 이미 사용 중인 닉네임이에요'
  } catch (e) {
    nicknameChecked.value = true
    nicknameAvailable.value = false
    nicknameMsg.value = e instanceof ApiError ? e.message : '확인 실패 (백엔드 미연동)'
  } finally {
    checkingNickname.value = false
  }
}

async function saveNickname() {
  if (!nickname.value.trim()) return flash('닉네임을 입력해 주세요')
  if (!nicknameChecked.value || !nicknameAvailable.value) {
    return showCenterNotice('닉네임 중복 확인을 먼저 해주세요')
  }
  const newNickname = nickname.value.trim()
  try {
    await usersApi.updateProfile(newNickname)
  } catch {
    // 백엔드 인증 세션이 없는 로컬/게스트 환경에서도 화면에는 바로 반영한다.
  }
  if (session.profile) session.profile.nickname = newNickname
  flash('닉네임이 변경되었어요')
  nicknameChecked.value = false
}

async function savePassword() {
  if (!currentPassword.value || !newPassword.value || !newPasswordConfirm.value) {
    return flash('비밀번호를 모두 입력해 주세요')
  }
  if (!newPasswordValid.value) {
    return flash('새 비밀번호가 규칙에 맞지 않아요')
  }
  if (!newPasswordsMatch.value) {
    return flash('새 비밀번호가 서로 달라요')
  }
  try {
    await usersApi.changePassword(currentPassword.value, newPassword.value)
    flash('비밀번호가 변경되었어요')
    currentPassword.value = ''
    newPassword.value = ''
    newPasswordConfirm.value = ''
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '변경 실패 (백엔드 미연동)')
  }
}

const showWithdrawModal = ref(false)

async function withdraw() {
  showWithdrawModal.value = false
  try {
    await usersApi.withdraw()
    flash('탈퇴 처리되었어요')
    setTimeout(() => router.push({ name: RouteName.Start }), 1000)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '탈퇴 실패 (백엔드 미연동)')
  }
}
</script>

<template>
  <AppPage title="설정" max-width="560px" title-style="plain">
    <div class="stack">
      <PixelCard title="닉네임 변경">
        <label class="field">
          새 닉네임
          <div class="input-wrap solo">
            <input
              v-model="nickname"
              placeholder="변경할 닉네임"
              @input="onNicknameInput"
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
        <PixelButton variant="primary" block @click="saveNickname">변경</PixelButton>
      </PixelCard>

      <PixelCard title="비밀번호 변경">
        <label class="field">
          현재 비밀번호
          <input v-model="currentPassword" type="password" />
        </label>

        <label class="field">
          새 비밀번호
          <div class="hint">12자 이상, 영문 대/소문자·숫자·특수기호 중 3가지 이상 조합</div>
          <div class="input-wrap solo has-eye">
            <input
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              placeholder="새 비밀번호 입력"
            />
            <button
              type="button"
              class="eye-btn"
              :aria-label="showNewPassword ? '비밀번호 숨기기' : '비밀번호 보기'"
              @click="showNewPassword = !showNewPassword"
            >
              <i
                class="eye-icon"
                :style="{ backgroundImage: `url('/assets/icons/eye-${showNewPassword ? 'open' : 'closed'}.svg')` }"
              />
            </button>
            <i class="dot" :class="{ ok: newPasswordValid, bad: newPassword && !newPasswordValid }" />
          </div>
        </label>

        <label class="field">
          새 비밀번호 확인
          <div class="input-wrap solo has-eye">
            <input
              v-model="newPasswordConfirm"
              :type="showNewPasswordConfirm ? 'text' : 'password'"
              placeholder="새 비밀번호 재입력"
            />
            <button
              type="button"
              class="eye-btn"
              :aria-label="showNewPasswordConfirm ? '비밀번호 숨기기' : '비밀번호 보기'"
              @click="showNewPasswordConfirm = !showNewPasswordConfirm"
            >
              <i
                class="eye-icon"
                :style="{
                  backgroundImage: `url('/assets/icons/eye-${showNewPasswordConfirm ? 'open' : 'closed'}.svg')`,
                }"
              />
            </button>
            <i class="dot" :class="{ ok: newPasswordsMatch, bad: newPasswordConfirm && !newPasswordsMatch }" />
          </div>
        </label>

        <PixelButton variant="primary" block @click="savePassword">변경</PixelButton>
      </PixelCard>

      <PixelButton variant="primary" block @click="showWithdrawModal = true">회원 탈퇴</PixelButton>
    </div>
    <PixelToast :message="toast" />
    <div v-if="centerNotice" :key="centerNoticeKey" class="center-notice">{{ centerNotice }}</div>

    <PixelModal v-if="showWithdrawModal" @close="showWithdrawModal = false">
      <h3 class="withdraw-title">⚠ 주의</h3>
      <p class="withdraw-warn">탈퇴 시 계정은 비활성 처리(soft delete)되고 랭킹 등 노출 정보에서 제외됩니다.</p>
      <div class="modal-actions">
        <PixelButton block @click="showWithdrawModal = false">취소</PixelButton>
        <PixelButton variant="primary" block @click="withdraw">탈퇴</PixelButton>
      </div>
    </PixelModal>
  </AppPage>
</template>

<style scoped>
.stack { display: grid; gap: 16px; }
.field { display: block; margin-bottom: 14px; font-size: 9px; font-weight: 700; }
.field input {
  width: 100%; height: 44px; margin-top: 6px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.withdraw-title { margin: 0 0 7px; color: var(--c-coral); }
.withdraw-warn { margin: 0 0 18px; font-size: 11px; color: var(--c-muted); line-height: 1.6; }
.modal-actions { display: flex; gap: 9px; }
.modal-actions > * { flex: 1; }
.hint { font-size: 8px; color: var(--c-muted); margin-top: 5px; }

.input-wrap { position: relative; margin-top: 6px; }
.input-wrap.solo input { margin-top: 0; padding-right: 84px; }
.input-wrap.has-eye input { padding-right: 52px; }
.input-wrap.has-eye .dot { right: 12px; }
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
.eye-btn:hover { background: rgba(56, 38, 61, 0.08); }
.eye-icon {
  width: 15px;
  height: 15px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
.dot {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d8cdd6;
}
.dot.ok { background: var(--c-mint); }
.dot.bad { background: var(--c-coral); }
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
.inline-btn:hover { transform: translateY(-50%) translate(-1px, -1px); box-shadow: var(--shadow-sm); }
.inline-btn:active { transform: translateY(-50%) translate(1px, 1px); }
.inline-btn:disabled { background: #f0ece9; color: var(--c-muted); cursor: not-allowed; }
.check-msg { margin-top: 6px; font-size: 8px; font-weight: 700; color: var(--c-muted); }
.check-msg.ok { color: var(--c-mint); }
.check-msg.bad { color: var(--c-coral); }

.center-notice {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 300;
  transform: translate(-50%, -50%);
  padding: 16px 22px;
  border: var(--border);
  border-radius: var(--radius-md);
  background: var(--c-ink);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
  opacity: 0;
  animation: center-notice-pop 1.6s ease forwards;
}
@keyframes center-notice-pop {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
  12% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  70% { opacity: 1; }
  100% { opacity: 0; }
}
</style>
