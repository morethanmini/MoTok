<script setup lang="ts">
/** 마이페이지 — 프로필·포인트·포인트내역·내 전적 (API §2 /users/me, /users/me/points/history, /users/me/records). */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usersApi, type GameRecord, type PointHistory, type PointType, type UserProfile } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useUpload } from '@/composables/useUpload'
import { useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'
import PixelCard from '@/components/common/PixelCard.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'
import AppPage from '@/components/common/AppPage.vue'
import { RouteName } from '@/router/routeNames'
import AvatarPickerModal from './AvatarPickerModal.vue'

const router = useRouter()
const session = useSessionStore()

const MOCK_ME: UserProfile = {
  id: 1, email: 'play@motok.com', nickname: 'P1', role: 'USER',
  pointBalance: 1250, createdAt: '2025-07-01T00:00:00Z',
}
const MOCK_RECORDS: GameRecord[] = [
  { gameId: 1, gameName: '핑거 스타', playCount: 12, bestScore: 9850, rankNo: 3 },
  { gameId: 3, gameName: '리듬 펀치', playCount: 8, bestScore: 8420, rankNo: 7 },
  { gameId: 5, gameName: '포즈 매치', playCount: 5, bestScore: 7960, rankNo: 12 },
]
const MOCK_HISTORY: PointHistory[] = [
  { id: 3, amount: 300, type: 'GAME_REWARD', balanceAfter: 1250, createdAt: '2025-07-19T10:00:00Z' },
  { id: 2, amount: -500, type: 'SHOP_PURCHASE', balanceAfter: 950, createdAt: '2025-07-18T14:30:00Z' },
  { id: 1, amount: -100, type: 'AI_GENERATE', balanceAfter: 1450, createdAt: '2025-07-17T09:15:00Z' },
]
const POINT_TYPE_LABEL: Record<PointType, string> = {
  GAME_REWARD: '게임 보상',
  SHOP_PURCHASE: '상점 구매',
  AI_GENERATE: 'AI 생성',
  GUEST_MIGRATE: '게스트 이전',
}

const { data: me, reload: reloadMe } = useAsyncData(() => usersApi.getMe(), MOCK_ME)
const { data: records } = useAsyncData(() => usersApi.getRecords(), MOCK_RECORDS)
const { data: history } = useAsyncData(() => usersApi.getPointHistory(0, 20).then((p) => p.content), MOCK_HISTORY)

const fmtDate = (iso: string) => iso.slice(0, 10)

/**
 * 프로필 사진 변경.
 *
 * 업로드는 서버를 거치지 않는다 — presigned URL을 받아 브라우저가 S3로 직접 PUT하고,
 * 끝난 뒤 key만 서버에 알려 확정한다(useUpload 주석 참고).
 *
 * 표시할 URL은 서버가 준 me.avatarUrl 이 원본이고, localPreview 는 업로드 중에만 쓰는
 * 임시 미리보기다. 확정 후 프로필을 다시 불러오면서 미리보기를 버린다 —
 * 남겨 두면 새로고침 시 사라져서 "저장 안 된 것처럼" 보인다.
 *
 * 확정된 프로필은 세션 스토어에도 넣는다 — 헤더 아바타가 이 값을 보고 그리므로,
 * 안 넣으면 사진을 바꾸고 로비로 나갔을 때 헤더만 옛 사진인 채로 남는다.
 */
const { message: toast, flash } = useToast()
// error를 함께 받는다 — 용량 초과·형식 불일치는 서버에 가기 전에 여기서 걸리는데,
// 사유를 꺼내 보여주지 않으면 미리보기만 잠깐 떴다 사라져 "그냥 안 되는" 화면이 된다.
const { upload, uploading, error: uploadError } = useUpload('AVATAR')

const avatarInput = ref<HTMLInputElement | null>(null)
const localPreview = ref<string | null>(null)
const shownAvatar = computed(() => localPreview.value ?? me.value.avatarUrl ?? null)
/** 프로필 변경 팝업(기본 아이콘 고르기 + 사진 추가) */
const showPicker = ref(false)

function pickAvatar() {
  if (busy.value) return
  avatarInput.value?.click()
}

function clearPreview() {
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value)
    localPreview.value = null
  }
}

