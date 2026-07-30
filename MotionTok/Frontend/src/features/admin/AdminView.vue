<script setup lang="ts">
/**
 * 관리자 대시보드 (API §10) — 신고 유저·제재 이력·게임 노출·감사 로그.
 * 접근 제어(role=ADMIN)는 라우터 가드/서버에서 검증. 여기서는 화면 초안만.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  adminApi,
  adminChatReportsApi,
  adminSanctionApi,
  adminUserReportsApi,
  gamesApi,
  ApiError,
  type AuditLog,
  type ChatReportDetail,
  type ChatReportListResponse,
  type ChatReportReason,
  type ChatReportStatus,
  type Game,
  type ReportedUser,
  type SanctionHistoryListResponse,
  type SanctionRefType,
  type SanctionStatus,
  type UserReportListResponse,
  type UserReportSummary,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'
import {
  MAX_SUSPENSION_REASON_LENGTH,
  SANCTION_TYPE_LABEL,
  SUSPENSION_DAY_PRESETS,
  canSubmitRelease,
  canSubmitSuspension,
  formatRemaining,
  sanctionRefLabel,
  suspensionErrorMessage,
} from './suspension'

const { message: toast, flash } = useToast()

// 목 데이터 없음 — 없는 걸 있는 것처럼 보여 주면 "백엔드가 붙었는데 왜 안 뜨지"를 판단할 수 없다.
// 아직 서버가 없는 구역(감사 로그·곡 등록)은 화면에서 그렇다고 밝힌다.
const tab = ref<'chat-reports' | 'reports' | 'reported-users' | 'sanctions' | 'audit' | 'games'>('chat-reports')
// 신고 유저 목록(-105) — 사람 단위. 신고함이 '들어온 것을 처리하는 자리'라면 여기는 '누구를 볼지 고르는 자리'다.
const { data: reportedUsers, error: reportedUsersError } = useAsyncData<ReportedUser[]>(
  () => adminApi.reports(),
  [],
)
const { data: audit, error: auditError } = useAsyncData<AuditLog[]>(() => adminApi.auditLogs(), [])
const { data: games, error: gamesError } = useAsyncData<Game[]>(() => gamesApi.list(), [])

// ── 채팅 신고 (v0.2.17, S15P11A706-133 — 백엔드 구현 완료, mock 없음) ──
const REASON_LABEL: Record<ChatReportReason, string> = {
  ABUSE: '욕설·비방', HATE: '혐오·차별', SEXUAL: '음란·성희롱', SPAM: '도배·광고', ETC: '기타',
}
// RESOLVED를 '조치 완료'가 아니라 '종결'로 부르는 이유 — 이 상태만으로는 무슨 조치를 했는지 알 수 없다.
// 정지하고 닫은 건과 아무 제재 없이 닫은 건이 같은 값을 갖는다. 라벨은 상태가 말할 수 있는 것
// ("이 신고는 끝났다")까지만 말하고, 실제 제재 여부는 아래 sanctioned 배지가 따로 보여 준다.
const STATUS_LABEL: Record<ChatReportStatus, string> = {
  RECEIVED: '접수', REVIEWING: '검토 중', RESOLVED: '종결', REJECTED: '기각',
}

const chatReportStatusFilter = ref<ChatReportStatus | ''>('')
const chatReportPage = ref(0)
const chatReports = ref<ChatReportListResponse | null>(null)
const chatReportsError = ref('')
const chatReportDetail = ref<ChatReportDetail | null>(null)
const chatReportBusy = ref(false)
/** 이 페이지의 신고 중 제재로 이어진 것 — '종결'만으로는 제재 여부가 드러나지 않는다. */
const chatSanctioned = ref<Set<number>>(new Set())

