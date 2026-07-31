<script setup lang="ts">
/**
 * 관리자 대시보드 (API §10) — 신고 유저·제재 이력·게임 노출·감사 로그.
 * 접근 제어(role=ADMIN)는 라우터 가드/서버에서 검증. 여기서는 화면 초안만.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  adminApi,
  adminChatReportsApi,
  adminGamesApi,
  adminPointsApi,
  adminSanctionApi,
  adminUserReportsApi,
  ApiError,
  type AdminGame,
  type AdminOnlineUserListResponse,
  type AdminPointHistoryListResponse,
  type AdminUserSummary,
  type ChatReportDetail,
  type ChatReportListResponse,
  type ChatReportReason,
  type ChatReportStatus,
  type PointDirection,
  type ReportedUser,
  type SanctionHistoryListResponse,
  type SanctionRefType,
  type SanctionStatus,
  type SanctionType,
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
import {
  GAME_MODE_LABEL,
  GAME_SCOPE_LABEL,
  filterByScope,
  scopeBadges,
  type GameScope,
} from './games'
import { POINT_DIRECTION_LABEL, POINT_TYPE_LABEL, formatPoint } from './points'

const { message: toast, flash } = useToast()

// 목 데이터 없음 — 없는 걸 있는 것처럼 보여 주면 "백엔드가 붙었는데 왜 안 뜨지"를 판단할 수 없다.
const tab = ref<
  'chat-reports' | 'reports' | 'reported-users' | 'sanctions' | 'points' | 'games' | 'online-users'
>('chat-reports')
/** 한 페이지에 담는 줄 수 — 관리자 목록은 한 화면에서 훑고 넘긴다. */
const PAGE_SIZE = 5

// 신고 유저 목록(-105) — 사람 단위. 신고함이 '들어온 것을 처리하는 자리'라면 여기는 '누구를 볼지 고르는 자리'다.
const { data: reportedUsers, error: reportedUsersError } = useAsyncData<ReportedUser[]>(
  () => adminApi.reports(),
  [],
)
// 서버가 상한(20명)만 주고 페이지를 나누지 않는다 — 누적 신고 상위 목록이라 뒤로 넘길 페이지가 없다.
// 그래서 쪽 나누기는 화면 몫이다.
const reportedUserPage = ref(0)
const reportedUserPages = computed(() => Math.ceil(reportedUsers.value.length / PAGE_SIZE))
const pagedReportedUsers = computed(() =>
  reportedUsers.value.slice(reportedUserPage.value * PAGE_SIZE, (reportedUserPage.value + 1) * PAGE_SIZE),
)

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
      size: PAGE_SIZE,
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
      size: PAGE_SIZE,
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

// ── 회원 좁히기(닉네임 검색) ───────────────────────────
/**
 * 제재 내역·포인트 내역이 공유하는 "누구를 볼 것인가" 상태.
 *
 * 입력은 닉네임이지만 <b>서버 필터는 여전히 userId</b>다 — 정지 상태·해제·포인트 요약이 모두
 * id로 걸려 있어서, 닉네임을 그대로 넘기면 그 자리마다 사람을 다시 찾아야 한다. 그래서 검색은
 * 닉네임을 id로 바꾸는 단계고, 그 뒤 흐름은 예전 그대로다.
 *
 * 부분 일치라 후보가 여럿일 수 있다. 임의로 하나를 고르지 않고 고르게 둔다 — 엉뚱한 사람에게
 * 제재가 나가는 것보다 클릭 한 번이 낫다. 다만 입력과 <b>똑같은</b> 닉네임이 있으면 그 사람이다
 * (신고 목록에서 닉네임을 그대로 옮겨 적는 게 가장 흔한 경로다).
 */
function useUserFilter(reload: () => void) {
  const query = ref('')
  const userId = ref<number | null>(null)
  const nickname = ref('')
  const candidates = ref<AdminUserSummary[]>([])
  const error = ref('')
  const busy = ref(false)

  function pick(user: AdminUserSummary) {
    userId.value = user.userId
    nickname.value = user.nickname
    // 목록 링크로 들어온 경우까지 검색창을 실제 대상에 맞춘다 — 입력칸과 걸린 필터가 어긋나면
    // 다음에 '조회'를 눌렀을 때 엉뚱한 사람이 걸린다.
    query.value = user.nickname
    candidates.value = []
    error.value = ''
    reload()
  }

  /** 회원 지정을 풀고 전체 목록으로 — 입력칸을 비우는 것보다 버튼이 확실하다. */
  function clear() {
    query.value = ''
    userId.value = null
    nickname.value = ''
    candidates.value = []
    error.value = ''
    reload()
  }

  async function search() {
    const q = query.value.trim()
    if (busy.value) return
    if (!q) {
      clear()
      return
    }
    busy.value = true
    candidates.value = []
    error.value = ''
    try {
      const found = await adminApi.searchUsers(q)
      const exact = found.find((u) => u.nickname.toLowerCase() === q.toLowerCase())
      if (exact) pick(exact)
      else if (found.length === 1) pick(found[0]!)
      else if (found.length) candidates.value = found
      else error.value = `'${q}' 닉네임의 회원을 찾지 못했어요`
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '회원을 찾지 못했어요'
    } finally {
      busy.value = false
    }
  }

  return { query, userId, nickname, candidates, error, busy, search, pick, clear }
}

