<script setup lang="ts">
/** 시작(랜딩) 화면 — 좌: 떠오르는 게임 비주얼, 우: 진입 액션. */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { useSessionStore } from '@/stores/session'
import { ApiError, authApi } from '@/api'
import type { GuestResponse } from '@/api'
import BrandLogo from '@/components/common/BrandLogo.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import FloatStage from './components/FloatStage.vue'

const router = useRouter()
const session = useSessionStore()

const showGuestWarning = ref(false)
/** 게스트 시작이 호출 제한에 걸렸을 때의 안내. 비어 있으면 표시하지 않는다. */
const guestError = ref('')

const goAuth = (mode: 'login' | 'signup') =>
  router.push({ name: RouteName.Auth, query: { mode } })

const playAsGuest = () => {
  showGuestWarning.value = true
}

const confirmGuest = async () => {
  guestError.value = ''
  let res: GuestResponse | null = null
  try {
    // 서버 게스트 세션(JWT)·1인방 생성 — 이후 인증 API 호출에 필요 (명세 POST /auth/guest)
    res = await authApi.guest()
  } catch (e) {
    // 호출 제한에 걸린 것은 "서버가 잠깐 없는" 것과 다르다 — 그냥 진행시키면 토큰도 방도 없이
    // 게임 화면으로 들어가 전부 실패한다. 여기서 멈추고 왜 막혔는지 알린다.
    if (e instanceof ApiError && e.code === 'AUTH_GUEST_START_LIMIT_EXCEEDED') {
      guestError.value = '게스트 시작 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
      return
    }
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
      <div class="stars" aria-hidden="true">★ ✦</div>
      <div class="panel-topline">
        <BrandLogo subtitle="" title="MoToK" />
        <span class="online-pill"><i /> NOW PLAYING</span>
      </div>
      <p class="eyebrow">CAMERA ON · GAME ON</p>
      <h1>온몸으로 즐기는 ★<br />실시간 게임!</h1>
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
      <p v-if="guestError" class="guest-error">{{ guestError }}</p>
      <div class="modal-actions">
        <PixelButton block @click="showGuestWarning = false">취소</PixelButton>
        <PixelButton variant="guest" block @click="confirmGuest">계속하기</PixelButton>
      </div>
    </PixelModal>
  </main>
</template>

<style scoped>
.page {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(390px, 0.65fr);
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
.visual::before {
  content: 'MOTION\A ARCADE';
  position: absolute;
  right: 5%;
  bottom: 4%;
  z-index: 0;
  color: rgba(56, 38, 61, 0.08);
  font-size: clamp(30px, 4vw, 62px);
  font-weight: 700;
  line-height: .92;
  letter-spacing: -3px;
  white-space: pre;
  text-align: right;
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
  padding: clamp(32px, 6vw, 72px) clamp(28px, 5vw, 72px);
  background-color: #fff1df;
  background-image:
    radial-gradient(circle at 84% 14%, rgba(239, 104, 114, 0.24) 0 9%, transparent 9.3%),
    radial-gradient(circle at 12% 91%, rgba(255, 200, 61, 0.3) 0 11%, transparent 11.3%),
    radial-gradient(145deg, rgba(255, 255, 255, 0.78), transparent 42%),
    radial-gradient(rgba(56, 38, 61, 0.1) 1px, transparent 1.5px);
  background-size: auto, auto, 100% 100%, 18px 18px;
}
.panel-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.online-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-paper);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .8px;
  box-shadow: 2px 2px 0 var(--c-ink);
  white-space: nowrap;
}
.online-pill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-mint);
  box-shadow: 0 0 0 2px rgba(72, 200, 164, .2);
}
.eyebrow {
  margin: 34px 0 0 !important;
  color: var(--c-coral) !important;
  font-size: 10px !important;
  font-weight: 700;
  letter-spacing: 1.3px;
}
.panel h1 {
  max-width: 390px;
  font-size: clamp(30px, 3.1vw, 44px);
  line-height: 1.18;
  letter-spacing: -1.5px;
  margin: 13px 0;
}
.panel p {
  font-size: 13px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 23px;
}
.actions :deep(.px-btn:first-child) { grid-column: 1 / -1; }
.play-points {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 22px;
}
.play-points span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 57px;
  padding: 9px 10px;
  border: 2px solid rgba(56, 38, 61, .6);
  border-radius: 12px;
  background: rgba(255, 255, 255, .62);
  font-size: 9px;
  line-height: 1.35;
}
.play-points b {
  color: var(--c-violet);
  font-size: 10px;
  letter-spacing: .8px;
}
.guest-error {
  color: var(--c-danger, #c0392b);
  font-size: 12px;
  margin-top: 10px;
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
  .visual {
    min-height: 230px;
    border-right: 0;
    border-bottom: var(--border-thick);
  }
  .panel { min-height: auto; }
  .float-item { transform: scale(.78); transform-origin: bottom left; }
}
@media (max-width: 480px) {
  .visual { min-height: 178px; }
  .panel { padding: 28px 22px 34px; }
  .panel h1 { font-size: 31px; }
  .online-pill { font-size: 7px; }
  .eyebrow { margin-top: 25px !important; }
  .play-points { grid-template-columns: 1fr; }
  .actions { gap: 7px; }
  .actions :deep(.px-btn) { padding: 0 5px; font-size: 12px; }
}

/* Lobby-inspired start scene: a sky, wooden sign, grass and mascot rather than floating cards. */
.page {
  grid-template-columns: minmax(0, 1.16fr) minmax(400px, .84fr);
  background: #fff7e8;
}
.visual {
  isolation: isolate;
  min-height: 100vh;
  border-right: 3px solid #8d654b;
  background:
    linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px),
    linear-gradient(180deg, #bdeaff 0%, #dff5ef 72%, #e9d9a9 72%);
  background-size: 20px 20px, 20px 20px, 100% 100%;
}
.visual::before {
  content: '';
  inset: 0;
  right: auto;
  bottom: auto;
  z-index: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at 12% 16%, rgba(255,255,255,.62) 0 2%, transparent 2.2%);
  opacity: .9;
}
.visual::after { background: linear-gradient(90deg, transparent 58%, rgba(255,255,255,.26)); }
.sky-label {
  position: absolute;
  top: 8%;
  left: 8%;
  z-index: 1;
  color: rgba(67, 105, 122, .36);
  font-size: clamp(17px, 2vw, 29px);
  line-height: .95;
  letter-spacing: -1px;
}
.cloud {
  position: absolute;
  z-index: 1;
  width: clamp(110px, 15vw, 190px);
  opacity: .72;
  animation: cloud-drift 15s ease-in-out infinite;
}
.cloud-a { top: 10%; right: 11%; }
.cloud-b { top: 34%; left: 7%; width: clamp(84px, 11vw, 140px); animation-delay: -7s; }
.welcome-sign {
  position: absolute;
  top: 19%;
  left: 14%;
  z-index: 3;
  display: grid;
  gap: 5px;
  width: min(360px, 48%);
  padding: 18px 22px 17px;
  border: 4px solid #86593f;
  border-radius: 9px;
  background: #e7c996;
  box-shadow: inset 3px 3px 0 rgba(255,255,255,.38), inset -4px -5px 0 rgba(122,77,50,.18), 7px 7px 0 rgba(115,73,49,.42);
  color: #402d24;
  transform: rotate(-2deg);
}
.welcome-sign::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 14%;
  width: 16px;
  height: 95px;
  border: 4px solid #86593f;
  border-top: 0;
  background: #bd8558;
  box-shadow: 5px 0 0 rgba(115,73,49,.25);
}
.welcome-sign span { color: #a15f50; font-size: 10px; letter-spacing: 1.7px; }
.welcome-sign strong { font-size: clamp(25px, 3vw, 42px); letter-spacing: -1px; }
.welcome-sign small { color: #6b4c3d; font-size: 10px; line-height: 1.4; }
.cat-scene {
  position: absolute;
  right: 13%;
  bottom: 5%;
  z-index: 3;
  width: min(44vw, 390px);
  height: min(44vw, 390px);
}
.cat { position: absolute; right: 0; bottom: 0; width: 100%; height: 100%; object-fit: contain; }
.balloon { position: absolute; bottom: 88%; left: 7%; z-index: 2; width: 25%; animation: balloon-float 3.2s ease-in-out infinite; }
.balloon-string { position: absolute; bottom: 38%; left: 14%; z-index: 1; width: 7%; height: 58%; object-fit: fill; }
.heart { position: absolute; z-index: 3; top: 7%; right: 4%; width: 23%; animation: heart-pop 1.8s steps(2) infinite; }
.grass {
  position: absolute;
  inset: auto 0 -6px;
  z-index: 4;
  height: 74px;
  background-repeat: repeat-x;
  background-position: left bottom;
  background-size: auto 74px;
}
.panel {
  background-color: #fff7e8;
  background-image:
    radial-gradient(circle at 84% 14%, rgba(255, 210, 124, .34) 0 9%, transparent 9.3%),
    linear-gradient(135deg, rgba(255,255,255,.76), transparent 40%),
    repeating-linear-gradient(0deg, transparent 0 29px, rgba(164,120,79,.08) 30px 31px);
}
.online-pill { border-color: #a16d4c; color: #73513e; box-shadow: 2px 2px 0 #d4ad7d; }
.eyebrow { color: #bf7455 !important; }
.play-points span { border-color: #d6b88e; background: rgba(255,253,247,.82); }
.play-points b { color: #b87352; }
.actions :deep(.px-btn) { border-color: #925c47; border-radius: 7px; box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50; }
.actions :deep(.v-primary) { background: #ef6d70; }
.actions :deep(.v-secondary) { background: #f7d9a8; }
.actions :deep(.v-guest) { background: #d7e7ad; }
@keyframes cloud-drift { 0%,100% { transform: translateX(-7px); } 50% { transform: translateX(13px) translateY(-4px); } }
@keyframes balloon-float { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(2deg); } }
@keyframes heart-pop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
@media (max-width: 860px) {
  .visual { min-height: 310px; border-right: 0; border-bottom: 3px solid #8d654b; }
  .welcome-sign { top: 18%; left: 10%; width: min(340px, 48%); }
  .cat-scene { right: 10%; width: 280px; height: 280px; }
}
@media (max-width: 480px) {
  .visual { min-height: 255px; }
  .welcome-sign { top: 15%; padding: 12px 14px; }
  .welcome-sign strong { font-size: 25px; }
  .welcome-sign small { font-size: 8px; }
  .welcome-sign::after { height: 55px; }
  .cat-scene { right: 3%; width: 225px; height: 225px; }
  .grass { height: 54px; background-size: auto 54px; }
}

/* Keep the original game-card visual on the left; only the action panel adopts the lobby palette. */
.visual {
  min-height: 100%;
  border-right: var(--border-thick);
  border-bottom: 0;
  background-color: #dff5ed;
  background-image:
    radial-gradient(circle at 13% 16%, rgba(255, 200, 61, 0.82) 0 5%, transparent 5.3%),
    radial-gradient(circle at 84% 24%, rgba(154, 114, 216, 0.3) 0 13%, transparent 13.3%),
    radial-gradient(circle at 19% 82%, rgba(101, 121, 221, 0.24) 0 17%, transparent 17.3%),
    linear-gradient(90deg, rgba(56, 38, 61, 0.065) 1px, transparent 1px),
    linear-gradient(rgba(56, 38, 61, 0.065) 1px, transparent 1px);
  background-size: auto, auto, auto, 26px 26px, 26px 26px;
}
.visual::before { display: none; }
@media (max-width: 860px) {
  .visual { min-height: 230px; border-right: 0; border-bottom: var(--border-thick); }
}
@media (max-width: 480px) { .visual { min-height: 178px; } }

/* Keep the interaction lift while using the lobby's warm wood shadow. */
.actions :deep(.px-btn) {
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50;
}
.actions :deep(.px-btn:hover:not(:disabled)) {
  transform: translate(-2px, -2px);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 4px 4px 0 #a66b50;
}
.actions :deep(.px-btn:active:not(:disabled)) {
  transform: translate(2px, 2px);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.2), 2px 2px 0 #a66b50;
}
</style>
