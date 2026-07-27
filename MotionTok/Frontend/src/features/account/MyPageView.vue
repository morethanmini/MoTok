<script setup lang="ts">
/** 마이페이지 — 프로필·포인트·포인트내역·내 전적 (API §2 /users/me, /users/me/points/history, /users/me/records). */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usersApi, type GameRecord, type PointHistory, type PointType, type UserProfile } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useUpload } from '@/composables/useUpload'
import { useToast } from '@/composables/useToast'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'
import AppPage from '@/components/common/AppPage.vue'
import { RouteName } from '@/router/routeNames'

const router = useRouter()

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
 */
const { message: toast, flash } = useToast()
const { upload, uploading } = useUpload('AVATAR')

const avatarInput = ref<HTMLInputElement | null>(null)
const localPreview = ref<string | null>(null)
const shownAvatar = computed(() => localPreview.value ?? me.value.avatarUrl ?? null)

function pickAvatar() {
  if (uploading.value) return
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
    return
  }

  try {
    await usersApi.updateAvatar(key)
    await reloadMe()
    clearPreview()
    flash('프로필 사진을 변경했어요')
  } catch {
    clearPreview()
    flash('사진을 저장하지 못했어요')
  }
}

async function removeAvatar() {
  if (uploading.value || !me.value.avatarUrl) return
  try {
    await usersApi.updateAvatar(null)
    await reloadMe()
    clearPreview()
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
          <button
            class="avatar"
            :class="{ busy: uploading }"
            :disabled="uploading"
            :title="uploading ? '올리는 중…' : '프로필 사진 변경'"
            @click="pickAvatar"
          >
            <img v-if="shownAvatar" :src="shownAvatar" alt="내 프로필 사진" />
            <template v-else>😎</template>
            <span class="avatar-edit">{{ uploading ? '⏳' : '📷' }}</span>
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
            <button v-if="me.avatarUrl" class="avatar-remove" :disabled="uploading" @click="removeAvatar">
              사진 삭제
            </button>
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
            <tr v-for="r in records" :key="r.gameId">
              <td>{{ r.gameName }}</td>
              <td>{{ r.playCount }}회</td>
              <td>{{ r.bestScore.toLocaleString() }}</td>
              <td>#{{ r.rankNo }}</td>
            </tr>
          </tbody>
        </table>
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
  display: grid;
  place-items: center;
  border: var(--border);
  border-radius: var(--radius-md);
  background: var(--c-mint-soft);
  box-shadow: var(--shadow-sm);
  font-size: 30px;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar:disabled { cursor: default; }
/* 업로드 중임을 이미지 위에 표시 — 스피너를 따로 두지 않고 흐리게만 처리한다 */
.avatar.busy img { opacity: 0.45; }
.avatar-remove {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 9px;
  color: var(--c-muted);
  text-decoration: underline;
  cursor: pointer;
}
.avatar-remove:disabled { cursor: default; opacity: 0.5; }
.avatar-edit {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  background: var(--c-yellow);
  font-size: 10px;
  box-shadow: var(--shadow-sm);
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
</style>