// ── 제재 내역 · 정지 해제 ──────────────────────────────
// 두 축이 한 탭에 있다:
//   1) 회원을 지정하지 않은 전체 내역 — "요즘 무슨 제재가 나갔나". 오판·과잉 제재를 사후에 찾는 자리.
//   2) 회원을 지정한 상태 카드 — "이 사람 지금 어떤 상태인가" + 해제 버튼.
// 상태(Redis TTL)는 대상이 정해져야만 의미가 있어서 2)에서만 뜬다. 목록은 항상 보인다 —
// 회원 id를 알아야만 아무것도 안 보이던 게 이 화면의 원래 문제였다.
const SANCTION_TYPES: SanctionType[] = ['WARN', 'SUSPEND', 'BAN', 'RELEASE', 'UNBAN']

const sanctionTypeFilter = ref<SanctionType | ''>('')
const sanctionPage = ref(0)
const {
  query: sanctionQuery,
  userId: sanctionUserId,
  nickname: sanctionNickname,
  candidates: sanctionCandidates,
  error: sanctionUserError,
  busy: sanctionUserBusy,
  search: searchSanctionUser,
  pick: pickSanctionUser,
  clear: clearSanctionUser,
} = useUserFilter(() => {
  sanctionPage.value = 0
  void loadSanctions()
})
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

/**
 * 제재 내역 조회. 회원 id는 선택이다 — 없으면 전체 목록, 있으면 그 회원으로 좁히고
 * 현재 제재 상태 카드까지 함께 띄운다.
 *
 * 상태 조회 실패가 목록을 가리지 않게 따로 처리한다(다른 저장소 — Redis TTL과 RDB).
 * 없는 회원 id를 넣었을 때 "이력 없음"과 "조회 실패"가 같은 화면이 되면 관리자가 오타를 눈치채지 못한다.
 */
async function loadSanctions() {
  const userId = sanctionUserId.value
  const targeted = userId !== null
  sanctionError.value = ''
  try {
    sanctionHistory.value = await adminSanctionApi.allHistory({
      userId: targeted ? userId : undefined,
      type: sanctionTypeFilter.value || undefined,
      page: sanctionPage.value,
      size: PAGE_SIZE,
    })
  } catch (e) {
    sanctionHistory.value = null
    sanctionError.value = e instanceof ApiError
      ? suspensionErrorMessage(e.code, e.message)
      : '조회에 실패했어요'
  }
  if (!targeted) {
    sanctionStatus.value = null
    return
  }
  try {
    sanctionStatus.value = await adminSanctionApi.status(userId)
  } catch {
    // 상태는 부가 정보다 — 목록은 이미 그려 놓고 카드만 접는다.
    sanctionStatus.value = null
  }
}
onMounted(loadSanctions)
watch([sanctionPage, sanctionTypeFilter], loadSanctions)

/**
 * 신고에서 이 사용자의 제재 내역으로 건너간다 — 정지 전에 전력을 보는 흐름이 자연스럽다.
 * 닉네임까지 받는 건 화면이 "#42"가 아니라 사람 이름으로 대상을 밝히기 위해서다(검색을 거치지 않는 경로다).
 */
