<script setup lang="ts">
/** 마이페이지 — 프로필·포인트·포인트내역·내 전적 (API §2 /users/me, /users/me/points/history, /users/me/records). */
import { useRouter } from 'vue-router'
import { usersApi, type GameRecord, type PointHistory, type PointType, type UserProfile } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { RouteName } from '@/router/routeNames'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import CoinIcon from '@/components/common/CoinIcon.vue'

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

const { data: me } = useAsyncData(() => usersApi.getMe(), MOCK_ME)
const { data: records } = useAsyncData(() => usersApi.getRecords(), MOCK_RECORDS)
const { data: history } = useAsyncData(() => usersApi.getPointHistory(0, 20).then((p) => p.content), MOCK_HISTORY)

const fmtDate = (iso: string) => iso.slice(0, 10)
</script>

<template>
  <AppPage title="마이페이지" :subtitle="me.email ?? '소셜 계정'">
    <template #actions>
      <PixelButton @click="router.push({ name: RouteName.AccountSettings })">계정 설정</PixelButton>
    </template>

    <template #hero>
      <section class="profile-hero"><img src="/assets/intro/person.png" alt="내 모션 캐릭터" /><div><span class="px-kicker">MY MOTOK</span><h2>{{ me.nickname }}님의 플레이 공간</h2><p>기록을 확인하고 나만의 화면을 완성해보세요.</p></div><b>★ {{ records.reduce((sum, r) => sum + r.playCount, 0) }} PLAY</b></section>
    </template>
    <div class="grid">
      <!-- 프로필 -->
      <PixelCard title="프로필">
        <div class="profile">
          <div class="avatar">😎</div>
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
  </AppPage>
</template>

<style scoped>
.profile-hero { height: 145px; margin-bottom: 18px; padding: 14px 24px; display: flex; align-items: center; gap: 20px; overflow: hidden; border: var(--border); border-radius: 21px; background: linear-gradient(115deg, #cff4e7, #fff0b9); box-shadow: var(--shadow-lg); }
.profile-hero img { width: 145px; transform: translateY(17px); } .profile-hero h2 { margin: 10px 0 5px; font-size: 18px; } .profile-hero p { margin: 0; color: var(--c-muted); font-size: 9px; } .profile-hero > b { margin-left: auto; padding: 10px 12px; border: 2px solid var(--c-ink); border-radius: 11px; background: #fff; box-shadow: var(--shadow-sm); font-size: 10px; }
.grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

.profile { display: flex; align-items: center; gap: 14px; }
.avatar { width: 60px; height: 60px; display: grid; place-items: center; border: var(--border); border-radius: var(--radius-md); background: var(--c-mint-soft); box-shadow: var(--shadow-sm); font-size: 30px; }
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