async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 같은 파일을 다시 골라도 change 가 발생하도록 값을 비운다(업로드 실패 후 재시도에 필요).
  input.value = ''
  if (!file) return

  clearPreview()
  localPreview.value = URL.createObjectURL(file)

  const key = await upload(file)
  if (!key) {
    clearPreview() // 실패했으면 원래 사진으로 되돌린다 — 바뀐 것처럼 보이면 안 된다
    flash(uploadError.value ?? '사진을 올리지 못했어요')
    return
  }

  try {
    syncSessionProfile(await usersApi.updateAvatar(key))
    await reloadMe()
    clearPreview()
    // 팝업에서 '사진 추가'로 들어왔을 수 있다. 성공했을 때만 닫는다 —
    // 실패하면 열어 둬야 다른 아이콘을 고르든 다시 올리든 이어서 할 수 있다.
    showPicker.value = false
    flash('프로필 사진을 변경했어요')
  } catch {
    clearPreview()
    flash('사진을 저장하지 못했어요')
  }
}

/** 서버가 확정한 프로필을 세션에 반영 — 헤더 등 다른 화면이 이 값을 본다. */
function syncSessionProfile(profile: UserProfile) {
  if (session.profile) session.profile = profile
}

/**
 * 기본 프로필 아이콘 선택. 업로드 경로와 달리 S3를 거치지 않는다 —
 * 서버에 파일명(preset)만 보내면 서버가 정적 경로를 붙여 저장한다.
 *
 * 이 전에 쓰던 업로드 사진이 있었다면 서버가 그 S3 객체를 지운다(UserService.deleteAfterCommit) —
 * 아이콘으로 바꿨다고 예전 사진을 버킷에 남겨 둘 이유가 없다.
 */
const savingPreset = ref<string | null>(null)
/** 업로드 중이거나 아이콘을 저장하는 동안은 아바타 관련 조작을 모두 막는다(중복 요청 방지). */
const busy = computed(() => uploading.value || savingPreset.value !== null)

async function choosePreset(preset: string) {
  if (busy.value) return
  savingPreset.value = preset
  try {
    syncSessionProfile(await usersApi.setAvatarPreset(preset))
    await reloadMe()
    clearPreview() // 올리다 만 미리보기가 남아 있으면 고른 아이콘이 안 보인다
    showPicker.value = false
    flash('기본 프로필로 변경했어요')
  } catch {
    flash('변경하지 못했어요')
  } finally {
    savingPreset.value = null
  }
}

async function removeAvatar() {
  if (busy.value || !me.value.avatarUrl) return
  try {
    syncSessionProfile(await usersApi.updateAvatar(null))
    await reloadMe()
    clearPreview()
    showPicker.value = false
    flash('기본 아바타로 변경했어요')
  } catch {
    flash('변경하지 못했어요')
  }
}
</script>

<template>
  <AppPage :title="`${me.nickname}님의 마이페이지`" :subtitle="me.email ?? '소셜 계정'" title-style="plain">
    <div class="grid">
      <!-- 프로필 -->
      <PixelCard title="프로필">
        <div class="profile">
          <!-- 아바타 자체가 '프로필 변경' 버튼이다. 사진 올리기는 팝업 안의 '사진 추가'로 들어간다 —
               여기서 파일 선택창을 바로 열면 기본 아이콘을 고를 길이 사라진다. -->
          <button
            class="avatar"
            :class="{ busy: uploading }"
            :disabled="busy"
            :title="uploading ? '올리는 중…' : '프로필 변경'"
            @click="showPicker = true"
          >
            <UserAvatar class="avatar-face" :src="shownAvatar" alt="내 프로필 사진" />
            <span class="avatar-edit" aria-hidden="true">{{ uploading ? '⏳' : '📷' }}</span>
          </button>
          <!-- accept 는 서버 UploadPurpose.AVATAR 의 허용 MIME 과 같게 유지한다.
               파일 선택창에서 미리 걸러 주는 편의일 뿐이고, 실제 방어는 서버·S3 서명이 한다. -->
          <input
            ref="avatarInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="avatar-input"
            @change="onAvatarChange"
          />
          <div class="info">
            <div class="nick">{{ me.nickname }}</div>
            <div class="meta">가입일 {{ fmtDate(me.createdAt) }} · {{ me.role }}</div>
          </div>
        </div>

        <div class="point">
          <span>보유 포인트</span>
          <b><CoinIcon :size="15" /> {{ me.pointBalance.toLocaleString() }}</b>
        </div>
        <div class="links">
          <PixelButton variant="yellow" block @click="router.push({ name: RouteName.Shop })">상점</PixelButton>
          <PixelButton variant="guest" block @click="router.push({ name: RouteName.Inventory })">인벤토리</PixelButton>
        </div>
      </PixelCard>

      <!-- 내 전적 -->
      <PixelCard title="내 전적">
        <template #head>
          <button class="more" @click="router.push({ name: RouteName.Ranking })">랭킹 보기 →</button>
        </template>
        <table class="records">
          <thead>
            <tr><th>게임</th><th>플레이</th><th>최고점수</th><th>순위</th></tr>
          </thead>
          <tbody>
            <!-- 같은 게임이라도 멀티/싱글 기록이 별개 행으로 온다(-97) — key에 mode까지 포함 -->
            <tr v-for="r in records" :key="`${r.gameId}-${r.mode ?? ''}`">
              <td>{{ r.gameName }}{{ r.mode === 'SOLO' ? ' (싱글)' : '' }}</td>
              <td>{{ r.playCount }}회</td>
              <td>{{ r.bestScore.toLocaleString() }}</td>
              <td>#{{ r.rankNo }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!records.length" class="empty">아직 게임 기록이 없어요.</p>
      </PixelCard>
    </div>

    <!-- 포인트 내역 -->
    <PixelCard title="포인트 내역" class="history-card">
      <table class="records">
        <thead>
          <tr><th>내역</th><th>변동</th><th>잔액</th><th>일시</th></tr>
        </thead>
        <tbody>
          <tr v-for="h in history" :key="h.id">
            <td>{{ POINT_TYPE_LABEL[h.type] }}</td>
            <td :class="h.amount >= 0 ? 'plus' : 'minus'">
              {{ h.amount >= 0 ? '+' : '' }}{{ h.amount.toLocaleString() }}
            </td>
            <td>{{ h.balanceAfter.toLocaleString() }}</td>
            <td>{{ fmtDate(h.createdAt) }}</td>
          </tr>
          <tr v-if="history.length === 0"><td colspan="4" class="empty">포인트 내역이 없어요</td></tr>
        </tbody>
      </table>
    </PixelCard>
    <AvatarPickerModal
      v-if="showPicker"
      :current="shownAvatar"
      :busy="busy"
      @close="showPicker = false"
      @select="choosePreset"
      @upload="pickAvatar"
      @clear="removeAvatar"
    />
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