function openSanctionsOf(userId: number, nickname: string) {
  pickSanctionUser({ userId, nickname })
  tab.value = 'sanctions'
  // 탭을 옮기면서 신고 상세를 띄워 두면 다른 탭 위에 남는다.
  userReportDetail.value = null
  chatReportDetail.value = null
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

// ── 게임 관리 (-106) ──────────────────────────────────
// 공개 카탈로그(GET /games)가 아니라 전용 경로를 쓴다. 저쪽은 인원 조건이 섞인 playable을 주고,
// 그 값으로 토글을 그리면 인원 때문에 false인 게임이 "차단"으로 보인다.
const GAME_SCOPES: GameScope[] = ['all', 'solo', 'multi']

const games = ref<AdminGame[]>([])
const gamesError = ref('')
const gameScope = ref<GameScope>('all')
/** 처리 중인 게임 id — 같은 행을 연타해 요청이 겹치는 걸 막는다. */
const gameBusy = ref<number | null>(null)

const scopedGames = computed(() => filterByScope(games.value, gameScope.value))
const closedCount = computed(() => games.value.filter((g) => !g.active).length)

async function loadGames() {
  gamesError.value = ''
  try {
    games.value = await adminGamesApi.list()
  } catch (e) {
    games.value = []
    gamesError.value = e instanceof ApiError ? e.message : '게임 목록을 불러오지 못했어요'
  }
}
onMounted(loadGames)

/**
 * 플레이 허용 토글.
 *
 * 낙관적으로 먼저 바꾸지 않는다 — 실패했는데 화면이 넘어가면 닫은 줄 알았던 게임이 그대로
 * 열려 있다. 서버가 갱신된 항목을 돌려주므로 그 값으로 덮어써 두 쪽 상태를 맞춘다.
 */
async function toggleGame(g: AdminGame) {
  if (gameBusy.value !== null) return
  gameBusy.value = g.id
  try {
    const updated = await adminGamesApi.setActive(g.id, !g.active)
    games.value = games.value.map((game) => (game.id === updated.id ? updated : game))
    flash(`${updated.name} — ${updated.active ? '플레이 허용' : '플레이 차단'}`)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '게임 상태를 바꾸지 못했어요')
  } finally {
    gameBusy.value = null
  }
}

// ── 포인트 내역 (-106 후속) ───────────────────────────
// 읽기 전용이다. 지급·회수 버튼이 없는 건 서버에 그 엔드포인트가 없어서이기도 하고,
// 있으면 point_history가 게임·상점 결과의 기록이 아니라 편집 가능한 장부가 되기 때문이다.
const POINT_DIRECTIONS: PointDirection[] = ['EARN', 'SPEND']

const pointDirection = ref<PointDirection | ''>('')
const pointPage = ref(0)
const points = ref<AdminPointHistoryListResponse | null>(null)
const pointsError = ref('')
const {
  query: pointQuery,
  userId: pointUserId,
  nickname: pointNickname,
  candidates: pointCandidates,
  error: pointUserError,
  busy: pointUserBusy,
  search: searchPointUser,
  pick: pickPointUser,
  clear: clearPointUser,
} = useUserFilter(() => {
  pointPage.value = 0
  void loadPoints()
})

async function loadPoints() {
  pointsError.value = ''
  const userId = pointUserId.value
  try {
    points.value = await adminPointsApi.list({
      userId: userId ?? undefined,
      direction: pointDirection.value || undefined,
      page: pointPage.value,
      size: PAGE_SIZE,
    })
  } catch (e) {
    points.value = null
    pointsError.value = e instanceof ApiError ? e.message : '포인트 내역을 불러오지 못했어요'
  }
}
onMounted(loadPoints)
watch([pointDirection, pointPage], loadPoints)

/** 신고·제재에서 이 사용자의 포인트 흐름으로 — 부정 정산 의심을 확인하는 흐름이다. */
function openPointsOf(userId: number, nickname: string) {
  pointDirection.value = ''
  pickPointUser({ userId, nickname })
  tab.value = 'points'
}

// ── 사용중인 유저 ─────────────────────────────────────
// 지금 붙어 있는 사람들. 페이지가 없다 — 목록의 수명이 60초(프레즌스 TTL)라 2페이지를 넘기는 사이에
// 1페이지가 이미 다른 사람들이 된다. 한 번에 받아 스크롤로 훑는다.
const ONLINE_REFRESH_MS = 15_000

const onlineUsers = ref<AdminOnlineUserListResponse | null>(null)
const onlineError = ref('')
const onlineBusy = ref(false)
let onlineTimer: ReturnType<typeof setInterval> | null = null

async function loadOnlineUsers() {
  if (onlineBusy.value) return
  onlineBusy.value = true
  onlineError.value = ''
  try {
    onlineUsers.value = await adminApi.onlineUsers()
  } catch (e) {
    onlineUsers.value = null
    onlineError.value = e instanceof ApiError ? e.message : '접속자 목록을 불러오지 못했어요'
  } finally {
    onlineBusy.value = false
  }
}

/**
 * 탭이 열려 있는 동안에만 주기 갱신한다. 멈춰 있으면 60초 뒤엔 거짓말이 된 목록을 보게 되고,
 * 닫은 뒤에도 계속 물으면 아무도 안 보는 화면 때문에 서버가 키 스캔을 반복한다.
 */
watch(tab, (now, before) => {
  if (now === 'online-users') {
    void loadOnlineUsers()
    onlineTimer = setInterval(loadOnlineUsers, ONLINE_REFRESH_MS)
  } else if (before === 'online-users' && onlineTimer !== null) {
    clearInterval(onlineTimer)
    onlineTimer = null
  }
})
onUnmounted(() => {
  if (onlineTimer !== null) clearInterval(onlineTimer)
})

