<script setup lang="ts">
/**
 * 관리자 대시보드 (API §10) — 신고 유저·제재 이력·게임 노출·감사 로그.
 * 접근 제어(role=ADMIN)는 라우터 가드/서버에서 검증. 여기서는 화면 초안만.
 */
import { onMounted, ref, watch } from 'vue'
import {
  adminApi,
  adminChatReportsApi,
  adminUserReportsApi,
  gamesApi,
  ApiError,
  type AuditLog,
  type ChatReportDetail,
  type ChatReportListResponse,
  type ChatReportReason,
  type ChatReportStatus,
  type Game,
  type Sanction,
  type SanctionType,
  type UserReportListResponse,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const { message: toast, flash } = useToast()

// 목 데이터 없음 — 없는 걸 있는 것처럼 보여 주면 "백엔드가 붙었는데 왜 안 뜨지"를 판단할 수 없다.
// 아직 서버가 없는 구역(제재·감사 로그·게임 토글·곡 등록)은 화면에서 그렇다고 밝힌다.
const tab = ref<'chat-reports' | 'reports' | 'sanctions' | 'audit' | 'games'>('chat-reports')
const { data: sanctions, error: sanctionsError } = useAsyncData<Sanction[]>(() => adminApi.sanctions(), [])
const { data: audit, error: auditError } = useAsyncData<AuditLog[]>(() => adminApi.auditLogs(), [])
const { data: games, error: gamesError } = useAsyncData<Game[]>(() => gamesApi.list(), [])

const SANCTION_LABEL: Record<SanctionType, string> = {
  WARNING: '경고', SUSPENSION: '일시정지', PERMANENT_BAN: '영구정지',
}

// ── 채팅 신고 (v0.2.17, S15P11A706-133 — 백엔드 구현 완료, mock 없음) ──
const REASON_LABEL: Record<ChatReportReason, string> = {
  ABUSE: '욕설·비방', HATE: '혐오·차별', SEXUAL: '음란·성희롱', SPAM: '도배·광고', ETC: '기타',
}
const STATUS_LABEL: Record<ChatReportStatus, string> = {
  RECEIVED: '접수', REVIEWING: '검토 중', RESOLVED: '조치 완료', REJECTED: '기각',
}

const chatReportStatusFilter = ref<ChatReportStatus | ''>('')
const chatReportPage = ref(0)
const chatReports = ref<ChatReportListResponse | null>(null)
const chatReportsError = ref('')
const chatReportDetail = ref<ChatReportDetail | null>(null)
const chatReportBusy = ref(false)

async function loadChatReports() {
  chatReportsError.value = ''
  try {
    chatReports.value = await adminChatReportsApi.list({
      status: chatReportStatusFilter.value || undefined,
      page: chatReportPage.value,
      size: 20,
    })
  } catch (e) {
    chatReports.value = null
    chatReportsError.value = e instanceof ApiError ? e.message : '목록을 불러오지 못했어요'
  }
}
onMounted(loadChatReports)
watch([chatReportStatusFilter, chatReportPage], loadChatReports)

async function openChatReport(id: number) {
  try {
    chatReportDetail.value = await adminChatReportsApi.detail(id)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '상세를 불러오지 못했어요')
  }
}

/** 상태 전이 — 성공 시 상세·목록 모두 갱신해 화면과 서버 상태를 맞춘다. */
async function setChatReportStatus(status: Exclude<ChatReportStatus, 'RECEIVED'>) {
  const target = chatReportDetail.value
  if (!target || chatReportBusy.value) return
  chatReportBusy.value = true
  try {
    await adminChatReportsApi.updateStatus(target.id, status)
    chatReportDetail.value = { ...target, status }
    flash(`#${target.id} — ${STATUS_LABEL[status]} 처리`)
    await loadChatReports()
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '상태 변경에 실패했어요')
  } finally {
    chatReportBusy.value = false
  }
}

// ── 사용자 신고 (-112) ──────────────────────────────────
// 채팅 신고와 같은 계열이지만 상세 조회가 없다 — "누가 누구를 왜 신고했다"가 목록 행에 다 들어간다.
const userReportStatusFilter = ref<ChatReportStatus | ''>('')
const userReportPage = ref(0)
const userReports = ref<UserReportListResponse | null>(null)
const userReportsError = ref('')
/** 처리 중인 신고 id — 같은 행을 연타해 상태 전이가 겹치는 걸 막는다. */
const userReportBusy = ref<number | null>(null)