async function loadChatReports() {
  chatReportsError.value = ''
  try {
    const list = await adminChatReportsApi.list({
      status: chatReportStatusFilter.value || undefined,
      page: chatReportPage.value,
      size: 20,
    })
    chatReports.value = list
    // 배지는 부가 정보다 — 실패해도 목록은 보여 준다(빈 집합이면 배지만 안 뜬다).
    chatSanctioned.value = await adminSanctionApi
      .sanctionedReports('CHAT_REPORT', list.reports.map((r) => r.id))
      .catch(() => new Set<number>())
  } catch (e) {
    chatReports.value = null
    chatSanctioned.value = new Set()
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
/**
 * 열어 둔 사용자 신고. 서버에 상세 조회가 없어 목록 행을 그대로 쓴다 — 사용자 신고는
 * "누가 누구를 왜 신고했다"가 곧 전부라 채팅 신고처럼 복원할 맥락 스냅샷이 없다.
 */
const userReportDetail = ref<UserReportSummary | null>(null)

/** 이 페이지의 신고 중 제재로 이어진 것 — 채팅 신고와 별개 집합이다(id가 각각 1부터 증가한다). */
const userSanctioned = ref<Set<number>>(new Set())

async function loadUserReports() {
  userReportsError.value = ''
  try {
    const list = await adminUserReportsApi.list({
      status: userReportStatusFilter.value || undefined,
      page: userReportPage.value,
      size: 20,
    })
    userReports.value = list
    userSanctioned.value = await adminSanctionApi
      .sanctionedReports('USER_REPORT', list.reports.map((r) => r.id))
      .catch(() => new Set<number>())
  } catch (e) {
    userReports.value = null
    userSanctioned.value = new Set()
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

// ── 계정 정지 (-105) ──────────────────────────────────
// 신고 처리(상태 전이)와 제재(정지)는 서버에서 별개다. 신고를 종결로 바꿔도 정지는 걸리지 않고,
// 정지를 걸어도 신고는 접수 상태로 남는다. 둘을 잇는 건 이 화면의 일이다 — 서버에서 묶으면
// "정지 없이 기각"이나 "신고 없는 직권 정지" 같은 정상 경로가 어색해진다.
//
// 정지는 목록 행이 아니라 신고 상세 모달에서만 시작한다. 계정을 막는 건 되돌리기 어려운 결정이라
// 신고 내용과 그 사람의 제재 전력을 함께 보고 눌러야 한다 — 행에 버튼으로 두면 상태 전이
// (검토·종결·기각)와 같은 무게로 보인다.
interface SuspendTarget {
  userId: number
  nickname: string
  /** 근거 신고. reportId·reportType은 짝이다(서버가 한쪽만 오면 400). 직권 제재면 둘 다 null. */
  reportId: number | null
  reportType: SanctionRefType | null
}

const suspendTarget = ref<SuspendTarget | null>(null)
const suspendDays = ref(3)
const suspendReason = ref('')
const suspendBusy = ref(false)
/** 대상의 현재 정지 상태 — 이미 정지 중이면 이번 부과가 '갱신'이라는 걸 알려 줘야 한다. */
const targetStatus = ref<SanctionStatus | null>(null)

const canSuspend = computed(() => canSubmitSuspension(suspendDays.value, suspendReason.value))

/**
 * 사유 초안을 채워 둔다 — 이력에 그대로 남는 값이라 빈칸으로 시작하면 "욕설" 한 단어만 적히기 쉽다.
 * 수정 가능하게 둔다.
 */
function openSuspend(target: SuspendTarget, reasonDraft: string) {
  suspendTarget.value = target
  suspendDays.value = 3
  suspendReason.value = reasonDraft
  targetStatus.value = null
  void loadTargetStatus(target.userId)
}

function userReportTarget(r: UserReportSummary): SuspendTarget {
  return { userId: r.reportedUserId, nickname: r.reportedNickname, reportId: r.id, reportType: 'USER_REPORT' }
}

function chatReportTarget(d: ChatReportDetail): SuspendTarget {
  return { userId: d.reportedUserId, nickname: d.reportedNickname, reportId: d.id, reportType: 'CHAT_REPORT' }
}

function openSuspendFromUserReport(r: UserReportSummary) {
  openSuspend(userReportTarget(r), `${REASON_LABEL[r.reason]} 사용자 신고 조치 (신고 #${r.id})`)
}

function openWarnFromUserReport(r: UserReportSummary) {
  openWarn(userReportTarget(r), `${REASON_LABEL[r.reason]} 신고가 접수되었습니다. 반복되면 이용이 제한됩니다.`)
}

function openWarnFromChatReport(d: ChatReportDetail) {
  openWarn(chatReportTarget(d), `${REASON_LABEL[d.reason]} 신고가 접수되었습니다. 반복되면 이용이 제한됩니다.`)
}

function openBanFromUserReport(r: UserReportSummary) {
  openBan(userReportTarget(r), `${REASON_LABEL[r.reason]} 사용자 신고 — 영구 정지 (신고 #${r.id})`)
}

function openBanFromChatReport(d: ChatReportDetail) {
  openBan(chatReportTarget(d), `${REASON_LABEL[d.reason]} 채팅 신고 — 영구 정지 (신고 #${d.id})`)
}

// ── 경고 ──────────────────────────────────────────────
// 접근을 막지 않는 유일한 제재라 확인 모달 없이 사유만 받는다. 되돌릴 상태가 없어 해제도 없다.
// 사유가 특히 중요하다 — 정지는 접근이 막히는 것으로 전달되지만 경고는 문구가 전달의 전부다.
const warnTarget = ref<SuspendTarget | null>(null)
const warnReason = ref('')
const warnBusy = ref(false)

const canWarn = computed(() => canSubmitRelease(warnReason.value))

function openWarn(target: SuspendTarget, reasonDraft: string) {
  warnTarget.value = target
  warnReason.value = reasonDraft
  targetStatus.value = null
  void loadTargetStatus(target.userId)
}

/** 경고 부과 → 근거 신고를 종결로. 정지와 같은 흐름이고 세션만 건드리지 않는다. */
async function submitWarn() {
  const target = warnTarget.value
  if (!target || warnBusy.value || !canWarn.value) return
  warnBusy.value = true
  try {
    const status = await adminSanctionApi.warn(target.userId, {
      reason: warnReason.value.trim(),
      reportId: target.reportId,
      reportType: target.reportType,
    })
    let notice = `${target.nickname} — 경고 (누적 ${status.warnCount}회)`
    if (target.reportId !== null && target.reportType !== null) {
      const reports = target.reportType === 'CHAT_REPORT' ? adminChatReportsApi : adminUserReportsApi
      try {
        await reports.updateStatus(target.reportId, 'RESOLVED')
      } catch {
        notice += ' · 경고는 전달됐지만 신고 상태는 직접 바꿔 주세요'
      }
    }
    flash(notice)
    warnTarget.value = null
    chatReportDetail.value = null
    userReportDetail.value = null
    await Promise.all([loadUserReports(), loadChatReports()])
  } catch (e) {
    flash(e instanceof ApiError ? suspensionErrorMessage(e.code, e.message) : '경고 처리에 실패했어요')
  } finally {
    warnBusy.value = false
  }
}

// ── 영구 정지 ─────────────────────────────────────────
// 기간 정지와 모달을 나눈다 — 같은 화면에 기간 입력이 있으면 실수로 영구 제재가 나가고,
// 그건 되돌리기 가장 어려운 실수다. 서버 요청 본문에도 days가 없다.
const banTarget = ref<SuspendTarget | null>(null)
const banReason = ref('')
const banBusy = ref(false)

const canBan = computed(() => canSubmitRelease(banReason.value))

function openBan(target: SuspendTarget, reasonDraft: string) {
  banTarget.value = target
  banReason.value = reasonDraft
  targetStatus.value = null
  void loadTargetStatus(target.userId)
}

/** 영구 정지 부과 → 근거 신고를 종결로. 기간 정지와 같은 순서·같은 부분 실패 처리다. */
async function submitBan() {
  const target = banTarget.value
  if (!target || banBusy.value || !canBan.value) return
  banBusy.value = true
  try {
    await adminSanctionApi.ban(target.userId, {
      reason: banReason.value.trim(),
      reportId: target.reportId,
      reportType: target.reportType,
    })
    let notice = `${target.nickname} — 영구 정지`
    if (target.reportId !== null && target.reportType !== null) {
      const reports = target.reportType === 'CHAT_REPORT' ? adminChatReportsApi : adminUserReportsApi
      try {
        await reports.updateStatus(target.reportId, 'RESOLVED')
      } catch {
        notice += ' · 영구 정지는 걸렸지만 신고 상태는 직접 바꿔 주세요'
      }
    }
    flash(notice)
    banTarget.value = null
    chatReportDetail.value = null
    userReportDetail.value = null
    await Promise.all([loadUserReports(), loadChatReports()])
  } catch (e) {
    flash(e instanceof ApiError ? suspensionErrorMessage(e.code, e.message) : '영구 정지에 실패했어요')
  } finally {
    banBusy.value = false
  }
}

function openSuspendFromChatReport(d: ChatReportDetail) {
  openSuspend(chatReportTarget(d), `${REASON_LABEL[d.reason]} 채팅 신고 조치 (신고 #${d.id})`)
}

/** 상태는 참고 정보다 — 조회가 실패해도 부과 자체는 막지 않는다. */
async function loadTargetStatus(userId: number) {
  try {
    targetStatus.value = await adminSanctionApi.status(userId)
  } catch {
    targetStatus.value = null
  }
}

/**
 * 정지 부과 → 근거가 된 신고를 종결로.
 *
 * 정지가 성공하고 상태 전이만 실패하면 <b>정지는 유효하다</b>. 그때 전체를 실패로 안내하면
 * 관리자가 같은 제재를 또 걸어 기간이 덮인다 — 그래서 두 결과를 구분해서 알린다.
 */
async function submitSuspend() {
  const target = suspendTarget.value
  if (!target || suspendBusy.value || !canSuspend.value) return
  suspendBusy.value = true
  try {
    const status = await adminSanctionApi.suspend(target.userId, {
      days: suspendDays.value,
      reason: suspendReason.value.trim(),
      reportId: target.reportId,
      reportType: target.reportType,
    })
    let notice = `${target.nickname} — ${suspendDays.value}일 정지 (누적 ${status.suspendCount}회)`
    if (target.reportId !== null && target.reportType !== null) {
      // 어느 신고에서 왔는지에 따라 전이시킬 대상이 다르다 — 두 신고는 별개 리소스다.
      const reports = target.reportType === 'CHAT_REPORT' ? adminChatReportsApi : adminUserReportsApi
      try {
        await reports.updateStatus(target.reportId, 'RESOLVED')
      } catch {
        notice += ' · 정지는 걸렸지만 신고 상태는 직접 바꿔 주세요'
      }
    }
    flash(notice)
    suspendTarget.value = null
    // 신고 상세를 열어 둔 채로 정지했다면 그 화면의 상태도 낡았다 — 함께 닫는다.
    chatReportDetail.value = null
    userReportDetail.value = null
    await Promise.all([loadUserReports(), loadChatReports()])
  } catch (e) {
    flash(e instanceof ApiError ? suspensionErrorMessage(e.code, e.message) : '정지 처리에 실패했어요')
  } finally {
    suspendBusy.value = false
  }
}

// ── 제재 이력 · 정지 해제 ──────────────────────────────
// 서버에 "전체 제재 목록"은 없다 — 이력이 사용자 단위로만 인덱싱돼 있어 대상을 먼저 정해야 한다.
const sanctionUserId = ref<number | null>(null)
const sanctionPage = ref(0)
const sanctionStatus = ref<SanctionStatus | null>(null)
const sanctionHistory = ref<SanctionHistoryListResponse | null>(null)
const sanctionError = ref('')
const sanctionBusy = ref(false)
const releaseReason = ref('')
/** 해제 모달 — 기간 정지와 영구 정지가 다른 엔드포인트라 어느 쪽을 푸는지 들고 있어야 한다. */
const releaseKind = ref<'SUSPENSION' | 'BAN' | null>(null)

const canRelease = computed(() => canSubmitRelease(releaseReason.value))

function openRelease(kind: 'SUSPENSION' | 'BAN') {
  releaseKind.value = kind
  releaseReason.value = ''
}

async function loadSanctions() {
  const userId = sanctionUserId.value
  if (userId === null || Number.isNaN(userId)) return
  sanctionError.value = ''
  try {
    // 상태와 이력은 서로를 기다릴 이유가 없다(다른 저장소 — Redis TTL과 RDB).
    const [status, history] = await Promise.all([
      adminSanctionApi.status(userId),
      adminSanctionApi.history(userId, { page: sanctionPage.value, size: 20 }),
    ])
    sanctionStatus.value = status
    sanctionHistory.value = history
  } catch (e) {
    sanctionStatus.value = null
    sanctionHistory.value = null
    sanctionError.value = e instanceof ApiError
      ? suspensionErrorMessage(e.code, e.message)
      : '조회에 실패했어요'
  }
}
watch(sanctionPage, loadSanctions)

/** 신고에서 이 사용자의 제재 내역으로 건너간다 — 정지 전에 전력을 보는 흐름이 자연스럽다. */
function openSanctionsOf(userId: number) {
  sanctionUserId.value = userId
  sanctionPage.value = 0
  tab.value = 'sanctions'
  // 탭을 옮기면서 신고 상세를 띄워 두면 다른 탭 위에 남는다.
  userReportDetail.value = null
  chatReportDetail.value = null
  void loadSanctions()
}

async function submitRelease() {
  const userId = sanctionUserId.value
  const kind = releaseKind.value
  if (userId === null || kind === null || sanctionBusy.value || !canRelease.value) return
  sanctionBusy.value = true
  const body = { reason: releaseReason.value.trim() }
  try {
    if (kind === 'BAN') {
      await adminSanctionApi.unban(userId, body)
    } else {
      await adminSanctionApi.release(userId, body)
    }
    releaseKind.value = null
    releaseReason.value = ''
    flash(`#${userId} — ${kind === 'BAN' ? '영구 정지' : '기간 정지'} 해제`)
    await loadSanctions()
  } catch (e) {
    flash(e instanceof ApiError ? suspensionErrorMessage(e.code, e.message) : '해제에 실패했어요')
  } finally {
    sanctionBusy.value = false
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
  <AppPage class="admin-page" title="관리자 대시보드" title-style="none" max-width="1320px" :zoom="1">
    <div class="tabs">
      <button :class="{ on: tab === 'chat-reports' }" @click="tab = 'chat-reports'">채팅 신고</button>
      <button :class="{ on: tab === 'reports' }" @click="tab = 'reports'">사용자 신고</button>
      <button :class="{ on: tab === 'reported-users' }" @click="tab = 'reported-users'">신고 유저</button>
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
            <option value="RESOLVED">종결</option>
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
            <td>
              <span class="cr-status" :class="r.status.toLowerCase()">{{ STATUS_LABEL[r.status] }}</span>
              <!-- 종결이 곧 제재는 아니다 — 실제로 계정을 막았는지는 이 배지만 말해 준다 -->
              <span v-if="chatSanctioned.has(r.id)" class="sx-badge" title="이 신고로 계정 정지가 부과됐어요">⛔ 제재</span>
            </td>
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
            <option value="RESOLVED">종결</option>
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
            <td>
              {{ r.reporterNickname }} →
              <!-- 피신고자를 눌러 제재 전력으로 — 정지 기간은 누적 횟수를 보고 정하는 판단이다 -->
              <button class="link" @click="openSanctionsOf(r.reportedUserId)">{{ r.reportedNickname }}</button>
            </td>
            <td>{{ REASON_LABEL[r.reason] }}</td>
            <td class="cr-text">{{ r.reasonDetail ?? '—' }}</td>
            <td>
              <span class="cr-status" :class="r.status.toLowerCase()">{{ STATUS_LABEL[r.status] }}</span>
              <span v-if="userSanctioned.has(r.id)" class="sx-badge" title="이 신고로 계정 정지가 부과됐어요">⛔ 제재</span>
            </td>
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
              >종결</PixelButton>
              <PixelButton
                variant="secondary"
                :disabled="userReportBusy !== null || r.status === 'REJECTED'"
                @click="setUserReportStatus(r.id, 'REJECTED')"
              >기각</PixelButton>
              <!-- 정지는 여기가 아니라 상세에서 — 계정을 막는 결정은 전력을 보고 눌러야 한다 -->
              <PixelButton @click="userReportDetail = r">상세</PixelButton>
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

    <!-- 신고 유저 목록 — 누적 신고 횟수순. 행을 눌러 그 사람의 제재 이력으로 건너간다 -->
    <PixelCard v-else-if="tab === 'reported-users'" title="신고 많은 유저">
      <p v-if="reportedUsersError" class="cr-empty">{{ reportedUsersError }}</p>
      <p v-else-if="!reportedUsers.length" class="cr-empty">신고된 유저가 없어요</p>
      <template v-else>
        <p class="sx-hint ru-hint">
          사용자 신고와 채팅 신고를 합친 누적 횟수입니다. 기각된 신고도 포함해요 — 반복 신고 자체가 신호라서요.
        </p>
        <table class="tbl">
          <thead><tr><th>#</th><th>닉네임</th><th>누적 신고</th><th>최근 사유</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in reportedUsers" :key="u.userId">
              <td>{{ u.userId }}</td>
              <td><button class="link" @click="openSanctionsOf(u.userId)">{{ u.nickname }}</button></td>
              <td><b>{{ u.reportCount }}</b>회</td>
              <td class="cr-text">
                <span v-if="!u.recentReasons.length">—</span>
                <span v-for="reason in u.recentReasons" :key="reason" class="ru-reason">
                  {{ REASON_LABEL[reason as ChatReportReason] ?? reason }}
                </span>
              </td>
              <td class="acts">
                <PixelButton @click="openSanctionsOf(u.userId)">제재 내역</PixelButton>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </PixelCard>

    <!-- 제재 이력 · 정지 상태 (회원 단위 조회 — 전체 목록은 서버에 없다) -->
    <PixelCard v-else-if="tab === 'sanctions'" title="계정 제재">
      <form class="cr-filter" @submit.prevent="(sanctionPage = 0, loadSanctions())">
        <label>
          회원 ID
          <input v-model.number="sanctionUserId" type="number" min="1" placeholder="예) 42" />
        </label>
        <PixelButton type="submit" :disabled="sanctionUserId === null">조회</PixelButton>
      </form>

      <p v-if="sanctionError" class="cr-empty">{{ sanctionError }}</p>
      <p v-else-if="sanctionUserId === null" class="cr-empty">
        회원 ID로 조회해요 — 신고 목록의 피신고자 이름을 눌러도 여기로 옵니다
      </p>
      <template v-else-if="sanctionStatus">
        <!-- 상태는 Redis TTL, 이력은 RDB. 만료가 곧 해제라 되돌릴 배치가 없다 -->
        <div class="sx-status" :class="{ on: sanctionStatus.suspended || sanctionStatus.banned }">
          <div class="sx-head">
            <b>#{{ sanctionUserId }}</b>
            <!-- 영구가 기간보다 강하다 — 둘이 동시에 서는 일은 없지만 표시 우선순위는 정해 둔다 -->
            <span
              class="cr-status"
              :class="sanctionStatus.banned ? 'rejected' : sanctionStatus.suspended ? 'received' : 'resolved'"
            >
              {{ sanctionStatus.banned ? '영구 정지' : sanctionStatus.suspended ? '기간 정지 중' : '정상' }}
            </span>
            <span class="sx-count">
              누적 경고 {{ sanctionStatus.warnCount }}회 · 기간 정지 {{ sanctionStatus.suspendCount }}회 · 영구 {{ sanctionStatus.banCount }}회
            </span>
          </div>
          <p v-if="sanctionStatus.banned" class="sx-detail">
            사유 <b>{{ sanctionStatus.banReason }}</b> · <b>만료 없음</b> — 관리자가 해제할 때까지 유지됩니다
          </p>
          <p v-if="sanctionStatus.suspended" class="sx-detail">
            사유 <b>{{ sanctionStatus.suspendReason }}</b> ·
            남은 기간 <b>{{ formatRemaining(sanctionStatus.remainingSeconds) }}</b>
            <template v-if="sanctionStatus.releaseAt"> · 자동 해제 {{ fmt(sanctionStatus.releaseAt) }}</template>
          </p>
          <div class="cr-actions">
            <PixelButton
              v-if="sanctionStatus.suspended"
              variant="mint"
              :disabled="sanctionBusy"
              @click="openRelease('SUSPENSION')"
            >기간 정지 해제</PixelButton>
            <PixelButton
              v-if="sanctionStatus.banned"
              variant="mint"
              :disabled="sanctionBusy"
              @click="openRelease('BAN')"
            >영구 정지 해제</PixelButton>
          </div>
        </div>

        <p v-if="!sanctionHistory || !sanctionHistory.sanctions.length" class="cr-empty">제재 이력이 없어요</p>
        <table v-else class="tbl">
          <thead><tr><th>#</th><th>유형</th><th>기간</th><th>사유</th><th>근거 신고</th><th>집행자</th><th>일시</th></tr></thead>
          <tbody>
            <tr v-for="s in sanctionHistory.sanctions" :key="s.id">
              <td>{{ s.id }}</td>
              <td><span class="cr-status" :class="s.type === 'SUSPEND' ? 'received' : 'resolved'">{{ SANCTION_TYPE_LABEL[s.type] }}</span></td>
              <td>{{ s.days !== null ? `${s.days}일` : '—' }}</td>
              <td class="cr-text">{{ s.reason }}</td>
              <!-- 두 신고 테이블의 id가 각각 1부터라 유형까지 찍어야 되짚을 수 있다 -->
              <td>{{ sanctionRefLabel(s.refReportId, s.refReportType) }}</td>
              <td>{{ s.adminNickname }}</td>
              <td>{{ fmt(s.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="sanctionHistory && sanctionHistory.totalPages > 1" class="cr-pager">
          <PixelButton :disabled="sanctionPage === 0" @click="sanctionPage--">이전</PixelButton>
          <span>{{ sanctionPage + 1 }} / {{ sanctionHistory.totalPages }}</span>
          <PixelButton :disabled="sanctionPage >= sanctionHistory.totalPages - 1" @click="sanctionPage++">다음</PixelButton>
        </div>
      </template>
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
        <PixelButton variant="mint" :disabled="chatReportBusy || chatReportDetail.status === 'RESOLVED'" @click="setChatReportStatus('RESOLVED')">종결</PixelButton>
        <PixelButton variant="secondary" :disabled="chatReportBusy || chatReportDetail.status === 'REJECTED'" @click="setChatReportStatus('REJECTED')">기각</PixelButton>
      </div>
      <!-- 상태 전이와 다른 축이라 줄을 갈라 둔다: 위는 신고 서류의 처리, 아래는 계정에 대한 처벌 -->
      <div class="sx-sanction-row">
        <PixelButton variant="mint" :disabled="chatReportBusy" @click="openWarnFromChatReport(chatReportDetail)">
          ⚠️ 경고
        </PixelButton>
        <PixelButton variant="yellow" :disabled="chatReportBusy" @click="openSuspendFromChatReport(chatReportDetail)">
          ⛔ {{ chatReportDetail.reportedNickname }} 기간 정지
        </PixelButton>
        <PixelButton variant="secondary" :disabled="chatReportBusy" @click="openBanFromChatReport(chatReportDetail)">
          🚫 영구 정지
        </PixelButton>
        <span class="sx-hint">제재하면 이 신고도 종결로 넘어갑니다</span>
      </div>
    </PixelModal>

    <!-- 사용자 신고 상세 — 서버에 상세 API가 없어 목록 행을 그대로 띄운다(복원할 맥락이 없다) -->
    <PixelModal v-if="userReportDetail" @close="userReportDetail = null">
      <h3 class="cr-detail-title">
        🚩 사용자 신고 #{{ userReportDetail.id }}
        <span class="cr-status" :class="userReportDetail.status.toLowerCase()">{{ STATUS_LABEL[userReportDetail.status] }}</span>
      </h3>
      <div class="cr-meta">
        <p><b>신고 일시</b> {{ fmt(userReportDetail.createdAt) }}</p>
        <p><b>신고자</b> {{ userReportDetail.reporterNickname }} (#{{ userReportDetail.reporterUserId }})
          → <b>피신고자</b> {{ userReportDetail.reportedNickname }} (#{{ userReportDetail.reportedUserId }})</p>
        <p><b>사유</b> {{ REASON_LABEL[userReportDetail.reason] }}<template v-if="userReportDetail.reasonDetail"> — {{ userReportDetail.reasonDetail }}</template></p>
      </div>
      <div class="sx-sanction-row">
        <PixelButton variant="mint" @click="openWarnFromUserReport(userReportDetail)">
          ⚠️ 경고
        </PixelButton>
        <PixelButton variant="yellow" @click="openSuspendFromUserReport(userReportDetail)">
          ⛔ {{ userReportDetail.reportedNickname }} 기간 정지
        </PixelButton>
        <PixelButton variant="secondary" @click="openBanFromUserReport(userReportDetail)">
          🚫 영구 정지
        </PixelButton>
        <span class="sx-hint">제재하면 이 신고도 종결로 넘어갑니다</span>
      </div>
      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" @click="openSanctionsOf(userReportDetail.reportedUserId)">제재 이력 보기</PixelButton>
        <PixelButton @click="userReportDetail = null">닫기</PixelButton>
      </div>
    </PixelModal>

    <!-- 정지 부과 — 기간·사유를 받고, 성공 시 근거가 된 신고를 종결로 넘긴다 -->
    <PixelModal v-if="suspendTarget" @close="suspendTarget = null">
      <h3 class="cr-detail-title">⛔ 계정 정지</h3>
      <p class="sx-target">
        <b>{{ suspendTarget.nickname }}</b> (#{{ suspendTarget.userId }})
        <template v-if="suspendTarget.reportId !== null"> · 신고 #{{ suspendTarget.reportId }} 근거</template>
      </p>
      <!-- 이미 정지 중이면 이번 부과가 연장이 아니라 '덮어쓰기'라는 걸 밝힌다 -->
      <p v-if="targetStatus?.suspended" class="sx-warn">
        이미 정지 중이에요 (남은 기간 {{ formatRemaining(targetStatus.remainingSeconds) }}) —
        부과하면 <b>새 기간으로 덮어씁니다</b>.
      </p>
      <p v-else-if="targetStatus && targetStatus.suspendCount > 0" class="sx-note">
        과거 정지 {{ targetStatus.suspendCount }}회
      </p>

      <label class="sx-field">
        <span>정지 기간</span>
        <div class="sx-days">
          <PixelButton
            v-for="d in SUSPENSION_DAY_PRESETS"
            :key="d"
            :variant="suspendDays === d ? 'yellow' : 'secondary'"
            @click="suspendDays = d"
          >{{ d }}일</PixelButton>
          <input v-model.number="suspendDays" type="number" min="1" max="365" />
        </div>
      </label>

      <label class="sx-field">
        <span>사유 · 이력에 그대로 남습니다 ({{ suspendReason.trim().length }}/{{ MAX_SUSPENSION_REASON_LENGTH }})</span>
        <textarea v-model="suspendReason" rows="3" :maxlength="MAX_SUSPENSION_REASON_LENGTH" />
      </label>

      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" :disabled="suspendBusy" @click="suspendTarget = null">취소</PixelButton>
        <PixelButton variant="primary" :disabled="suspendBusy || !canSuspend" @click="submitSuspend">
          {{ suspendDays }}일 정지
        </PixelButton>
      </div>
    </PixelModal>

    <!-- 경고 부과 — 사유가 전달의 전부다. 접근을 막지 않으므로 확인 후 되돌릴 것도 없다 -->
    <PixelModal v-if="warnTarget" @close="warnTarget = null">
      <h3 class="cr-detail-title">⚠️ 경고</h3>
      <p class="sx-target">
        <b>{{ warnTarget.nickname }}</b> (#{{ warnTarget.userId }})
        <template v-if="warnTarget.reportId !== null"> · 신고 #{{ warnTarget.reportId }} 근거</template>
      </p>
      <p class="sx-note">
        이용은 그대로 가능하고, 아래 문구가 <b>당사자에게 그대로 전달됩니다.</b>
        접속 중이면 즉시, 아니면 다음 접속 때 뜹니다.
        <template v-if="targetStatus"><br />과거 경고 {{ targetStatus.warnCount }}회 · 기간 정지 {{ targetStatus.suspendCount }}회</template>
      </p>
      <label class="sx-field">
        <span>경고 문구 · 당사자가 읽습니다 ({{ warnReason.trim().length }}/{{ MAX_SUSPENSION_REASON_LENGTH }})</span>
        <textarea v-model="warnReason" rows="3" :maxlength="MAX_SUSPENSION_REASON_LENGTH" />
      </label>
      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" :disabled="warnBusy" @click="warnTarget = null">취소</PixelButton>
        <PixelButton variant="primary" :disabled="warnBusy || !canWarn" @click="submitWarn">경고 보내기</PixelButton>
      </div>
    </PixelModal>

    <!-- 영구 정지 부과 — 기간 입력이 없는 별도 모달이다(같은 화면에 두면 실수로 영구가 나간다) -->
    <PixelModal v-if="banTarget" @close="banTarget = null">
      <h3 class="cr-detail-title">🚫 영구 정지</h3>
      <p class="sx-target">
        <b>{{ banTarget.nickname }}</b> (#{{ banTarget.userId }})
        <template v-if="banTarget.reportId !== null"> · 신고 #{{ banTarget.reportId }} 근거</template>
      </p>
      <p class="sx-warn">
        <b>만료가 없습니다.</b> 관리자가 직접 해제할 때까지 로그인·실시간 연결이 모두 막히고,
        계정 상태가 <code>BANNED</code>로 바뀝니다. 기간 정지 중이었다면 그 기간은 사라집니다.
      </p>
      <p v-if="targetStatus" class="sx-note">
        과거 경고 {{ targetStatus.warnCount }}회 · 기간 정지 {{ targetStatus.suspendCount }}회 · 영구 정지 {{ targetStatus.banCount }}회
      </p>
      <label class="sx-field">
        <span>사유 · 이력에 그대로 남습니다 ({{ banReason.trim().length }}/{{ MAX_SUSPENSION_REASON_LENGTH }})</span>
        <textarea v-model="banReason" rows="3" :maxlength="MAX_SUSPENSION_REASON_LENGTH" />
      </label>
      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" :disabled="banBusy" @click="banTarget = null">취소</PixelButton>
        <PixelButton variant="primary" :disabled="banBusy || !canBan" @click="submitBan">영구 정지</PixelButton>
      </div>
    </PixelModal>

    <!-- 제재 해제 — 오판 정정도 검증 대상인 결정이라 사유를 필수로 받는다 -->
    <PixelModal v-if="releaseKind" @close="releaseKind = null">
      <h3 class="cr-detail-title">🔓 {{ releaseKind === 'BAN' ? '영구 정지' : '기간 정지' }} 해제</h3>
      <p class="sx-target">
        #{{ sanctionUserId }}
        <template v-if="releaseKind === 'SUSPENSION'"> · 남은 기간 {{ formatRemaining(sanctionStatus?.remainingSeconds) }}</template>
        <template v-else> · 사유 {{ sanctionStatus?.banReason }}</template>
      </p>
      <label class="sx-field">
        <span>해제 사유 ({{ releaseReason.trim().length }}/{{ MAX_SUSPENSION_REASON_LENGTH }})</span>
        <textarea v-model="releaseReason" rows="3" :maxlength="MAX_SUSPENSION_REASON_LENGTH" placeholder="예) 오판으로 확인" />
      </label>
      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" :disabled="sanctionBusy" @click="releaseKind = null">취소</PixelButton>
        <PixelButton variant="mint" :disabled="sanctionBusy || !canRelease" @click="submitRelease">해제</PixelButton>
      </div>
    </PixelModal>

    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.admin-page {
  --admin-ink: #403124;
  --admin-border: #c6915e;
  --admin-paper: #fffaf0;
  color: var(--admin-ink);
}
.admin-page :deep(.app-page) { padding-top: 32px; }
.admin-page :deep(.app-shell) { background: #fffaf0; }

.tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 8px 18px; }
.tabs button { min-width: 112px; height: 42px; padding: 0 15px; border: 2px solid #b78d5d; border-radius: 7px; background: #fff7e5; box-shadow: 2px 2px 0 #e2d0b5; color: #69513e; font-size: 12px; font-weight: 700; }
.tabs button:hover { background: #fff0b6; }.tabs button.on { border-color: #925c47; background: #e7c996; box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), 3px 3px 0 #a66b50; color: #34251f; }

:deep(.card) { overflow: hidden; border: 3px solid var(--admin-border); border-radius: 16px; background: var(--admin-paper); box-shadow: 5px 5px 0 #dfcdb0; }
:deep(.card-head) { margin: -20px -20px 18px; padding: 13px 20px; border-bottom: 2px dashed #dfc9a6; background: #e6f0cb; }
:deep(.card-head h2) { color: #493629; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }
.tbl { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 12px; }.tbl th, .tbl td { padding: 12px 10px; text-align: left; border-bottom: 2px dashed #ead5b8; vertical-align: middle; }.tbl th { color: #8d7059; font-size: 10px; }.tbl tbody tr:hover { background: #fff3cf; }
.warn { color: var(--c-coral); font-weight: 700; }.acts { display: flex; gap: 6px; align-items: center; }.acts :deep(.px-btn), .cr-pager :deep(.px-btn), .cr-actions :deep(.px-btn) { height: 33px; padding: 0 10px; border-color: #9a6b4f; border-radius: 6px; box-shadow: 2px 2px 0 #bd916e; font-size: 10px; }.state { font-size: 11px; font-weight: 700; color: #4f8e64; }.state.off { color: var(--c-muted); }

.cr-filter { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; color: #80674f; font-size: 11px; font-weight: 700; }.cr-filter select { height: 34px; margin-left: 6px; padding: 0 9px; border: 2px solid #b78d5d; border-radius: 6px; background: #fffdf7; color: #5a4131; font-size: 11px; }.cr-total { margin-left: auto; }.cr-empty { padding: 38px 0; color: #8c7966; font-size: 12px; text-align: center; }.cr-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cr-status { display: inline-block; padding: 4px 8px; border: 1.5px solid #aa805c; border-radius: 6px; background: #fffdf7; color: #624833; font-size: 10px; font-weight: 700; }.cr-status.received { background: #ffe29a; }.cr-status.reviewing { background: #cfe8ff; }.cr-status.resolved { background: #cde9b8; }.cr-status.rejected { background: #eee5d9; color: #89786a; }.cr-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 16px; color: #715945; font-size: 11px; }.cr-detail-title { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: #493629; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }.cr-meta { display: grid; gap: 5px; margin-bottom: 14px; color: #655141; font-size: 11px; }.cr-context-label { margin-bottom: 7px; color: #8d7059; font-size: 10px; font-weight: 700; }.cr-context { display: grid; gap: 4px; max-height: 260px; overflow-y: auto; margin-bottom: 15px; padding: 10px; border: 2px dashed #dfc9a6; border-radius: 8px; background: #fffdf7; }.cr-line { display: flex; gap: 8px; align-items: baseline; padding: 5px 7px; border-radius: 6px; font-size: 11px; }.cr-line.target { border: 1.5px solid #b78d5d; background: #fff0b6; font-weight: 700; }.cr-line.suggest { color: #6b5ab0; }.cr-line-name { flex-shrink: 0; font-weight: 700; }.cr-line-text { flex: 1; min-width: 0; word-break: break-all; }.cr-line-time { flex-shrink: 0; color: var(--c-muted); font-size: 9px; }.cr-actions { display: flex; gap: 8px; }

@media (max-width: 760px) { .admin-page :deep(.app-page) { padding: 18px 14px 32px; }.tabs { margin-inline: 0; }.tabs button { flex: 1 1 105px; min-width: 0; }.tbl { white-space: nowrap; }.acts { min-width: max-content; } }

/* ── 계정 제재(-105) 추가분 — 위 팔레트를 따르되 없던 요소만 새로 정의한다 ── */
.cr-filter input[type='number'] { width: 92px; height: 34px; padding: 0 8px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; font-size: 11px; margin-left: 6px; }
.link { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: inherit; text-decoration: underline dashed; cursor: pointer; }

/* 계정 제재 */
.sx-status { border: 2px solid var(--c-ink); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px; background: #fff; }
.sx-status.on { background: #fff6e0; }
.sx-head { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.sx-count { margin-left: auto; font-size: 10px; color: var(--c-muted); font-weight: 700; }
.sx-detail { margin: 8px 0 10px; font-size: 11px; line-height: 1.6; }
.sx-target { font-size: 11px; margin-bottom: 10px; }
.sx-warn { font-size: 11px; line-height: 1.6; color: var(--c-coral); background: #fff0f0; border: 1.5px solid var(--c-coral); border-radius: 7px; padding: 8px 10px; margin-bottom: 12px; }
.sx-note { font-size: 10px; color: var(--c-muted); margin-bottom: 12px; }
.sx-field { display: block; margin-bottom: 14px; }
.sx-field > span { display: block; font-size: 10px; font-weight: 700; color: var(--c-muted); margin-bottom: 6px; }
.sx-field textarea { width: 100%; padding: 8px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); font-size: 11px; font-family: inherit; resize: vertical; }
.sx-days { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sx-days :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.sx-days input[type='number'] { width: 80px; height: 32px; padding: 0 8px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); font-size: 11px; }
/* 상태 전이(위)와 계정 처벌(아래)은 축이 달라 시각적으로 갈라 둔다 */
.sx-sanction-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 2px dashed #eaddea; }
.sx-hint { font-size: 10px; color: var(--c-muted); }
.ru-hint { display: block; margin-bottom: 12px; line-height: 1.6; }
.ru-reason { display: inline-block; margin-right: 4px; font-size: 9px; font-weight: 700; padding: 3px 6px; border-radius: 7px; border: 1.5px solid var(--c-ink); background: #fff; }
/* 상태(종결/기각)와 나란히 붙는 제재 배지 — 상태만으로는 실제 처벌 여부를 알 수 없다 */
.sx-badge { display: inline-block; margin-left: 4px; font-size: 9px; font-weight: 700; padding: 3px 6px; border-radius: 7px; border: 1.5px solid var(--c-coral); background: #fff0f0; color: var(--c-coral); white-space: nowrap; }

</style>
