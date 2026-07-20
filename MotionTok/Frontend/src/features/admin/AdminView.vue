<script setup lang="ts">
/**
 * 관리자 대시보드 (API §10) — 신고 유저·제재 이력·게임 노출·감사 로그.
 * 접근 제어(role=ADMIN)는 라우터 가드/서버에서 검증. 여기서는 화면 초안만.
 */
import { ref } from 'vue'
import {
  adminApi,
  ApiError,
  type AuditLog,
  type ReportedUser,
  type Sanction,
  type SanctionType,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const { message: toast, flash } = useToast()

const MOCK_REPORTED: ReportedUser[] = [
  { userId: 42, nickname: '트롤러', reportCount: 7, recentReasons: ['욕설', '방해'] },
  { userId: 51, nickname: '스팸봇', reportCount: 4, recentReasons: ['광고'] },
]
const MOCK_SANCTIONS: Sanction[] = [
  { id: 1, userId: 42, adminId: 1, type: 'SUSPENSION', startsAt: '2025-07-15T00:00:00Z', endsAt: '2025-07-22T00:00:00Z' },
]
const MOCK_AUDIT: AuditLog[] = [
  { id: 1, adminId: 1, action: 'SANCTION_APPLY', targetType: 'USER', targetId: 42, detail: '일시정지 7일', createdAt: '2025-07-15T09:00:00Z' },
  { id: 2, adminId: 1, action: 'GAME_TOGGLE', targetType: 'GAME', targetId: 6, detail: '드로잉 릴레이 비활성화', createdAt: '2025-07-16T11:00:00Z' },
]

const tab = ref<'reports' | 'sanctions' | 'audit'>('reports')
const { data: reported } = useAsyncData(() => adminApi.reports(), MOCK_REPORTED)
const { data: sanctions } = useAsyncData(() => adminApi.sanctions(), MOCK_SANCTIONS)
const { data: audit } = useAsyncData(() => adminApi.auditLogs(), MOCK_AUDIT)

const SANCTION_LABEL: Record<SanctionType, string> = {
  WARNING: '경고', SUSPENSION: '일시정지', PERMANENT_BAN: '영구정지',
}

async function sanction(user: ReportedUser, type: SanctionType) {
  try {
    await adminApi.applySanction({ userId: user.userId, type, reason: '관리자 제재' })
    flash(`${user.nickname} — ${SANCTION_LABEL[type]} 적용`)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '제재 적용 실패 (백엔드 미연동)')
  }
}
const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <AppPage title="관리자 대시보드" subtitle="신고·제재·게임 노출·감사 로그">
    <div class="tabs">
      <button :class="{ on: tab === 'reports' }" @click="tab = 'reports'">신고 유저</button>
      <button :class="{ on: tab === 'sanctions' }" @click="tab = 'sanctions'">제재 이력</button>
      <button :class="{ on: tab === 'audit' }" @click="tab = 'audit'">감사 로그</button>
    </div>

    <!-- 신고 유저 -->
    <PixelCard v-if="tab === 'reports'" title="누적 신고 유저">
      <table class="tbl">
        <thead><tr><th>닉네임</th><th>누적</th><th>최근 사유</th><th>제재</th></tr></thead>
        <tbody>
          <tr v-for="u in reported" :key="u.userId">
            <td>{{ u.nickname }}</td>
            <td class="warn">{{ u.reportCount }}회</td>
            <td>{{ u.recentReasons.join(', ') }}</td>
            <td class="acts">
              <PixelButton @click="sanction(u, 'WARNING')">경고</PixelButton>
              <PixelButton variant="yellow" @click="sanction(u, 'SUSPENSION')">정지</PixelButton>
              <PixelButton variant="primary" @click="sanction(u, 'PERMANENT_BAN')">영구</PixelButton>
            </td>
          </tr>
        </tbody>
      </table>
    </PixelCard>

    <!-- 제재 이력 -->
    <PixelCard v-else-if="tab === 'sanctions'" title="제재 이력">
      <table class="tbl">
        <thead><tr><th>대상 ID</th><th>유형</th><th>시작</th><th>종료</th></tr></thead>
        <tbody>
          <tr v-for="s in sanctions" :key="s.id">
            <td>#{{ s.userId }}</td>
            <td>{{ SANCTION_LABEL[s.type] }}</td>
            <td>{{ fmt(s.startsAt) }}</td>
            <td>{{ s.endsAt ? fmt(s.endsAt) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </PixelCard>

    <!-- 감사 로그 -->
    <PixelCard v-else title="감사 로그">
      <table class="tbl">
        <thead><tr><th>행위</th><th>대상</th><th>상세</th><th>시각</th></tr></thead>
        <tbody>
          <tr v-for="a in audit" :key="a.id">
            <td>{{ a.action }}</td>
            <td>{{ a.targetType }} #{{ a.targetId }}</td>
            <td>{{ a.detail }}</td>
            <td>{{ fmt(a.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </PixelCard>

    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { height: 40px; padding: 0 16px; border: 2px solid var(--c-ink); border-radius: 11px; background: #fff; font-size: 11px; }
.tabs button.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.tbl th, .tbl td { padding: 10px 8px; text-align: left; border-bottom: 2px dashed #eaddea; vertical-align: middle; }
.tbl th { font-size: 9px; color: var(--c-muted); }
.warn { color: var(--c-coral); font-weight: 700; }
.acts { display: flex; gap: 6px; }
.acts :deep(.px-btn) { height: 32px; padding: 0 10px; font-size: 10px; }
</style>