async function loadUserReports() {
  userReportsError.value = ''
  try {
    userReports.value = await adminUserReportsApi.list({
      status: userReportStatusFilter.value || undefined,
      page: userReportPage.value,
      size: 20,
    })
  } catch (e) {
    userReports.value = null
    userReportsError.value = e instanceof ApiError ? e.message : '목록을 불러오지 못했어요'
  }
}
onMounted(loadUserReports)
watch([userReportStatusFilter, userReportPage], loadUserReports)

async function setUserReportStatus(id: number, status: Exclude<ChatReportStatus, 'RECEIVED'>) {
  if (userReportBusy.value !== null) return
  userReportBusy.value = id
  try {
    await adminUserReportsApi.updateStatus(id, status)
    flash(`#${id} — ${STATUS_LABEL[status]} 처리`)
    await loadUserReports()
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '상태 변경에 실패했어요')
  } finally {
    userReportBusy.value = null
  }
}

// 게임 노출 토글 (PATCH /admin/games/{gameId})
// 서버가 받아들였을 때만 화면을 바꾼다 — 실패했는데 토글이 넘어가면 숨긴 줄 알았던 게임이 그대로 노출된다.
async function toggleGame(g: Game) {
  const next = !g.playable
  try {
    await adminApi.toggleGame(g.id, next)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '게임 노출을 바꾸지 못했어요')
    return
  }
  g.playable = next
  flash(`${g.name} — ${next ? '노출' : '숨김'} 처리`)
}

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <AppPage title="관리자 대시보드" subtitle="신고·제재·게임 노출·감사 로그">
    <div class="tabs">
      <button :class="{ on: tab === 'chat-reports' }" @click="tab = 'chat-reports'">채팅 신고</button>
      <button :class="{ on: tab === 'reports' }" @click="tab = 'reports'">사용자 신고</button>
      <button :class="{ on: tab === 'sanctions' }" @click="tab = 'sanctions'">제재 이력</button>
      <button :class="{ on: tab === 'audit' }" @click="tab = 'audit'">감사 로그</button>
      <button :class="{ on: tab === 'games' }" @click="tab = 'games'">게임 노출</button>
    </div>

    <!-- 채팅 신고 (v0.2.17, -133) -->
    <PixelCard v-if="tab === 'chat-reports'" title="채팅 신고 접수함">
      <div class="cr-filter">
        <label>
          상태
          <select v-model="chatReportStatusFilter">
            <option value="">전체</option>
            <option value="RECEIVED">접수</option>
            <option value="REVIEWING">검토 중</option>
            <option value="RESOLVED">조치 완료</option>
            <option value="REJECTED">기각</option>
          </select>
        </label>
        <span v-if="chatReports" class="cr-total">총 {{ chatReports.totalElements }}건</span>
      </div>
      <p v-if="chatReportsError" class="cr-empty">{{ chatReportsError }}</p>
      <p v-else-if="chatReports && !chatReports.reports.length" class="cr-empty">해당 상태의 신고가 없어요</p>
      <table v-else-if="chatReports" class="tbl">
        <thead><tr><th>#</th><th>방</th><th>신고자 → 피신고자</th><th>사유</th><th>신고된 메시지</th><th>상태</th><th>신고 일시</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in chatReports.reports" :key="r.id">
            <td>{{ r.id }}</td>
            <td>{{ r.roomId }}</td>
            <td>{{ r.reporterNickname }} → <b>{{ r.reportedNickname }}</b></td>
            <td>{{ REASON_LABEL[r.reason] }}</td>
            <td class="cr-text">{{ r.reportedText }}</td>
            <td><span class="cr-status" :class="r.status.toLowerCase()">{{ STATUS_LABEL[r.status] }}</span></td>
            <td>{{ fmt(r.createdAt) }}</td>
            <td class="acts"><PixelButton @click="openChatReport(r.id)">상세</PixelButton></td>
          </tr>
        </tbody>
      </table>
      <div v-if="chatReports && chatReports.totalPages > 1" class="cr-pager">
        <PixelButton :disabled="chatReportPage === 0" @click="chatReportPage--">이전</PixelButton>
        <span>{{ chatReportPage + 1 }} / {{ chatReports.totalPages }}</span>
        <PixelButton :disabled="chatReportPage >= chatReports.totalPages - 1" @click="chatReportPage++">다음</PixelButton>
      </div>
    </PixelCard>

    <!-- 사용자 신고 (-112) -->
    <PixelCard v-else-if="tab === 'reports'" title="사용자 신고 접수함">
      <div class="cr-filter">
        <label>
          상태
          <select v-model="userReportStatusFilter">
            <option value="">전체</option>
            <option value="RECEIVED">접수</option>
            <option value="REVIEWING">검토 중</option>
            <option value="RESOLVED">조치 완료</option>
            <option value="REJECTED">기각</option>
          </select>
        </label>
        <span v-if="userReports" class="cr-total">총 {{ userReports.totalElements }}건</span>
      </div>
      <p v-if="userReportsError" class="cr-empty">{{ userReportsError }}</p>
      <p v-else-if="userReports && !userReports.reports.length" class="cr-empty">해당 상태의 신고가 없어요</p>
      <table v-else-if="userReports" class="tbl">
        <thead><tr><th>#</th><th>신고자 → 피신고자</th><th>사유</th><th>직접 입력</th><th>상태</th><th>신고 일시</th><th>처리</th></tr></thead>
        <tbody>
          <tr v-for="r in userReports.reports" :key="r.id">
            <td>{{ r.id }}</td>
            <td>{{ r.reporterNickname }} → <b>{{ r.reportedNickname }}</b></td>
            <td>{{ REASON_LABEL[r.reason] }}</td>
            <td class="cr-text">{{ r.reasonDetail ?? '—' }}</td>
            <td><span class="cr-status" :class="r.status.toLowerCase()">{{ STATUS_LABEL[r.status] }}</span></td>
            <td>{{ fmt(r.createdAt) }}</td>
            <td class="acts">
              <!-- 이미 그 상태면 눌러 봐야 같은 값이라 잠근다(RECEIVED로 되돌리기는 서버가 막는다) -->
              <PixelButton
                :disabled="userReportBusy !== null || r.status === 'REVIEWING'"
                @click="setUserReportStatus(r.id, 'REVIEWING')"
              >검토</PixelButton>
              <PixelButton
                variant="mint"
                :disabled="userReportBusy !== null || r.status === 'RESOLVED'"
                @click="setUserReportStatus(r.id, 'RESOLVED')"
              >조치</PixelButton>
              <PixelButton
                variant="secondary"
                :disabled="userReportBusy !== null || r.status === 'REJECTED'"
                @click="setUserReportStatus(r.id, 'REJECTED')"
              >기각</PixelButton>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="userReports && userReports.totalPages > 1" class="cr-pager">
        <PixelButton :disabled="userReportPage === 0" @click="userReportPage--">이전</PixelButton>
        <span>{{ userReportPage + 1 }} / {{ userReports.totalPages }}</span>
        <PixelButton :disabled="userReportPage >= userReports.totalPages - 1" @click="userReportPage++">다음</PixelButton>
      </div>
    </PixelCard>

    <!-- 제재 이력 -->
    <PixelCard v-else-if="tab === 'sanctions'" title="제재 이력">
      <p v-if="sanctionsError" class="cr-empty">{{ sanctionsError }} · 제재 API는 아직 서버에 없어요</p>
      <p v-else-if="!sanctions.length" class="cr-empty">제재 이력이 없어요</p>
      <table v-else class="tbl">
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
    <PixelCard v-else-if="tab === 'audit'" title="감사 로그">
      <p v-if="auditError" class="cr-empty">{{ auditError }} · 감사 로그 API는 아직 서버에 없어요</p>
      <p v-else-if="!audit.length" class="cr-empty">감사 로그가 없어요</p>
      <table v-else class="tbl">
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

    <!-- 게임 노출 -->
    <PixelCard v-else-if="tab === 'games'" title="게임 노출 관리">
      <p v-if="gamesError" class="cr-empty">{{ gamesError }}</p>
      <p v-else-if="!games.length" class="cr-empty">등록된 게임이 없어요</p>
      <table v-else class="tbl">
        <thead><tr><th>게임</th><th>분류</th><th>인원</th><th>노출</th></tr></thead>
        <tbody>
          <tr v-for="g in games" :key="g.id">
            <td>{{ g.name }}</td>
            <td>{{ g.category }}</td>
            <td>{{ g.minPlayers }}~{{ g.maxPlayers }}인</td>
            <td class="acts">
              <span class="state" :class="{ off: !g.playable }">{{ g.playable ? '노출 중' : '숨김' }}</span>
              <PixelButton :variant="g.playable ? 'secondary' : 'mint'" @click="toggleGame(g)">
                {{ g.playable ? '숨기기' : '노출' }}
              </PixelButton>
            </td>
          </tr>
        </tbody>
      </table>
    </PixelCard>

    <!-- 채팅 신고 상세 — 스냅샷을 시간순으로 렌더링해 채팅창을 복원하고, 신고 대상을 하이라이트한다 -->
    <PixelModal v-if="chatReportDetail" @close="chatReportDetail = null">
      <h3 class="cr-detail-title">
        🚩 신고 #{{ chatReportDetail.id }}
        <span class="cr-status" :class="chatReportDetail.status.toLowerCase()">{{ STATUS_LABEL[chatReportDetail.status] }}</span>
      </h3>
      <div class="cr-meta">
        <p><b>방</b> {{ chatReportDetail.roomId }} · <b>신고 일시</b> {{ fmt(chatReportDetail.createdAt) }}</p>
        <p><b>신고자</b> {{ chatReportDetail.reporterNickname }} (#{{ chatReportDetail.reporterUserId }})
          → <b>피신고자</b> {{ chatReportDetail.reportedNickname }} (#{{ chatReportDetail.reportedUserId }})</p>
        <p><b>사유</b> {{ REASON_LABEL[chatReportDetail.reason] }}<template v-if="chatReportDetail.reasonDetail"> — {{ chatReportDetail.reasonDetail }}</template></p>
      </div>
      <p class="cr-context-label">전후 대화 맥락 ({{ chatReportDetail.context.length }}건)</p>
      <div class="cr-context">
        <div
          v-for="c in chatReportDetail.context"
          :key="c.chatId"
          class="cr-line"
          :class="{ target: c.chatId === chatReportDetail.chatId, suggest: c.type === 'GAME_SUGGEST' }"
        >
          <span class="cr-line-name">{{ c.type === 'GAME_SUGGEST' ? '🎮 ' : '' }}{{ c.nickname }}</span>
          <span class="cr-line-text">{{ c.text }}</span>
          <span class="cr-line-time">{{ fmt(c.sentAt) }}</span>
        </div>
      </div>
      <div class="leave-actions cr-actions">
        <PixelButton :disabled="chatReportBusy || chatReportDetail.status === 'REVIEWING'" @click="setChatReportStatus('REVIEWING')">검토 시작</PixelButton>
        <PixelButton variant="mint" :disabled="chatReportBusy || chatReportDetail.status === 'RESOLVED'" @click="setChatReportStatus('RESOLVED')">조치 완료</PixelButton>
        <PixelButton variant="secondary" :disabled="chatReportBusy || chatReportDetail.status === 'REJECTED'" @click="setChatReportStatus('REJECTED')">기각</PixelButton>
      </div>
    </PixelModal>

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
.acts { display: flex; gap: 6px; align-items: center; }
.acts :deep(.px-btn) { height: 32px; padding: 0 10px; font-size: 10px; }
.state { font-size: 10px; font-weight: 700; color: #36a17f; }
.state.off { color: var(--c-muted); }

/* 채팅 신고 */
.cr-filter { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 10px; font-weight: 700; color: var(--c-muted); }
.cr-filter select { height: 34px; padding: 0 8px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; font-size: 11px; margin-left: 6px; }
.cr-total { margin-left: auto; }
.cr-empty { padding: 24px 0; text-align: center; font-size: 11px; color: var(--c-muted); }
.cr-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-status { font-size: 9px; font-weight: 700; padding: 3px 7px; border-radius: 7px; border: 1.5px solid var(--c-ink); background: #fff; }
.cr-status.received { background: var(--c-yellow); }
.cr-status.reviewing { background: #cfe8ff; }
.cr-status.resolved { background: #c9f2dd; }
.cr-status.rejected { background: #eee; color: var(--c-muted); }
.cr-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; font-size: 11px; }
.cr-detail-title { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 14px; }
.cr-meta { font-size: 11px; display: grid; gap: 4px; margin-bottom: 12px; }
.cr-context-label { font-size: 10px; font-weight: 700; color: var(--c-muted); margin-bottom: 6px; }
.cr-context { max-height: 260px; overflow-y: auto; display: grid; gap: 4px; border: 2px dashed #eaddea; border-radius: var(--radius-sm); padding: 10px; margin-bottom: 14px; }
.cr-line { display: flex; gap: 8px; align-items: baseline; font-size: 11px; padding: 4px 6px; border-radius: 7px; }
.cr-line.target { background: var(--c-yellow); border: 1.5px solid var(--c-ink); font-weight: 700; }
.cr-line.suggest { color: #7c5ec4; }
.cr-line-name { font-weight: 700; flex-shrink: 0; }
.cr-line-text { flex: 1; min-width: 0; word-break: break-all; }
.cr-line-time { font-size: 9px; color: var(--c-muted); flex-shrink: 0; }
.cr-actions { display: flex; gap: 8px; }

</style>
