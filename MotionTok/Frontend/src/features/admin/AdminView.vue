<script setup lang="ts">
/**
 * 관리자 대시보드 (API §10) — 신고 유저·제재 이력·게임 노출·감사 로그.
 * 접근 제어(role=ADMIN)는 라우터 가드/서버에서 검증. 여기서는 화면 초안만.
 */
import { onMounted, ref, watch } from 'vue'
import {
  adminApi,
  adminChatReportsApi,
  gamesApi,
  ApiError,
  type AuditLog,
  type ChatReportDetail,
  type ChatReportListResponse,
  type ChatReportReason,
  type ChatReportStatus,
  type Game,
  type ReportedUser,
  type Sanction,
  type SanctionType,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelModal from '@/components/common/PixelModal.vue'
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

const MOCK_GAMES: Game[] = [
  { id: 1, name: '핑거 스타', description: '', mode: 'SOLO', minPlayers: 1, maxPlayers: 1, supportsBot: false, category: '리듬', thumbnailUrl: '', playable: true },
  { id: 6, name: '드로잉 릴레이', description: '', mode: 'COOP', minPlayers: 2, maxPlayers: 4, supportsBot: false, category: '드로잉', thumbnailUrl: '', playable: false },
]

const tab = ref<'chat-reports' | 'reports' | 'sanctions' | 'audit' | 'games' | 'songs'>('chat-reports')
const { data: reported } = useAsyncData(() => adminApi.reports(), MOCK_REPORTED)
const { data: sanctions } = useAsyncData(() => adminApi.sanctions(), MOCK_SANCTIONS)
const { data: audit } = useAsyncData(() => adminApi.auditLogs(), MOCK_AUDIT)
const { data: games } = useAsyncData(() => gamesApi.list(), MOCK_GAMES)

const SANCTION_LABEL: Record<SanctionType, string> = {
  WARNING: '경고', SUSPENSION: '일시정지', PERMANENT_BAN: '영구정지',
}

// ── 채팅 신고 (v0.2.16, S15P11A706-133 — 백엔드 구현 완료, mock 없음) ──
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

async function sanction(user: ReportedUser, type: SanctionType) {
  try {
    await adminApi.applySanction({ userId: user.userId, type, reason: '관리자 제재' })
    flash(`${user.nickname} — ${SANCTION_LABEL[type]} 적용`)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '제재 적용 실패 (백엔드 미연동)')
  }
}

// 게임 노출 토글 (PATCH /admin/games/{gameId})
async function toggleGame(g: Game) {
  const next = !g.playable
  try {
    await adminApi.toggleGame(g.id, next)
  } catch (e) {
    if (e instanceof ApiError) flash(e.message)
  }
  g.playable = next
  flash(`${g.name} — ${next ? '노출' : '숨김'} 처리`)
}

// 곡 등록 (POST /admin/songs)
const songForm = ref({ title: '', artist: '', audioUrl: '', durationSec: 0 })
async function registerSong() {
  const { title, artist, audioUrl, durationSec } = songForm.value
  if (!title.trim() || !audioUrl.trim()) return flash('제목과 오디오 URL은 필수예요')
  try {
    await adminApi.registerSong({
      title: title.trim(),
      artist: artist.trim() || undefined,
      audioUrl: audioUrl.trim(),
      durationSec: durationSec || undefined,
    })
    flash(`"${title}" 곡을 등록했어요`)
    songForm.value = { title: '', artist: '', audioUrl: '', durationSec: 0 }
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '곡 등록 실패 (백엔드 미연동)')
  }
}

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <AppPage title="관리자 대시보드" subtitle="신고·제재·게임 노출·감사 로그">
    <div class="tabs">
      <button :class="{ on: tab === 'chat-reports' }" @click="tab = 'chat-reports'">채팅 신고</button>
      <button :class="{ on: tab === 'reports' }" @click="tab = 'reports'">신고 유저</button>
      <button :class="{ on: tab === 'sanctions' }" @click="tab = 'sanctions'">제재 이력</button>
      <button :class="{ on: tab === 'audit' }" @click="tab = 'audit'">감사 로그</button>
      <button :class="{ on: tab === 'games' }" @click="tab = 'games'">게임 노출</button>
      <button :class="{ on: tab === 'songs' }" @click="tab = 'songs'">곡 등록</button>
    </div>

    <!-- 채팅 신고 (v0.2.16, -133) -->
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

    <!-- 신고 유저 -->
    <PixelCard v-else-if="tab === 'reports'" title="누적 신고 유저">
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
    <PixelCard v-else-if="tab === 'audit'" title="감사 로그">
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

    <!-- 게임 노출 -->
    <PixelCard v-else-if="tab === 'games'" title="게임 노출 관리">
      <table class="tbl">
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

    <!-- 곡 등록 -->
    <PixelCard v-else title="곡 등록">
      <form class="song-form" @submit.prevent="registerSong">
        <label>제목 *<input v-model="songForm.title" placeholder="곡 제목" /></label>
        <label>아티스트<input v-model="songForm.artist" placeholder="아티스트 (선택)" /></label>
        <label>오디오 URL *<input v-model="songForm.audioUrl" placeholder="https://..." /></label>
        <label>길이(초)<input v-model.number="songForm.durationSec" type="number" min="0" placeholder="예: 210" /></label>
        <PixelButton variant="primary" type="submit">등록</PixelButton>
      </form>
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

.song-form { display: grid; gap: 12px; max-width: 420px; }
.song-form label { display: grid; gap: 5px; font-size: 10px; font-weight: 700; color: var(--c-muted); }
.song-form input {
  height: 42px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
  font-size: 12px; font-weight: 400; color: var(--c-ink);
}
</style>