const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)
const num = (n: number) => n.toLocaleString('ko-KR')
/** 버튼 라벨용 축약 — 게스트 닉네임(pending_… 28자)이 그대로 들어가면 버튼이 모달 밖으로 나간다. */
const short = (s: string, max = 12) => (s.length > max ? `${s.slice(0, max)}…` : s)
</script>

<template>
  <AppPage class="admin-page" title="관리자 대시보드" title-style="none" max-width="1320px" :zoom="1">
    <div class="tabs">
      <button :class="{ on: tab === 'chat-reports' }" @click="tab = 'chat-reports'">채팅 신고</button>
      <button :class="{ on: tab === 'reports' }" @click="tab = 'reports'">사용자 신고</button>
      <button :class="{ on: tab === 'reported-users' }" @click="tab = 'reported-users'">신고 유저</button>
      <button :class="{ on: tab === 'sanctions' }" @click="tab = 'sanctions'">제재 내역</button>
      <button :class="{ on: tab === 'points' }" @click="tab = 'points'">포인트 내역</button>
      <button :class="{ on: tab === 'games' }" @click="tab = 'games'">게임 관리</button>
      <button :class="{ on: tab === 'online-users' }" @click="tab = 'online-users'">사용중인 유저</button>
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
              <button class="link" @click="openSanctionsOf(r.reportedUserId, r.reportedNickname)">{{ r.reportedNickname }}</button>
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
            <tr v-for="u in pagedReportedUsers" :key="u.userId">
              <td>{{ u.userId }}</td>
              <td><button class="link" @click="openSanctionsOf(u.userId, u.nickname)">{{ u.nickname }}</button></td>
              <td><b>{{ u.reportCount }}</b>회</td>
              <td class="cr-text">
                <span v-if="!u.recentReasons.length">—</span>
                <span v-for="reason in u.recentReasons" :key="reason" class="ru-reason">
                  {{ REASON_LABEL[reason as ChatReportReason] ?? reason }}
                </span>
              </td>
              <td class="acts">
                <PixelButton @click="openSanctionsOf(u.userId, u.nickname)">제재 내역</PixelButton>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- 서버가 페이지를 나누지 않는 목록이라 쪽 나누기는 화면에서 한다 -->
        <div v-if="reportedUserPages > 1" class="cr-pager">
          <PixelButton :disabled="reportedUserPage === 0" @click="reportedUserPage--">이전</PixelButton>
          <span>{{ reportedUserPage + 1 }} / {{ reportedUserPages }}</span>
          <PixelButton :disabled="reportedUserPage >= reportedUserPages - 1" @click="reportedUserPage++">다음</PixelButton>
        </div>
      </template>
    </PixelCard>

    <!-- 제재 내역 — 회원 지정 없이 전체가 기본. 지정하면 현재 상태 카드와 해제 버튼이 붙는다 -->
    <PixelCard v-else-if="tab === 'sanctions'" title="계정 제재 내역">
      <form class="cr-filter" @submit.prevent="searchSanctionUser">
        <label>
          닉네임
          <input v-model="sanctionQuery" type="search" maxlength="32" placeholder="전체" />
        </label>
        <label>
          유형
          <select v-model="sanctionTypeFilter">
            <option value="">전체</option>
            <option v-for="t in SANCTION_TYPES" :key="t" :value="t">{{ SANCTION_TYPE_LABEL[t] }}</option>
          </select>
        </label>
        <PixelButton type="submit" :disabled="sanctionUserBusy">조회</PixelButton>
        <!-- 폼 안의 버튼은 기본이 submit이라 막지 않으면 해제와 재검색이 함께 나간다 -->
        <PixelButton v-if="sanctionUserId !== null" variant="secondary" @click.prevent="clearSanctionUser">
          회원 해제
        </PixelButton>
        <span v-if="sanctionHistory" class="cr-total">총 {{ num(sanctionHistory.totalElements) }}건</span>
      </form>
      <!-- 부분 일치라 여럿이 걸릴 수 있다. 임의로 고르지 않는다 — 엉뚱한 사람에게 제재가 나가는 것보다 클릭 한 번이 낫다 -->
      <div v-if="sanctionCandidates.length" class="ux-picker">
        <span class="sx-hint">닉네임에 '{{ sanctionQuery.trim() }}'가 들어가는 회원 {{ sanctionCandidates.length }}명 — 한 명을 고르세요</span>
        <PixelButton v-for="u in sanctionCandidates" :key="u.userId" @click="pickSanctionUser(u)">
          {{ u.nickname }} (#{{ u.userId }})
        </PixelButton>
      </div>
      <p v-if="sanctionUserError" class="cr-empty ux-nouser">{{ sanctionUserError }}</p>

      <p v-if="sanctionError" class="cr-empty">{{ sanctionError }}</p>
      <template v-else>
        <!-- 상태는 Redis TTL, 이력은 RDB. 만료가 곧 해제라 되돌릴 배치가 없다.
             대상이 정해져야만 의미가 있는 값이라 회원을 지정했을 때만 뜬다 -->
        <div
          v-if="sanctionStatus"
          class="sx-status"
          :class="{ on: sanctionStatus.suspended || sanctionStatus.banned }"
        >
          <div class="sx-head">
            <b>{{ sanctionNickname || `#${sanctionUserId}` }}</b>
            <span class="sx-uid">#{{ sanctionUserId }}</span>
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
            <PixelButton variant="secondary" @click="openPointsOf(sanctionUserId!, sanctionNickname)">포인트 내역</PixelButton>
          </div>
        </div>
        <p v-else class="sx-hint sx-scope-hint">
          전체 제재 내역이에요 — 닉네임으로 찾으면 그 사람의 현재 상태와 해제 버튼이 함께 뜹니다.
        </p>

        <p v-if="!sanctionHistory || !sanctionHistory.sanctions.length" class="cr-empty">제재 이력이 없어요</p>
        <table v-else class="tbl">
          <thead><tr><th>#</th><th>대상</th><th>유형</th><th>기간</th><th>사유</th><th>근거 신고</th><th>집행자</th><th>일시</th></tr></thead>
          <tbody>
            <tr v-for="s in sanctionHistory.sanctions" :key="s.id">
              <td>{{ s.id }}</td>
              <!-- 닉네임은 제재 시점 스냅샷이다. 눌러 그 회원으로 좁힐 수 있게 둔다 -->
              <td><button class="link" @click="pickSanctionUser({ userId: s.userId, nickname: s.userNickname })">{{ s.userNickname }}</button></td>
              <td><span class="cr-status" :class="s.type === 'SUSPEND' ? 'received' : s.type === 'BAN' ? 'rejected' : s.type === 'WARN' ? 'reviewing' : 'resolved'">{{ SANCTION_TYPE_LABEL[s.type] }}</span></td>
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

    <!-- 포인트 내역 — 읽기 전용. 지급·회수 버튼은 없다(장부를 고칠 수 있으면 부정 정산을 판별할 수 없다) -->
    <PixelCard v-else-if="tab === 'points'" title="포인트 내역">
      <form class="cr-filter" @submit.prevent="searchPointUser">
        <label>
          닉네임
          <input v-model="pointQuery" type="search" maxlength="32" placeholder="전체" />
        </label>
        <label>
          방향
          <select v-model="pointDirection">
            <option value="">전체</option>
            <option v-for="d in POINT_DIRECTIONS" :key="d" :value="d">{{ POINT_DIRECTION_LABEL[d] }}</option>
          </select>
        </label>
        <PixelButton type="submit" :disabled="pointUserBusy">조회</PixelButton>
        <PixelButton v-if="pointUserId !== null" variant="secondary" @click.prevent="clearPointUser">회원 해제</PixelButton>
        <span v-if="points" class="cr-total">총 {{ num(points.totalElements) }}건</span>
      </form>
      <div v-if="pointCandidates.length" class="ux-picker">
        <span class="sx-hint">닉네임에 '{{ pointQuery.trim() }}'가 들어가는 회원 {{ pointCandidates.length }}명 — 한 명을 고르세요</span>
        <PixelButton v-for="u in pointCandidates" :key="u.userId" @click="pickPointUser(u)">
          {{ u.nickname }} (#{{ u.userId }})
        </PixelButton>
      </div>
      <p v-if="pointUserError" class="cr-empty ux-nouser">{{ pointUserError }}</p>

      <p v-if="pointsError" class="cr-empty">{{ pointsError }}</p>
      <template v-else>
        <!-- 요약은 필터와 무관한 전체 합계다 — '적립만' 필터에 요약까지 좁혀지면 두 숫자를 비교할 수 없다 -->
        <div v-if="points?.summary" class="px-summary">
          <div><span>대상</span><b>{{ pointNickname || `#${pointUserId}` }}</b></div>
          <div><span>받아 간 포인트</span><b class="earn">{{ formatPoint(points.summary.earned) }}</b></div>
          <div><span>쓴 포인트</span><b class="spend">{{ formatPoint(-points.summary.spent) }}</b></div>
          <div>
            <span>현재 잔액</span>
            <b>{{ points.summary.currentBalance === null ? '—' : `${num(points.summary.currentBalance)}P` }}</b>
          </div>
          <p class="sx-hint">
            합계는 필터와 무관한 <b>전체</b> 기준입니다. 잔액이 적립−사용과 어긋나면
            게스트 이관 등 다른 경로가 섞인 계정이에요.
          </p>
        </div>
        <p v-else class="sx-hint sx-scope-hint">
          전체 회원의 최근 포인트 흐름이에요 — 닉네임으로 찾으면 그 사람의 적립·사용 합계가 함께 뜹니다.
        </p>

        <p v-if="!points || !points.histories.length" class="cr-empty">포인트 내역이 없어요</p>
        <table v-else class="tbl">
          <thead><tr><th>#</th><th>회원</th><th>금액</th><th>유형</th><th>처리 후 잔액</th><th>참조</th><th>일시</th></tr></thead>
          <tbody>
            <tr v-for="h in points.histories" :key="h.id">
              <td>{{ h.id }}</td>
              <td>
                <button class="link" @click="pickPointUser({ userId: h.userId, nickname: h.nickname ?? '' })">
                  {{ h.nickname ?? `#${h.userId}` }}
                </button>
              </td>
              <!-- 부호를 원장 그대로 — 옆 칸의 처리 후 잔액과 맞아떨어져야 눈으로 검산이 된다 -->
              <td><b :class="h.amount < 0 ? 'spend' : 'earn'">{{ formatPoint(h.amount) }}</b></td>
              <td>{{ POINT_TYPE_LABEL[h.type] ?? h.type }}</td>
              <td>{{ num(h.balanceAfter) }}P</td>
              <td>{{ h.refId === null ? '—' : `#${h.refId}` }}</td>
              <td>{{ fmt(h.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="points && points.totalPages > 1" class="cr-pager">
          <PixelButton :disabled="pointPage === 0" @click="pointPage--">이전</PixelButton>
          <span>{{ pointPage + 1 }} / {{ points.totalPages }}</span>
          <PixelButton :disabled="pointPage >= points.totalPages - 1" @click="pointPage++">다음</PixelButton>
        </div>
      </template>
    </PixelCard>

    <!-- 게임 관리 — 닫으면 목록엔 남고 선택만 막힌다. 조용히 사라지면 "어제 하던 게임이 왜 없지"에 답할 수 없다 -->
    <PixelCard v-else-if="tab === 'games'" title="게임 관리">
      <div class="cr-filter">
        <div class="gm-scope">
          <PixelButton
            v-for="s in GAME_SCOPES"
            :key="s"
            :variant="gameScope === s ? 'yellow' : 'secondary'"
            @click="gameScope = s"
          >{{ GAME_SCOPE_LABEL[s] }}</PixelButton>
        </div>
        <span class="cr-total">
          {{ games.length }}개 중 <b>{{ closedCount }}개 차단</b>
        </span>
      </div>
      <p class="sx-hint ru-hint">
        차단하면 싱글 카탈로그와 방 안 게임 선택창에 <b>잠긴 카드로 남고 시작만 막힙니다</b> —
        진행 중인 판은 끊지 않아요(하던 판을 날리는 건 방장 강제 종료의 몫).
        게임 하나가 싱글·멀티 양쪽에 뜰 수 있어 두 탭에 함께 나옵니다.
      </p>
      <p v-if="gamesError" class="cr-empty">{{ gamesError }}</p>
      <p v-else-if="!scopedGames.length" class="cr-empty">
        {{ games.length ? '이 범위에 해당하는 게임이 없어요' : '등록된 게임이 없어요' }}
      </p>
      <table v-else class="tbl">
        <thead><tr><th>#</th><th>게임</th><th>모드</th><th>분류</th><th>인원</th><th>범위</th><th>플레이 가능</th></tr></thead>
        <tbody>
          <tr v-for="g in scopedGames" :key="g.id" :class="{ 'gm-closed': !g.active }">
            <td>{{ g.id }}</td>
            <td><b>{{ g.name }}</b></td>
            <td>{{ GAME_MODE_LABEL[g.mode] ?? g.mode }}</td>
            <td>{{ g.category ?? '—' }}</td>
            <td>{{ g.minPlayers }}~{{ g.maxPlayers }}인</td>
            <td class="cr-text">
              <span v-for="b in scopeBadges(g)" :key="b" class="ru-reason">{{ b }}</span>
            </td>
            <td class="acts">
              <span class="state" :class="{ off: !g.active }">{{ g.active ? '가능' : '차단' }}</span>
              <PixelButton
                :variant="g.active ? 'secondary' : 'mint'"
                :disabled="gameBusy !== null"
                @click="toggleGame(g)"
              >
                {{ g.active ? '차단' : '허용' }}
              </PixelButton>
            </td>
          </tr>
        </tbody>
      </table>
    </PixelCard>

    <!-- 사용중인 유저 — 지금 붙어 있는 사람들. 페이지 없이 스크롤로 훑는다(목록이 60초면 바뀐다) -->
    <PixelCard v-else-if="tab === 'online-users'" title="사용중인 유저">
      <div class="cr-filter">
        <PixelButton :disabled="onlineBusy" @click="loadOnlineUsers">새로고침</PixelButton>
        <span class="sx-hint">15초마다 자동으로 다시 불러옵니다 · 신호가 60초 끊기면 목록에서 사라져요</span>
        <span v-if="onlineUsers" class="cr-total">총 <b>{{ onlineUsers.users.length }}</b>명 접속 중</span>
      </div>
      <p v-if="onlineError" class="cr-empty">{{ onlineError }}</p>
      <p v-else-if="onlineUsers && !onlineUsers.users.length" class="cr-empty">지금 접속 중인 유저가 없어요</p>
      <template v-else-if="onlineUsers">
        <p v-if="onlineUsers.capped" class="sx-hint ru-hint">
          접속자가 많아 <b>500명까지만</b> 보여 주고 있어요.
        </p>
        <!-- 페이저 대신 스크롤. 접속자는 늘었다 줄었다 하는 값이라 쪽수를 세는 게 의미가 없다 -->
        <div class="ou-scroll">
          <table class="tbl">
            <thead><tr><th>#</th><th>닉네임</th><th>위치</th><th>방</th><th>마지막 신호</th></tr></thead>
            <tbody>
              <tr v-for="u in onlineUsers.users" :key="u.userId">
                <td>{{ u.userId }}</td>
                <td><button class="link" @click="openSanctionsOf(u.userId, u.nickname)">{{ u.nickname }}</button></td>
                <td>
                  <span class="cr-status" :class="u.state === 'IN_ROOM' ? 'reviewing' : 'resolved'">
                    {{ u.state === 'IN_ROOM' ? '방 안' : '로비' }}
                  </span>
                </td>
                <td>{{ u.roomId ?? '—' }}</td>
                <td>{{ u.secondsAgo }}초 전</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </PixelCard>

    <!-- 채팅 신고 상세 — 스냅샷을 시간순으로 렌더링해 채팅창을 복원하고, 신고 대상을 하이라이트한다 -->
    <PixelModal v-if="chatReportDetail" class="admin-modal" @close="chatReportDetail = null">
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
          ⛔ {{ short(chatReportDetail.reportedNickname) }} 기간 정지
        </PixelButton>
        <PixelButton variant="secondary" :disabled="chatReportBusy" @click="openBanFromChatReport(chatReportDetail)">
          🚫 영구 정지
        </PixelButton>
        <span class="sx-hint">제재하면 이 신고도 종결로 넘어갑니다</span>
      </div>
    </PixelModal>

    <!-- 사용자 신고 상세 — 서버에 상세 API가 없어 목록 행을 그대로 띄운다(복원할 맥락이 없다) -->
    <PixelModal v-if="userReportDetail" class="admin-modal" @close="userReportDetail = null">
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
          ⛔ {{ short(userReportDetail.reportedNickname) }} 기간 정지
        </PixelButton>
        <PixelButton variant="secondary" @click="openBanFromUserReport(userReportDetail)">
          🚫 영구 정지
        </PixelButton>
        <span class="sx-hint">제재하면 이 신고도 종결로 넘어갑니다</span>
      </div>
      <div class="leave-actions cr-actions">
        <PixelButton variant="secondary" @click="openSanctionsOf(userReportDetail.reportedUserId, userReportDetail.reportedNickname)">제재 내역 보기</PixelButton>
        <PixelButton variant="secondary" @click="openPointsOf(userReportDetail.reportedUserId, userReportDetail.reportedNickname)">포인트 내역</PixelButton>
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

.cr-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 15px; color: #80674f; font-size: 11px; font-weight: 700; }.cr-filter select { height: 34px; margin-left: 6px; padding: 0 9px; border: 2px solid #b78d5d; border-radius: 6px; background: #fffdf7; color: #5a4131; font-size: 11px; }.cr-total { margin-left: auto; }.cr-empty { padding: 38px 0; color: #8c7966; font-size: 12px; text-align: center; }.cr-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.cr-status { display: inline-block; padding: 4px 8px; border: 1.5px solid #aa805c; border-radius: 6px; background: #fffdf7; color: #624833; font-size: 10px; font-weight: 700; }.cr-status.received { background: #ffe29a; }.cr-status.reviewing { background: #cfe8ff; }.cr-status.resolved { background: #cde9b8; }.cr-status.rejected { background: #eee5d9; color: #89786a; }.cr-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 16px; color: #715945; font-size: 11px; }.cr-detail-title { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: #493629; font-family: var(--font-pixel); font-size: 15px; font-weight: 400; }.cr-meta { display: grid; gap: 5px; margin-bottom: 14px; color: #655141; font-size: 11px; }.cr-context-label { margin-bottom: 7px; color: #8d7059; font-size: 10px; font-weight: 700; }.cr-context { display: grid; gap: 4px; max-height: 260px; overflow-y: auto; margin-bottom: 15px; padding: 10px; border: 2px dashed #dfc9a6; border-radius: 8px; background: #fffdf7; }.cr-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 5px 7px; border-radius: 6px; font-size: 11px; }.cr-line.target { border: 1.5px solid #b78d5d; background: #fff0b6; font-weight: 700; }.cr-line.suggest { color: #6b5ab0; }.cr-line-name { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }.cr-line-text { flex: 1; min-width: 0; word-break: break-all; }.cr-line-time { flex-shrink: 0; margin-left: auto; color: var(--c-muted); font-size: 9px; }.cr-actions { display: flex; flex-wrap: wrap; gap: 8px; }

@media (max-width: 760px) { .admin-page :deep(.app-page) { padding: 18px 14px 32px; }.tabs { margin-inline: 0; }.tabs button { flex: 1 1 105px; min-width: 0; }.tbl { white-space: nowrap; }.acts { min-width: max-content; } }

/* ── 계정 제재(-105) 추가분 — 위 팔레트를 따르되 없던 요소만 새로 정의한다 ── */
.cr-filter input[type='search'] { width: 150px; height: 34px; padding: 0 8px; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; font-size: 11px; margin-left: 6px; }
.link { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: inherit; text-decoration: underline dashed; cursor: pointer; }

/* 닉네임 후보 고르기 — 부분 일치라 여럿이 걸린다. 검색창 바로 아래, 목록 위에 둔다 */
.ux-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px; border: 2px dashed #dfc9a6; border-radius: 8px; background: #fffdf7; }
.ux-picker > .sx-hint { flex: 1 1 100%; }
.ux-picker :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.ux-nouser { padding: 14px 0 20px; }

/* 사용중인 유저 — 쪽 나누기 대신 스크롤. 머리글은 붙여 둬야 길게 내려도 무슨 칸인지 안다 */
.ou-scroll { max-height: 460px; overflow-y: auto; border: 2px dashed #dfc9a6; border-radius: 8px; padding: 0 10px; background: #fffdf7; }
.ou-scroll thead th { position: sticky; top: 0; z-index: 1; background: #fffdf7; }

/* 신고 상세 모달 — 기본 폭(390px)엔 제재 버튼 셋도 대화 맥락도 들어가지 않아 버튼이 창 밖으로 나갔다.
   넓히고, 내용이 길면 창 안에서 스크롤한다(뷰포트를 넘기면 위쪽 처리 버튼이 화면 밖에 남는다) */
.admin-modal :deep(.modal) { width: 620px; max-height: 86vh; overflow-y: auto; }

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
/* 상태 전이(위)와 계정 처벌(아래)은 축이 달라 시각적으로 갈라 둔다.
   줄바꿈을 허용한다 — 버튼 셋이 한 줄에 안 들어가면 안내 문구가 한 글자 폭으로 눌려 세로로 늘어난다 */
.sx-sanction-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 2px dashed #eaddea; }
.sx-sanction-row .sx-hint { flex: 1 1 100%; }
.sx-hint { font-size: 10px; color: var(--c-muted); }
.sx-uid { font-size: 10px; color: var(--c-muted); font-weight: 700; }
.ru-hint { display: block; margin-bottom: 12px; line-height: 1.6; }
.ru-reason { display: inline-block; margin-right: 4px; font-size: 9px; font-weight: 700; padding: 3px 6px; border-radius: 7px; border: 1.5px solid var(--c-ink); background: #fff; }
/* 상태(종결/기각)와 나란히 붙는 제재 배지 — 상태만으로는 실제 처벌 여부를 알 수 없다 */
.sx-badge { display: inline-block; margin-left: 4px; font-size: 9px; font-weight: 700; padding: 3px 6px; border-radius: 7px; border: 1.5px solid var(--c-coral); background: #fff0f0; color: var(--c-coral); white-space: nowrap; }
/* 회원을 지정하지 않은 상태의 안내 — 빈 자리로 두면 "조회가 안 됐나"로 읽힌다 */
.sx-scope-hint { display: block; margin-bottom: 14px; line-height: 1.6; }

/* 포인트 내역 요약 — 적립·사용·잔액을 나란히 두고 색으로 방향을 구분한다 */
.px-summary { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: baseline; border: 2px solid var(--c-ink); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px; background: #fff; }
.px-summary > div { display: flex; flex-direction: column; gap: 4px; }
.px-summary span { font-size: 10px; font-weight: 700; color: var(--c-muted); }
.px-summary b { font-size: 15px; }
.px-summary > .sx-hint { flex: 1 1 100%; line-height: 1.6; }
.earn { color: #3f7f56; }
.spend { color: var(--c-coral); }

/* 게임 관리 — 차단된 행은 흐리게 두되 읽을 수는 있게(목록에 남는다는 게 이 화면의 요점이다) */
.gm-scope { display: flex; flex-wrap: wrap; gap: 6px; }
.gm-scope :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.tbl tbody tr.gm-closed { background: #f6f1e8; color: #8d7d6c; }
.tbl tbody tr.gm-closed:hover { background: #f0e7d8; }

</style>
