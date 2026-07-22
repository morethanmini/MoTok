<script setup lang="ts">
/** 시작(랜딩) 화면 — 좌: 떠오르는 게임 비주얼, 우: 진입 액션. */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { authApi } from '@/api'
import type { GuestResponse } from '@/api'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import FloatStage from './components/FloatStage.vue'

const router = useRouter()
const session = useSessionStore()

const showGuestWarning = ref(false)

const goAuth = (mode: 'login' | 'signup') =>
  router.push({ name: RouteName.Auth, query: { mode } })

const playAsGuest = () => {
  showGuestWarning.value = true
}

const confirmGuest = async () => {
  let res: GuestResponse | null = null
  try {
    // 서버 게스트 세션(JWT)·1인방 생성 — 이후 인증 API 호출에 필요 (명세 POST /auth/guest)
    res = await authApi.guest()
  } catch {
    // 서버 미기동 시에도 화면 흐름은 막지 않는다(기존 동작 유지)
  }
  showGuestWarning.value = false
  session.loginAsGuest(res?.guestNickname, res?.roomId)
  // 게스트는 멀티플레이 로비 대신 게임(1인) 화면에서 시작
  router.push({ name: RouteName.GamesCatalog })
}
</script>

<template>
  <main class="page">
    <section class="visual">
      <FloatStage />
    </section>

    <section class="panel">
      <div class="stars">★ ✦</div>
      <BrandLogo subtitle="" title="MoToK" />
      <h1>온몸으로 즐기는 ★<br />실시간 게임!</h1>
      <p>
        친구와 화상으로 만나<br />
        별자리·리듬·낚시·드로잉까지—<br />
        함께 놀 수 있어요
      </p>
      <div class="actions">
        <PixelButton variant="primary" size="lg" block @click="goAuth('login')">
          로그인하고 시작하기
        </PixelButton>
        <PixelButton size="lg" block @click="goAuth('signup')">
          처음이라면 회원가입
        </PixelButton>
        <PixelButton variant="guest" size="lg" block @click="playAsGuest">
          게스트로 1인 게임 체험
        </PixelButton>
      </div>
    </section>

    <PixelModal v-if="showGuestWarning" @close="showGuestWarning = false">
      <h3>⚠ 게스트 체험 안내</h3>
      <p>
        게스트는 1인 플레이만 가능하며 멀티플레이·랭킹 등록은 로그인 후 이용할 수 있어요.
      </p>
      <div class="modal-actions">
        <PixelButton block @click="showGuestWarning = false">취소</PixelButton>
        <PixelButton variant="guest" block @click="confirmGuest">계속하기</PixelButton>
      </div>
    </PixelModal>
  </main>
</template>

<style scoped>
.page {
  height: 100%;
  display: grid;
  grid-template-columns: 1.28fr 0.72fr;
  background: #fff7df;
}

/* ── 좌측 비주얼 ─────────────────────────── */
.visual {
  position: relative;
  overflow: hidden;
  border-right: var(--border-thick);
  background-color: #dff5ed;
  background-image:
    radial-gradient(circle at 13% 16%, rgba(255, 200, 61, 0.82) 0 5%, transparent 5.3%),
    radial-gradient(circle at 84% 24%, rgba(154, 114, 216, 0.3) 0 13%, transparent 13.3%),
    radial-gradient(circle at 19% 82%, rgba(101, 121, 221, 0.24) 0 17%, transparent 17.3%),
    linear-gradient(90deg, rgba(56, 38, 61, 0.065) 1px, transparent 1px),
    linear-gradient(rgba(56, 38, 61, 0.065) 1px, transparent 1px);
  background-size: auto, auto, auto, 26px 26px, 26px 26px;
}
.visual::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 65%, rgba(255, 250, 240, 0.5));
}

/* ── 우측 패널 ───────────────────────────── */
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8%;
  background-color: #fff1df;
  background-image:
    radial-gradient(circle at 84% 14%, rgba(239, 104, 114, 0.24) 0 9%, transparent 9.3%),
    radial-gradient(circle at 12% 91%, rgba(255, 200, 61, 0.3) 0 11%, transparent 11.3%),
    radial-gradient(145deg, rgba(255, 255, 255, 0.78), transparent 42%),
    radial-gradient(rgba(56, 38, 61, 0.1) 1px, transparent 1.5px);
  background-size: auto, auto, 100% 100%, 18px 18px;
}
.panel h1 {
  font-size: 32px;
  line-height: 1.35;
  margin: 33px 0 8px;
}
.panel p {
  font-size: 12px;
  color: var(--c-muted);
  line-height: 1.7;
}
.stars {
  position: absolute;
  right: 9%;
  top: 9%;
  font-size: 25px;
  color: var(--c-yellow);
  letter-spacing: 10px;
  transform: rotate(8deg);
}
.actions {
  display: grid;
  gap: 12px;
  margin-top: 28px;
}
.modal-actions {
  display: flex;
  gap: 9px;
  margin-top: 18px;
}
.modal-actions > * {
  flex: 1;
}

/* ── 게스트 경고 모달 ───────────────────────── */
h3 {
  margin: 0 0 9px;
}
h3 + p {
  margin: 0;
  color: var(--c-muted);
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 860px) {
  .page { grid-template-columns: 1fr; }
  .visual { display: none; }
}
</style>