.profile { display: flex; align-items: center; gap: 14px; }
.avatar {
  position: relative;
  width: 60px;
  height: 60px;
  border: var(--border);
  border-radius: var(--radius-md);
  background: var(--c-mint-soft);
  box-shadow: var(--shadow-sm);
  padding: 0;
  cursor: pointer;
}
/*
 * 사진 잘라내기는 안쪽 .avatar-face 가 맡는다.
 * 예전엔 .avatar 에 overflow:hidden 이 걸려 있어서, 모서리 바깥(-4px)에 놓인 카메라 배지가
 * 함께 잘려 반쪽만 보였다. 클리핑 대상과 배지를 같은 상자에 두면 안 된다.
 */
.avatar-face {
  width: 100%;
  height: 100%;
  /* 테두리(--border, 3px) 안쪽이므로 그만큼 작은 반지름이라야 모서리에 흰 틈이 생기지 않는다 */
  border-radius: calc(var(--radius-md) - 3px);
  font-size: 30px;
}
.avatar:disabled { cursor: default; }
/* 업로드 중임을 이미지 위에 표시 — 스피너를 따로 두지 않고 흐리게만 처리한다 */
.avatar.busy .avatar-face { opacity: 0.45; }
.avatar-edit {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  background: var(--c-yellow);
  /* 10px에서는 이모지가 뭉개져 무슨 아이콘인지 알아볼 수 없었다. line-height를 1로 눌러야
     이모지가 세로로 밀리지 않고 원 가운데에 앉는다. */
  font-size: 13px;
  line-height: 1;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.avatar-input { display: none; }

.nick { font-size: 16px; font-weight: 700; }
.meta { margin-top: 4px; font-size: 9px; color: var(--c-muted); }
.point {
  display: flex; align-items: center; justify-content: space-between;
  margin: 16px 0; padding: 12px 14px; border: 2px solid var(--c-ink); border-radius: 12px;
  background: #fff7d9; font-size: 11px;
}
.point b { color: #d79600; font-size: 15px; }
.links { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.more { margin-left: auto; border: 0; background: transparent; color: var(--c-blue); font-size: 10px; font-weight: 700; }
.records { width: 100%; border-collapse: collapse; font-size: 11px; }
.records th, .records td { padding: 9px 8px; text-align: left; border-bottom: 2px dashed #eaddea; }
.records th { font-size: 9px; color: var(--c-muted); }
.records td:last-child { color: var(--c-blue); font-weight: 700; }

.history-card { margin-top: 18px; }
.history-card .records td:last-child { color: var(--c-muted); font-weight: 400; }
.history-card .plus { color: #36a17f; font-weight: 700; }
.history-card .minus { color: var(--c-coral); font-weight: 700; }
.history-card .empty { text-align: center; color: var(--c-muted); }
.empty { margin: 10px 0 4px; text-align: center; font-size: 11px; color: var(--c-muted); }
</style>
