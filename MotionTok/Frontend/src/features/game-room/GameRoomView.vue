<script setup lang="ts">
/** 게임룸 — 화상 파티룸(LiveKit SFU). 방 정원만큼 슬롯을 만들고, 참가자는 실시간 타일로,
 *  빈 자리는 "대기 중"으로 표시한다. 무대/채팅/게임 선택은 데모. */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ConnectionState } from 'livekit-client'
import { RouteName } from '@/router/routeNames'
import { roomsApi, reportsApi, chatReportsApi, ApiError, readAccessClaims, type ChatMessage, type ChatReportReason } from '@/api'
import type { GameEvent, GameResultEntry, LiveRoomDetail, Visibility } from '@/api/types'
import type { ActiveGameSession } from '@/features/games/session'
import { useCamera } from '@/composables/useCamera'
import { useLiveKitRoom, type ParticipantView } from '@/composables/useLiveKitRoom'
import { useRoomChat } from '@/composables/useRoomChat'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { GAME_CATALOG, type GameEntry } from './data'
import { CHAT_REPORT_REASONS, CHAT_REPORT_DETAIL_MAX, canSubmitChatReport, chatReportErrorMessage } from './chatReport'
import ParticipantTile from './components/ParticipantTile.vue'
import GamePicker from './components/GamePicker.vue'
import ReportIcon from './components/ReportIcon.vue'
import HostWaitingOverlay from './components/HostWaitingOverlay.vue'
// 방 정보 수정 모달(-130) — 입력 필드가 방 생성과 동일 규격(명세 §4)이라 로비 모달을 그대로 재사용한다.
import CreateRoomModal, { type NewRoom } from '@/features/lobby/components/CreateRoomModal.vue'
// MediaPipe 번들(~600KB)이 무거워서 게임을 시작할 때만 로드한다.
const FingerStarGame = defineAsyncComponent(
  () => import('@/features/games/finger-star/FingerStarGame.vue'),
)
const BodyFitGame = defineAsyncComponent(
  () => import('@/features/games/body-fit/BodyFitGame.vue'),
)
import AppHeader from '@/components/common/AppHeader.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'

const route = useRoute()
const router = useRouter()
const bgm = useBgm()
const { message: toast, flash } = useToast(2600)

// LiveKit 실시간 방 + 로컬 카메라 캡처. 프리뷰·모션 인식 게임 입력은 항상 로컬 캡처 스트림을
// 쓰고, LiveKit에는 복제본을 발행한다 — "카메라 끄기"는 발행만 끊어서 다른 사람에게만 꺼져
// 보이고 캡처는 유지되므로, 꺼도 게임 시작·참여가 가능하다.
const lk = useLiveKitRoom()
const camera = useCamera()
const CAMERA_CONSTRAINTS = { video: { width: 640, height: 400 }, audio: false } as const
// 대기실 채팅 + 게임 제안 (STOMP, 명세 §7)
const roomChat = useRoomChat()
const myParticipantId = computed(() => readAccessClaims()?.sub ?? null)

const roomCode = computed(() => (route.query.room as string) || 'MP-4X9K')
const roomGame = computed(() => (route.query.game as string) || 'DANCE BATTLE')
// 입장 전 카메라/마이크 온오프 화면(DeviceSetupView)에서 고른 초기 상태 — 쿼리에 없으면(직접 URL 진입 등) 기본 켜짐.
const initialCamOn = computed(() => route.query.cam !== '0')
const initialMicOn = computed(() => route.query.mic !== '0')

// ── 방 정원/방장/이름 (상세 조회) ─────────────
const capacity = ref(8)
const hostId = ref<string | null>(null)
const roomTitle = ref<string | null>(null)
/** 방장 표시명 — 상세 응답에 hostDisplayName이 없어 members에서 hostUserId로 찾는다. */
const hostName = ref<string | null>(null)
// 화면에 노출/복사되는 "ROOM CODE"는 접속용 roomId가 아니라 초대코드(inviteCode)여야 한다 —
// /join-by-invite-code는 이 값으로 조회하지 roomId로는 찾지 못한다. 상세 조회 전까지는 roomId로 폴백.
const inviteCode = ref<string | null>(null)
const shareCode = computed(() => inviteCode.value ?? roomCode.value)
// 방 설정 수정(-130) 프리필용 — 공개여부와 현재 인원은 상세 조회로만 알 수 있다.
const roomVisibility = ref<Visibility>('PUBLIC')
const participantCount = ref(1)

/**
 * 방장 판정 — <b>이 화면의 유일한 방장 판별 근거</b>다. 상세 조회의 hostUserId와 내 토큰 sub를 직접 비교한다.
 *
 * <p>과거에 쓰던 route.query.host는 쓸 수 없다: DeviceSetupView가 방을 만든 사람과 참가하는 사람에게
 * 똑같이 host=1을 붙여서, 먼저 들어온 참가자가 START 버튼을 갖게 됐다. 그 쿼리는 제거했다.</p>
 */
const amRoomHost = computed(() => !!hostId.value && myParticipantId.value === hostId.value)
/**
 * 상세 조회가 끝났는지. hostId를 받기 전에는 방장 여부를 알 수 없어 방장에게도 '제안'이 보이고,
 * 그 짧은 창에 누르면 시작 대신 제안이 나간다 — 알기 전까지는 버튼을 잠근다.
 */
const detailLoaded = computed(() => hostId.value !== null)

/** 상세/수정 응답을 화면 상태에 반영. 두 경로가 같은 LiveRoomDetail을 돌려주므로 한 곳에 모았다. */
function applyDetail(d: LiveRoomDetail) {
  capacity.value = d.maxPlayers
  hostId.value = d.hostUserId
  hostName.value = d.members.find((m) => m.userId === d.hostUserId)?.displayName ?? null
  roomTitle.value = d.title
  inviteCode.value = d.inviteCode
  roomVisibility.value = d.visibility
  participantCount.value = d.participantCount
}

// ── 실시간 참가자 → 슬롯 매핑 ────────────────
const connected = computed(() => lk.state.value === ConnectionState.Connected)
const lkLocal = computed(() => lk.participants.value.find((p) => p.isLocal) ?? null)
const remotes = computed(() => lk.participants.value.filter((p) => !p.isLocal))

interface Slot { view: ParticipantView | null; host: boolean }
// self를 뺀 나머지 정원만큼 슬롯을 미리 만든다. 참가자가 있으면 채우고, 없으면 빈 자리.
const otherSlots = computed<Slot[]>(() => {
  const slots: Slot[] = []
  for (let i = 0; i < Math.max(0, capacity.value - 1); i++) {
    const view = remotes.value[i] ?? null
    slots.push({ view, host: !!view && view.identity === hostId.value })
  }
  return slots
})
// 내 캠은 왼쪽에 크게 고정, 나머지는 오른쪽 좁은 트레이에 인원수(2~8명)에 맞춰 세로로 쌓는다.
// 1~2명: 1열(위아래로 쌓임). 3명 이상: 2열.
const othersColumns = computed(() => (otherSlots.value.length <= 2 ? 1 : 2))

// ── 자기 타일 상태 — 프리뷰·게임 참여 가능 여부는 로컬 캡처 기준, "보이는지"는 발행 상태 기준 ──
const demoMic = ref(initialMicOn.value)
/** 로컬 캡처 동작 중(프리뷰 표시·게임 참여 가능) */
const captureOn = computed(() => camera.isOn.value)
/** 카메라 켜짐(발행 상태) — 내 타일 프리뷰 표시 여부도 이 값 기준. 미연결 데모에선 캡처와 동일. */
const selfCamOn = computed(() => (connected.value ? lk.cameraEnabled.value : camera.isOn.value))
const selfMicOn = computed(() => (connected.value ? !!lkLocal.value?.micOn : demoMic.value))
const selfIsHost = computed(
  () => amRoomHost.value || (!!lkLocal.value && lkLocal.value.identity === hostId.value),
)

/**
 * 방장이 지금 이 방에 실제로 접속해 있는지. LiveKit identity가 hostUserId와 같은 값이라 바로 비교한다
 * (LivekitTokenSigner가 subject(principal.userId())로 발급 — 토큰 sub·hostUserId·identity가 모두 동일 규격).
 *
 * 방 멤버 목록으로는 알 수 없다 — 방을 만든 시점에 이미 멤버로 등록되므로 기기 점검 화면에 있어도 멤버다.
 */
const hostInRoom = computed(
  () => !!hostId.value && lk.participants.value.some((p) => p.identity === hostId.value),
)

/**
 * 방장 입장 대기 오버레이 노출 여부.
 *
 * connected를 조건에 넣는 이유 — 접속 중에는 참가자 목록이 비어 있어서 방장이 이미 있는 방에서도
 * 잠깐 "대기 중"이 뜬다. 접속이 끝난 뒤에 판단해야 깜빡이지 않는다.
 * 방장 자신에게는 띄우지 않는다(자기를 기다릴 수 없다).
 */
const showHostWaiting = computed(
  () => detailLoaded.value && connected.value && !amRoomHost.value && !hostInRoom.value,
)

const selfVideoEl = ref<HTMLVideoElement>()
// 모션 인식 입력은 항상 로컬 캡처 스트림을 쓴다 — 카메라를 꺼도(발행 mute) 스트림 연결은
// 유지되어 게임 입력이 계속 흐른다. 프리뷰 표시 여부만 selfCamOn(발행 상태)으로 가린다.
watch(
  [() => camera.stream.value, selfVideoEl],
  ([stream, el], _prev, onCleanup) => {
    if (!el || !stream) return
    el.srcObject = stream
    onCleanup(() => {
      el.srcObject = null
    })
  },
  { immediate: true },
)

// ── 데모 상태 ────────────────────────────────
const speakerOn = ref(true)
const screenOn = ref(false)
const picker = ref(false)

// 탭 닫기·주소창 이탈 시 keepalive 퇴장 통보 + bfcache 복원 시 로비로(뒤로가기 복귀 차단)
useRoomUnloadLeave(() => route.query.room as string | undefined)

onMounted(async () => {
  bgm.setVolume(0.2)

  // 정원/방장 조회(실패해도 진행) → LiveKit 접속(방 멤버만 토큰 발급됨)
  try {
    const d = await roomsApi.detail(roomCode.value)
    // 문서 이탈(탭 닫기·주소창 이동)로 이미 퇴장한 뒤 뒤로가기·직접 URL로 돌아온 경우 —
    // 방 멤버가 아니므로 게임룸을 그리지 않고 로비로 보낸다.
    const myId = myParticipantId.value
    if (myId && !d.members.some((m) => m.userId === myId)) {
      leavingIntentionally = true
      void router.replace({ name: RouteName.Lobby })
      return
    }
    applyDetail(d)
  } catch (e) {
    // 예전에는 조용히 넘겼지만(백엔드 미연동 시절), 이제 이 응답이 방장 판별의 유일한 근거다.
    // 실패하면 아무도 방장로 보이지 않으므로 반드시 드러내야 한다.
    console.error('[game-room] 방 상세 조회 실패 — 방장 판별 불가', e)
    flash(
      e instanceof ApiError
        ? `방 정보를 불러오지 못했어요 (${e.code})`
        : '방 정보를 불러오지 못했어요',
    )
  }
  // 로컬 캡처는 항상 켠다 — 모션 인식 게임의 입력원이라 카메라를 "꺼도" 게임 시작·참여가
  // 가능해야 한다. "카메라 끄기"는 발행·표시만 끈다: 입장 전 화면에서 껐다면 발행하지 않아
  // 내 타일과 다른 사람 화면 모두 꺼져 보이고, 방 안에서 카메라를 켜면 그때 발행한다.
  const stream = await camera.start(CAMERA_CONSTRAINTS)
  if (!stream) flash('카메라를 켤 수 없어요(권한/장치 확인)')
  const ok = await lk.connect(roomCode.value, {
    cameraTrack: initialCamOn.value ? (stream?.getVideoTracks()[0] ?? null) : null,
    microphone: initialMicOn.value,
  })
  if (!ok) flash('실시간 서버에 연결하지 못했어요 · 카메라 미리보기만 가능해요')

  // 채팅은 이력이 없어서(비영속) 구독이 늦은 만큼 그대로 유실 — 입장 직후 바로 연결.
  void roomChat.connect(roomCode.value)
})
onBeforeUnmount(() => {
  roomChat.disconnect()
})

// ── 채팅 ────────────────────────────────────
// 표시용 말풍선 — 서버에서 수신한 메시지만 여기 담긴다(발신 시 로컬 append 금지: 자기 메시지도 topic으로 에코됨).
interface ChatBubble { id: number; chatId: string; userId: string; nickname: string; text: string; me: boolean; kind: ChatMessage['type']; gameName: string | null; fading?: boolean }
const bubbles = ref<ChatBubble[]>([])
const draft = ref('')
let bubbleId = 0
const CHAT_MAX_LEN = 500
const CHAT_LOG_MAX = 6
const BUBBLE_LIFETIME_MS = 5200
const BUBBLE_FADE_MS = 400

// 채팅 독 위 떠있는 로그 — 스크롤 없이 최근 6개만 보여주고 그 이전 건 그냥 사라진다.
const visibleBubbles = computed(() => bubbles.value.slice(-CHAT_LOG_MAX))

// 채팅 전체보기 — 자동으로 사라지는 bubbles와 달리, 입장 이후 전체 이력을 그대로 보여준다.
const chatExpanded = ref(false)
const allBubbles = computed<ChatBubble[]>(() =>
  roomChat.messages.value.map((m, i) => ({
    id: i,
    chatId: m.chatId,
    userId: m.userId,
    nickname: m.nickname,
    text: m.text,
    me: m.userId === myParticipantId.value,
    kind: m.type,
    gameName: m.gameName,
  })),
)

watch(roomChat.messages, (all, prev) => {
  const startIdx = prev?.length ?? 0
  for (const m of all.slice(startIdx)) {
    const id = ++bubbleId
    bubbles.value.push({
      id,
      chatId: m.chatId,
      userId: m.userId,
      nickname: m.nickname,
      text: m.text,
      me: m.userId === myParticipantId.value,
      kind: m.type,
      gameName: m.gameName,
    })
    // 게임 제안 카드는 계속 보이게 두고, 일반 채팅만 잠시 후 사라진다.
    // (6개 초과로 밀려날 때는 그대로 바로 사라지고, 시간이 지나 사라질 때만 흐려지며 사라진다)
    if (m.type === 'TALK') {
      setTimeout(() => {
        const target = bubbles.value.find((b) => b.id === id)
        if (target) target.fading = true
      }, BUBBLE_LIFETIME_MS - BUBBLE_FADE_MS)
      setTimeout(() => (bubbles.value = bubbles.value.filter((b) => b.id !== id)), BUBBLE_LIFETIME_MS)
    }
  }
})
watch(
  () => roomChat.lastError.value,
  (e) => {
    if (e) flash(e.message)
  },
)

function send() {
  const t = draft.value.trim()
  if (!t || t.length > CHAT_MAX_LEN) return
  roomChat.sendChat(t)
  draft.value = ''
}

/** Enter 전송 — 한글 IME 조합을 커밋하는 Enter는 무시한다.
 *  macOS IME는 조합을 열어둔 채 유지해서 조합 중 Enter 시 keydown이 두 번 오고
 *  (커밋용 isComposing/229 + 실제 Enter) 그대로 두면 채팅이 두 번 전송된다. */
function sendOnEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  send()
}

// ── 채팅 메시지 신고 (v0.2.17, -132) ─────────────────────────
// 원문·작성자는 보내지 않는다 — 서버가 chatId로 Redis에서 직접 읽어 전후 맥락과 함께 영속(조작 신고 차단).
// 회원 전용(게스트는 버튼 자체를 숨김) · 내 메시지 불가 · 방을 나가면(폭파 포함) 신고 불가.
interface ReportTarget { chatId: string; nickname: string; text: string }
const isMember = computed(() => readAccessClaims()?.type === 'member')
const reportTarget = ref<ReportTarget | null>(null)
const reportReason = ref<ChatReportReason | null>(null)
const reportDetail = ref('')
const reportSubmitting = ref(false)
const canSubmitReport = computed(() => canSubmitChatReport(reportReason.value, reportDetail.value))

function openReport(b: ChatBubble) {
  reportTarget.value = { chatId: b.chatId, nickname: b.nickname, text: b.text }
  reportReason.value = null
  reportDetail.value = ''
}
function closeReport() {
  reportTarget.value = null
}
async function submitReport() {
  if (!reportTarget.value || !reportReason.value || !canSubmitReport.value || reportSubmitting.value) return
  reportSubmitting.value = true
  try {
    await chatReportsApi.create({
      roomId: roomCode.value,
      chatId: reportTarget.value.chatId,
      reason: reportReason.value,
      detail: reportDetail.value.trim() || undefined,
    })
    flash('신고가 접수됐어요')
    reportTarget.value = null
  } catch (e) {
    flash(e instanceof ApiError ? chatReportErrorMessage(e.code, e.message) : '신고 접수에 실패했어요')
  } finally {
    reportSubmitting.value = false
  }
}

// ── 유저 신고 (방 코드 왼쪽 버튼 — 현재 접속한 참가자 중에서 고르거나, 목록에 없으면 닉네임 직접 입력) ──
const USER_REPORT_OTHER = 'OTHER'
const userReportOpen = ref(false)
// 참가자를 고르면 identity, 목록에 없는 다른 유저를 고르면 USER_REPORT_OTHER
const userReportSelection = ref('')
const userReportNickname = ref('')
const userReportText = ref('')

const canSubmitUserReport = computed(() => {
  if (!userReportSelection.value || !userReportText.value.trim()) return false
  if (userReportSelection.value === USER_REPORT_OTHER && !userReportNickname.value.trim()) return false
  return true
})

function openUserReport() {
  userReportOpen.value = true
  userReportSelection.value = ''
  userReportNickname.value = ''
  userReportText.value = ''
}
function closeUserReport() {
  userReportOpen.value = false
}
async function submitUserReport() {
  if (!canSubmitUserReport.value || reportSubmitting.value) return
  const content = userReportText.value.trim()
  const target = remotes.value.find((p) => p.identity === userReportSelection.value)
  // 목록의 참가자는 identity(userId)를 알지만, 직접 입력한 닉네임은 신고 대상 ID를 알 수 없어(닉네임→ID 조회 API 미제공)
  // reasonText에 닉네임을 함께 담아 보낸다.
  const nickname = target ? target.name : userReportNickname.value.trim()
  const reportedUserId = target ? Number(target.identity) : 0
  reportSubmitting.value = true
  try {
    await reportsApi.report({
      reportedUserId,
      reasonType: USER_REPORT_OTHER,
      reasonText: `[닉네임: ${nickname}] ${content}`,
    })
    flash('신고가 접수됐어요')
    userReportOpen.value = false
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '신고 접수에 실패했어요')
  } finally {
    reportSubmitting.value = false
  }
}

// 방장이 제안받은 게임을 그대로 선택 — 기존 방장 START 흐름과 동일 처리(실제 게임 빌드 전이라 준비 중 안내).
function selectSuggested(gameName: string | null) {
  if (!gameName) return
  flash(`${gameName} 는 준비 중이에요`)
}

// ── 카메라 / 마이크 컨트롤 ───────────────────
// 카메라 토글 = 발행만 켜고 끔(다른 사람에게 보일지). 캡처는 유지되므로 꺼도 게임 참여 가능.
async function toggleCam() {
  // 캡처 자체가 없으면(권한 거부·데모에서 끔) 캡처부터 시작
  if (!camera.isOn.value) {
    const s = await camera.start(CAMERA_CONSTRAINTS)
    if (!s) {
      flash('카메라 권한을 허용해 주세요')
      return
    }
    const track = s.getVideoTracks()[0]
    if (connected.value && track) await lk.publishCameraTrack(track)
    return
  }
  if (connected.value) {
    // 발행된 카메라가 없으면(입장 시 발행 실패) 지금 발행한다
    if (!(await lk.toggleCamera())) {
      const track = camera.stream.value?.getVideoTracks()[0]
      if (track) await lk.publishCameraTrack(track)
    }
    return
  }
  // 미연결 데모 — 발행 개념이 없으니 캡처를 통째로 끈다
  camera.stop()
}
async function toggleMic() {
  if (connected.value) {
    await lk.toggleMicrophone()
    return
  }
  demoMic.value = !demoMic.value
}

// ── 게임 선택 (방장: 바로 시작 / 참가자: 제안) ─
// 서버엔 제안 발신 rate-limit이 없어 연타하면 방 전체에 도배되므로, 버튼에 짧은 쿨다운을 둔다.
const SUGGEST_COOLDOWN_MS = 3000
const suggestCooldown = ref(false)

// ── 게임 세션 (STOMP, S15P11A706-115/116) ────
// GAME_START 수신 시 전원의 셀프 타일 위에 게임이 마운트된다. 타이머 권위는 서버 —
// startAt/endAt(서버 epoch millis)과 serverNow 기반 시계 오프셋을 게임 컴포넌트에 내려준다.
// STOMP 미연결(백엔드 미연동 데모)일 때는 로컬 솔로 플레이로 폴백.
const activeGame = ref<GameEntry | null>(null)
const activeSession = ref<ActiveGameSession | null>(null)
const gameResults = ref<GameResultEntry[] | null>(null)
/** 게임④(-86): POSE_SET으로 도착한 출제 포즈(랜드마크 JSON) — 벽 생성 입력 */
const poseChallenge = ref<string | null>(null)

// ── 게임 화면 송출 — 게임 중에는 카메라와 함께 게임 캔버스를 화면공유 트랙으로 발행한다.
// 다른 참가자는 타일마다 게임 화면 ↔ 카메라를 토글로 골라 본다(ParticipantTile).
// 표시되지 않는 쪽은 adaptiveStream·dynacast가 자동으로 쉬게 하므로 부하는 보는 만큼만 든다.
const gameComp = ref<{ canvas?: HTMLCanvasElement } | null>(null)

// 캔버스가 준비되면 송출 시작. 게임 캔버스에는 카메라 원본이 그려지지 않으므로(밤하늘+손 포인트)
// 카메라를 숨긴 상태여도 계속 송출하고, 캡처가 끊겨 새 프레임이 없을 때만 가린다(정지 화면 방지).
// 라운드가 끝나면(GAME_END 수신) 결과 화면을 닫지 않아도 송출을 내린다 — gameTrack이 사라지면서
// 모든 참가자 타일이 카메라로 복귀하고 게임/카메라 토글도 함께 사라진다. 다음 GAME_START에서
// gameResults가 초기화되면 같은 watch가 재발행한다.
watch(
  [() => gameComp.value?.canvas ?? null, captureOn, gameResults],
  async ([canvas, capOn, results]) => {
    if (!activeGame.value || !canvas) return
    if (results) {
      await lk.unpublishGameScreen()
      return
    }
    if (await lk.publishGameScreen(canvas)) await lk.setGameScreenMuted(!capOn)
  },
)

// 실시간 스코어보드(S15P11A706-82) — PROGRESS/PLAYER_FINISHED 수신으로 갱신
interface LiveScoreRow {
  nickname: string
  starsLit: number
  holdProgress: number
  finished: boolean
  score: number | null
}
const liveScores = ref<Record<string, LiveScoreRow>>({})
/** 게임④(-9) 전용 — score(GRADE_POINTS 역산: 100/85/70/그 외)로 등급 배지를 보여준다 */
const BODY_FIT_GRADE: Record<number, { label: string; color: string }> = {
  100: { label: 'PERFECT', color: '#b98bff' },
  85: { label: 'GREAT', color: '#45e0a8' },
  70: { label: 'PASS', color: '#ffcf4d' },
}
function bodyFitGrade(score: number) {
  return BODY_FIT_GRADE[score] ?? { label: 'FAIL', color: '#ff5d73' }
}
const scoreboardRows = computed(() => {
  const rows = Object.entries(liveScores.value).map(([userId, r]) => ({ userId, ...r }))
  rows.sort(
    (a, b) =>
      Number(b.finished) - Number(a.finished) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      b.starsLit - a.starsLit,
  )
  return rows
})

watch(roomChat.gameEvents, (all, prev) => {
  for (const e of all.slice(prev?.length ?? 0)) {
    applyGameEvent(e)
  }
})
function applyGameEvent(e: GameEvent) {
  if (e.type === 'GAME_START') {
    const entry = GAME_CATALOG.find((g) => g.gameId === e.gameId)
    if (!entry) return
    gameResults.value = null
    liveScores.value = {}
    poseChallenge.value = null
    activeSession.value = {
      sessionId: e.sessionId,
      constellationKey: e.constellationKey,
      startAt: e.startAt,
      endAt: e.endAt,
      clockOffset: e.serverNow - Date.now(),
      setterUserId: e.setterUserId ?? null,
      difficulty: e.difficulty ?? null,
      roundNo: e.roundNo ?? null,
      totalRounds: e.totalRounds ?? null,
    }
    activeGame.value = entry
    picker.value = false
    if (!captureOn.value) flash('카메라를 켜면 게임에 참여할 수 있어요')
    return
  }
  // 이하 이벤트는 현재 세션 것만 반영(닫은 뒤 늦게 도착한 프레임 방어)
  if (activeSession.value?.sessionId !== e.sessionId) return
  if (e.type === 'POSE_SET') {
    poseChallenge.value = e.challenge
    return
  }
  if (e.type === 'PROGRESS') {
    const row = liveScores.value[e.userId]
    if (row?.finished) return // 완주 확정 후의 늦은 진행 프레임은 무시
    liveScores.value[e.userId] = {
      nickname: e.nickname,
      starsLit: e.starsLit,
      holdProgress: e.holdProgress,
      finished: false,
      score: null,
    }
    return
  }
  if (e.type === 'PLAYER_FINISHED') {
    liveScores.value[e.userId] = {
      nickname: e.nickname,
      starsLit: e.starsHit,
      holdProgress: 1,
      finished: true,
      score: e.score,
    }
    return
  }
  if (e.type === 'GAME_END') {
    gameResults.value = e.results
  }
}

function openPicker() {
  picker.value = true
}
async function launch(g: GameEntry, difficulty?: string) {
  picker.value = false
  // 방장 + 서버 연결 + 플레이 가능 → 서버에 시작 요청. GAME_START가 방 전체에 돌아와 마운트된다.
  if (g.playable && roomChat.connected.value && selfIsHost.value) {
    if (!captureOn.value) {
      flash('카메라를 켜고 시작해 주세요')
      return
    }
    // 게임④(-9): 출제자는 관전하는 룰이라 1인 방에선 라운드가 성립 안 함 —
    // 시작 시점 인원을 재조회해 혼자면 서버 세션 없이 로컬 연습 모드로 돌린다.
    if (g.id === 'shape' && (await memberCountNow()) < 2) {
      flash('혼자 있어서 연습 모드로 시작해요 — 출제와 플레이를 모두 해요')
      activeSession.value = null
      activeGame.value = g
      return
    }
    roomChat.startGame(g.gameId, undefined, difficulty)
    return
  }
  // 서버 미연동 데모 — 로컬 솔로 플레이 폴백
  if (g.playable && !roomChat.connected.value) {
    if (!captureOn.value) {
      flash('카메라를 켜야 게임을 플레이할 수 있어요')
      return
    }
    activeGame.value = g
    return
  }
  if (selfIsHost.value) {
    // 실제 게임 빌드가 아직 없음 → 준비 중 안내. (연동 시 여기서 게임 URL/캔버스 로드)
    flash(`${g.name} 는 준비 중이에요`)
    return
  }
  if (suggestCooldown.value) return
  roomChat.suggestGame(g.gameId, g.name)
  suggestCooldown.value = true
  setTimeout(() => (suggestCooldown.value = false), SUGGEST_COOLDOWN_MS)
}

/** 시작 클릭 시점의 실제 방 인원 — 조회 실패 시 2로 간주해 정상(서버 시작) 경로로 보낸다 */
async function memberCountNow(): Promise<number> {
  try {
    return (await roomsApi.detail(roomCode.value)).members.length
  } catch {
    return 2
  }
}

/** 게임 컴포넌트의 진행 상황(컴포넌트에서 300ms 스로틀) → 서버 중계 */
function onGameProgress(starsLit: number, holdProgress: number) {
  if (activeSession.value && !gameResults.value) roomChat.sendGameProgress(starsLit, holdProgress)
}

function onGameFinished(r: { constellation: string; score: number; starsHit: number; starsTotal: number }) {
  if (activeSession.value) {
    // 서버가 최초 1회만 수리하고 PLAYER_FINISHED → (전원 완주 시) GAME_END를 배포한다.
    roomChat.sendGameFinish(r.score, r.starsHit)
    return
  }
  // 솔로 폴백 — 결과를 토스트로만 알린다.
  flash(`✨ ${r.score}점 · 별 ${r.starsHit}/${r.starsTotal}`)
}

/** 게임④(-86): 출제자가 캡처한 포즈(랜드마크 JSON)를 서버로 — POSE_SET이 방 전체에 돌아온다 */
function onPoseSubmit(pose: string) {
  if (activeSession.value && !gameResults.value) roomChat.sendPoseSubmit(pose)
}

function onBodyFitFinished(r: { score: number; grade: string; iou: number }) {
  if (activeSession.value) {
    // 서버가 최초 1회만 수리하고 PLAYER_FINISHED → (전원 완주 시) GAME_END를 배포한다.
    roomChat.sendGameFinish(r.score, 0)
    return
  }
  flash(`🧱 ${r.grade} · 일치율 ${Math.round(r.iou)}%`)
}

function closeGame() {
  void lk.unpublishGameScreen()
  activeGame.value = null
  activeSession.value = null
  gameResults.value = null
  liveScores.value = {}
  poseChallenge.value = null
}

function copyCode() {
  navigator.clipboard?.writeText(shareCode.value)
  flash('룸 코드를 복사했어요')
}

// ── 방 정보 수정 (-130, 방장·대기실 전용) ──────
const settingsOpen = ref(false)
const settingsInitial = ref<NewRoom | null>(null)
const settingsSubmitting = ref(false)

/**
 * 열 때 상세를 다시 조회한다 — 프리필값과 정원 하한(현재 인원)을 최신으로 맞추려고.
 * 비밀번호는 상세 응답에 없어서(참가자 전원에게 내려가는 응답이라 일부러 제외) 방장 전용
 * 엔드포인트로 따로 받아 프리필한다.
 */
async function openSettings() {
  let password: string | undefined
  try {
    applyDetail(await roomsApi.detail(roomCode.value))
    if (roomVisibility.value === 'PRIVATE') {
      password = (await roomsApi.password(roomCode.value)).password ?? undefined
    }
  } catch {
    // 조회 실패 시엔 화면에 들고 있던 값으로 연다(제출은 서버가 다시 검증한다)
  }
  settingsInitial.value = {
    title: roomTitle.value ?? '',
    visibility: roomVisibility.value === 'PRIVATE' ? '비밀' : '공개',
    max: String(capacity.value),
    password,
  }
  settingsOpen.value = true
}

async function submitSettings(payload: NewRoom) {
  if (settingsSubmitting.value) return
  settingsSubmitting.value = true
  try {
    // 전체 상태 재전송(명세 §4) — 제목만 바꿔도 4필드를 다 보낸다.
    applyDetail(
      await roomsApi.update(roomCode.value, {
        title: payload.title,
        visibility: payload.visibility === '비밀' ? 'PRIVATE' : 'PUBLIC',
        maxPlayers: Number(payload.max),
        password: payload.visibility === '비밀' ? payload.password : undefined,
      }),
    )
    settingsOpen.value = false
    flash('방 정보를 수정했어요')
  } catch (e) {
    // ROOM_GAME_IN_PROGRESS는 입장(-70)과 공용 코드라 서버 메시지가 "입장할 수 없습니다"다 —
    // 수정 맥락에 맞지 않으니 이 코드만 문구를 갈아끼운다.
    if (e instanceof ApiError) {
      flash(
        e.code === 'ROOM_GAME_IN_PROGRESS'
          ? '게임 중에는 방 정보를 수정할 수 없어요'
          : e.message,
      )
    } else {
      flash('방 정보 수정에 실패했어요')
    }
  } finally {
    settingsSubmitting.value = false
  }
}

// 다른 참가자(방장 포함)가 방 정보를 바꾸면 STOMP로 즉시 반영 — 정원이 바뀌면 슬롯 수와
// 게임 선택 가능 여부(-24)도 함께 재평가된다.
watch(
  () => roomChat.roomUpdated.value,
  (e) => {
    if (!e) return
    roomTitle.value = e.title
    capacity.value = e.maxPlayers
    roomVisibility.value = e.visibility
  },
)

/**
 * 방장 위임(-72) 반영. 방장이 나가면 서버가 남은 참가자 중 가장 먼저 들어온 사람에게 넘기고
 * LiveRoomHostChangedEvent를 쏜다. 이걸 반영하지 않으면 서버 hostUserId는 바뀌었는데 화면은
 * 입장 시 조회한 값을 계속 들고 있어 <b>아무에게도 시작 권한이 안 보인다</b>(새로고침해야 정상화).
 *
 * 방장이 바뀌는 건 조용히 지나가면 안 되는 변화라 안내도 띄운다 — 특히 내가 방장이 된 경우.
 */
watch(
  () => roomChat.hostChanged.value,
  (e) => {
    if (!e) return
    hostId.value = e.hostUserId
    hostName.value = e.hostDisplayName
    // 결과만 알리면 "왜 갑자기?"가 되므로 원인(방장 퇴장)을 함께 붙인다.
    flash(
      e.hostUserId === myParticipantId.value
        ? '방장이 나가서 내가 새 방장이 되었어요'
        : `방장이 나가서 ${e.hostDisplayName}님이 새 방장이 되었어요`,
    )
  },
)
// 헤더 링크·뒤로가기 등으로 방을 벗어나려 하면 확인 모달. "나가기" 같은 의도된 이동은 통과.
let leavingIntentionally = false
const showLeaveConfirm = ref(false)
let resolveLeave: ((ok: boolean) => void) | null = null
onBeforeRouteLeave(() => {
  if (leavingIntentionally) return true
  showLeaveConfirm.value = true
  return new Promise<boolean>((resolve) => (resolveLeave = resolve))
})
async function answerLeave(ok: boolean) {
  showLeaveConfirm.value = false
  if (ok) await notifyLeave()
  resolveLeave?.(ok)
  resolveLeave = null
}

// 백엔드 퇴장 통보 + LiveKit 연결 정리. "LEAVE" 버튼과 확인 모달("나가기") 양쪽 경로에서 공유.
async function notifyLeave() {
  const id = route.query.room as string | undefined
  if (id) {
    try {
      await roomsApi.leave(id)
    } catch {
      // 방이 이미 없어졌거나 네트워크 오류여도 클라이언트 퇴장은 계속 진행
    }
  }
  await lk.disconnect()
  camera.stop()
}

async function leave() {
  leavingIntentionally = true
  await notifyLeave()
  router.push({ name: RouteName.Lobby })
}

const startLabel = computed(() => (amRoomHost.value ? 'START' : '제안'))
const startHint = computed(() =>
  !detailLoaded.value
    ? '방 정보를 불러오는 중…'
    : amRoomHost.value
      ? '게임을 선택하고 시작!'
      : '하고 싶은 게임을 제안해보세요',
)
</script>

<template>
  <div class="room-shell">
    <!-- 상단 바 -->
    <AppHeader />

    <div class="room-ribbon">
      <span class="px-kicker"><i /> {{ roomTitle ?? 'LIVE PARTY ROOM' }}</span>
      <b>{{ roomGame }}</b>

      <!-- 유저 신고 (방 코드 왼쪽) -->
      <button class="ribbon-report" title="유저 신고" @click="openUserReport">
        <ReportIcon :width="16" :height="20" />
      </button>

      <!-- 방 설정 (-130) — 방장만, 대기실에서만. 게임 중엔 서버도 거부하므로 버튼을 숨긴다. -->
      <button
        v-if="amRoomHost && !activeGame"
        class="ribbon-settings"
        title="방 설정"
        @click="openSettings"
      >
        ⚙
      </button>

      <!-- 게임 시작 — 바 정중앙. 힌트 문구는 54px 바에 두 줄이 안 들어가 title 툴팁으로 옮겼다. -->
      <button
        class="px start-btn"
        :class="{ suggest: !amRoomHost }"
        :disabled="!detailLoaded || (!amRoomHost && suggestCooldown)"
        :title="startHint"
        @click="openPicker"
      >
        <span class="play-ico">▶</span>
        <span class="start-title">{{ startLabel }}</span>
      </button>

      <!-- 방 코드 (하단 바에서 이동) -->
      <div class="code-box">
        <span class="px code-cap">ROOM CODE</span>
        <div class="code-line">
          <span class="px code-val">{{ shareCode }}</span>
          <button class="copy" @click="copyCode">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="9" width="11" height="11" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 본문: 내 캠을 크게, 나머지는 인원수에 맞춰 그리드로 배치 -->
    <main class="room-main">
      <div class="cam-stage">
        <!-- 내 캠 — 항상 가장 크게 -->
        <div class="self-tile self-spot">
          <video v-show="selfCamOn" ref="selfVideoEl" autoplay playsinline muted class="self-video" />
          <div v-if="!selfCamOn" class="cam-off">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">
              <path d="M2 6h11v12H2zM16 10l6-4v12l-6-4" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <button class="px cam-on-btn" @click="toggleCam">CAM ON</button>
          </div>
          <!-- 진행 중인 게임 — 게임 캔버스가 셀프 타일을 덮고, 캔버스는 화면공유 트랙으로도
               발행돼 다른 참가자가 타일 토글로 게임 화면을 볼 수 있다(종료 시 발행 해제) -->
          <FingerStarGame
            v-if="activeGame?.id === 'finger'"
            ref="gameComp"
            :video="selfVideoEl ?? null"
            :session="activeSession"
            :results="gameResults"
            :my-user-id="myParticipantId"
            @close="closeGame"
            @progress="onGameProgress"
            @finished="onGameFinished"
          />
          <!-- 게임④ 몸 끼워 맞추기(S15P11A706-9) — 출제 포즈(POSE_SET)는 challenge로 내려준다 -->
          <BodyFitGame
            v-else-if="activeGame?.id === 'shape'"
            ref="gameComp"
            :video="selfVideoEl ?? null"
            :session="activeSession"
            :results="gameResults"
            :my-user-id="myParticipantId"
            :challenge="poseChallenge"
            @close="closeGame"
            @pose-submit="onPoseSubmit"
            @finished="onBodyFitFinished"
          />
          <div class="self-label">
            <span class="c-g">{{ selfIsHost ? 'YOU · HOST' : 'YOU' }}</span>
            <span :style="{ color: selfMicOn ? '#5cbf4a' : '#e85d6e' }">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
            </span>
          </div>
        </div>

        <!-- 나머지 참가자 — 인원수(2~8명)에 맞춰 열 수가 달라지는 그리드 -->
        <div class="others-tray" :style="{ '--cols': othersColumns }">
          <ParticipantTile
            v-for="(slot, i) in otherSlots"
            :key="i"
            :view="slot.view"
            :host="slot.host"
            play-audio
          />
        </div>

        <!-- 실시간 스코어보드 (게임 중, S15P11A706-82) -->
        <div
          v-if="activeSession && !gameResults"
          class="px game-scoreboard"
          :class="{ bf: activeGame?.id === 'shape' }"
        >
          <div class="gs-title">⭐ LIVE SCORE</div>
          <div
            v-for="row in scoreboardRows"
            :key="row.userId"
            class="gs-row"
            :class="{ me: row.userId === myParticipantId }"
          >
            <span class="gs-name">{{ row.nickname }}</span>
            <span
              v-if="activeGame?.id === 'shape' && row.finished"
              class="gs-badge"
              :style="{ color: bodyFitGrade(row.score ?? 0).color, borderColor: bodyFitGrade(row.score ?? 0).color }"
            >
              {{ bodyFitGrade(row.score ?? 0).label }}
            </span>
            <span v-else class="gs-val">{{ row.finished ? `${row.score}점 ✓` : `⭐ ${row.starsLit}` }}</span>
          </div>
          <div v-if="scoreboardRows.length === 0" class="gs-empty">진행 상황 수신 대기 중…</div>
        </div>
      </div>

    </main>

    <!-- 하단 바 -->
    <footer class="room-footer">
      <div class="controls">
        <button class="ctrl" :class="{ off: !speakerOn }" title="스피커" @click="speakerOn = !speakerOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 9a3.5 3.5 0 010 6" /></svg>
        </button>
        <button class="ctrl" :class="{ off: !selfMicOn }" title="마이크" @click="toggleMic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
        </button>
        <button class="ctrl" :class="{ on: selfCamOn }" title="카메라" @click="toggleCam">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="6" width="14" height="12" /><path d="M16 10l6-4v12l-6-4" /></svg>
        </button>
        <button class="ctrl" :class="{ on: screenOn }" title="화면 공유" @click="screenOn = !screenOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="4" width="20" height="13" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        </button>
        <button class="ctrl" title="아바타"><span class="px">☻</span></button>
      </div>

      <!-- 채팅 독 -->
      <div class="chat-dock">
        <div class="chat-log">
          <div class="chat-log-list">
            <div
              v-for="b in visibleBubbles"
              :key="b.id"
              class="px bubble"
              :class="{ me: b.me, suggest: b.kind === 'GAME_SUGGEST', fading: b.fading }"
            >
              <button v-if="!b.me && isMember" class="bubble-report" title="신고" @click="openReport(b)">
                <ReportIcon />
              </button>
              <template v-if="b.kind === 'GAME_SUGGEST'">
                <span class="bubble-name">🎮 {{ b.nickname }}</span> {{ b.text }}
                <button v-if="amRoomHost" class="px suggest-pick" @click="selectSuggested(b.gameName)">
                  이 게임으로 선택
                </button>
              </template>
              <template v-else>
                <span class="bubble-name" :class="{ me: b.me }">{{ b.nickname }}</span> {{ b.text }}
              </template>
            </div>
          </div>
        </div>
        <button
          class="chat-expand"
          :class="{ active: chatExpanded }"
          title="채팅 전체보기"
          @click="chatExpanded = !chatExpanded"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square">
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <input
          v-model="draft"
          placeholder="메시지 입력..."
          maxlength="500"
          @keydown.enter="sendOnEnter"
        />
        <span class="chat-count" :class="{ over: draft.length > 500 }">{{ draft.length }}/500</span>
        <button class="chat-send" @click="send">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
        </button>

        <!-- 채팅 전체보기: 반투명 패널로 입장 이후 전체 대화 표시 -->
        <template v-if="chatExpanded">
          <div class="chat-full-backdrop" @click="chatExpanded = false" />
          <div class="chat-full">
            <div class="chat-full-head">
              <span>채팅 전체보기</span>
              <button class="chat-full-close" @click="chatExpanded = false">✕</button>
            </div>
            <div class="chat-full-body">
              <p v-if="!allBubbles.length" class="chat-full-empty">아직 대화가 없어요</p>
              <div
                v-for="b in allBubbles"
                :key="b.id"
                class="px bubble full"
                :class="{ me: b.me, suggest: b.kind === 'GAME_SUGGEST' }"
              >
                <button v-if="!b.me && isMember" class="bubble-report" title="신고" @click="openReport(b)">
                  <ReportIcon />
                </button>
                <template v-if="b.kind === 'GAME_SUGGEST'">
                  <span class="bubble-name">🎮 {{ b.nickname }}</span> {{ b.text }}
                </template>
                <template v-else>
                  <span class="bubble-name" :class="{ me: b.me }">{{ b.nickname }}</span> {{ b.text }}
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="footer-right">
        <button class="px leave" @click="leave">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 16l4-4-4-4M13 12H3" /></svg>
          LEAVE
        </button>
      </div>
    </footer>

    <!-- 게임 선택 모달 -->
    <GamePicker v-if="picker" @close="picker = false" @launch="launch" />

    <!-- 토스트 -->
    <Transition name="toast">
      <div v-if="toast" class="px room-toast">{{ toast }}</div>
    </Transition>

    <!-- 방 설정 수정 (-130) — 정원 하한은 현재 참가자 수(그 아래로 줄이면 서버가 409) -->
    <CreateRoomModal
      v-if="settingsOpen && settingsInitial"
      :initial="settingsInitial"
      :min-players="Math.max(2, participantCount)"
      heading="방 설정 수정"
      desc="대기실에서만 바꿀 수 있어요. 변경은 참가자 전원에게 바로 반영돼요."
      submit-label="저장"
      @close="settingsOpen = false"
      @create="submitSettings"
    />

    <PixelModal v-if="showLeaveConfirm" @close="answerLeave(false)">
      <h3 class="leave-title">🚪 게임을 떠나시겠어요?</h3>
      <p class="leave-desc">지금 나가면 진행 중인 방에서 나가게 돼요.</p>
      <div class="leave-actions">
        <PixelButton block @click="answerLeave(false)">취소</PixelButton>
        <PixelButton variant="primary" block @click="answerLeave(true)">나가기</PixelButton>
      </div>
    </PixelModal>

    <!-- 채팅 메시지 신고 -->
    <PixelModal v-if="reportTarget" @close="closeReport">
      <h3 class="report-title">🚩 메시지 신고</h3>
      <div class="report-target">
        <span class="report-target-name">{{ reportTarget.nickname }}</span>
        <p class="report-target-text">{{ reportTarget.text }}</p>
      </div>
      <p class="report-label">신고 사유를 선택해 주세요</p>
      <ul class="report-reasons">
        <li v-for="r in CHAT_REPORT_REASONS" :key="r.code">
          <label class="report-option">
            <input type="radio" name="chat-report-reason" :value="r.code" v-model="reportReason" />
            {{ r.label }}
          </label>
          <input
            v-if="r.code === 'ETC' && reportReason === 'ETC'"
            v-model="reportDetail"
            class="report-other-input"
            placeholder="신고 사유를 입력해 주세요"
            :maxlength="CHAT_REPORT_DETAIL_MAX"
          />
        </li>
      </ul>
      <input
        v-if="reportReason && reportReason !== 'ETC'"
        v-model="reportDetail"
        class="report-other-input"
        placeholder="상세 내용 (선택)"
        :maxlength="CHAT_REPORT_DETAIL_MAX"
      />
      <div class="leave-actions">
        <PixelButton block @click="closeReport">취소</PixelButton>
        <PixelButton
          variant="primary"
          block
          :disabled="!canSubmitReport || reportSubmitting"
          @click="submitReport"
        >
          신고하기
        </PixelButton>
      </div>
    </PixelModal>

    <!-- 유저 신고 (방 코드 왼쪽 버튼) -->
    <PixelModal v-if="userReportOpen" @close="closeUserReport">
      <h3 class="report-title">🚩 유저 신고</h3>
      <p class="report-field-label">신고할 유저를 선택해 주세요</p>
      <ul class="report-reasons">
        <li v-for="p in remotes" :key="p.identity">
          <label class="report-option">
            <input type="radio" name="user-report-target" :value="p.identity" v-model="userReportSelection" />
            {{ p.name }}
          </label>
        </li>
        <li v-if="!remotes.length" class="report-user-empty">현재 접속한 다른 참가자가 없어요</li>
        <li>
          <label class="report-option">
            <input type="radio" name="user-report-target" :value="USER_REPORT_OTHER" v-model="userReportSelection" />
            다른 유저(닉네임 직접 입력)
          </label>
          <input
            v-if="userReportSelection === USER_REPORT_OTHER"
            v-model="userReportNickname"
            class="report-other-input"
            placeholder="닉네임을 입력해 주세요"
            maxlength="30"
          />
        </li>
      </ul>
      <p class="report-field-label">신고 내용</p>
      <textarea
        v-model="userReportText"
        class="report-textarea"
        placeholder="신고 사유를 자세히 입력해 주세요"
        maxlength="500"
        rows="4"
      />
      <div class="leave-actions">
        <PixelButton block @click="closeUserReport">취소</PixelButton>
        <PixelButton
          variant="primary"
          block
          :disabled="!canSubmitUserReport || reportSubmitting"
          @click="submitUserReport"
        >
          신고하기
        </PixelButton>
      </div>
    </PixelModal>

    <!-- 방장이 기기 점검을 거치는 동안 먼저 들어온 참가자에게 띄우는 대기 오버레이 -->
    <HostWaitingOverlay
      v-if="showHostWaiting"
      :room-title="roomTitle"
      :host-name="hostName"
      @leave="leave"
    />
  </div>
</template>

<style scoped>
.room-shell {
  width: 100vw;
  height: 100vh;
  min-width: 1120px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: auto;
  background-color: #fff8e9;
  background-image:
    linear-gradient(25deg, transparent 0 47%, rgba(120, 206, 177, 0.1) 47% 53%, transparent 53%),
    linear-gradient(155deg, transparent 0 47%, rgba(239, 104, 114, 0.08) 47% 53%, transparent 53%),
    radial-gradient(rgba(56, 38, 61, 0.09) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 18px 18px;
  color: var(--c-ink-soft);
  font-family: var(--font-pixel);
}
.px { font-family: var(--font-pixel); }
.c-y { color: #f0a815; }
.c-g { color: #5cbf4a; }

/* 이탈 확인 모달 */
.leave-title { margin: 0 0 8px; font-size: 15px; }
.leave-desc { margin: 0 0 18px; font-size: 11px; color: var(--c-muted); line-height: 1.6; }
.leave-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.room-ribbon { flex: none; position: relative; height: 54px; padding: 0 28px; display: flex; align-items: center; gap: 14px; border-bottom: 2px solid rgba(56, 38, 61, .18); background: linear-gradient(110deg, rgba(207, 244, 231, .95), rgba(255, 240, 185, .95)); z-index: 5; }
.room-ribbon .px-kicker { padding: 5px 9px; font-size: 8px; }
.room-ribbon .px-kicker i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-coral); animation: px-blink 1s steps(2) infinite; }
.room-ribbon b { font-size: 12px; }

/* 본문 */
.room-main {
  flex: 1; min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 24px;
}

/* 캠 영역 — 내 캠(왼쪽, 크게) + 나머지 참가자(오른쪽, 인원수에 맞춰 그리드). 화면 안에 스크롤 없이 모두 들어가고,
   카메라 비율은 유지하되 박스를 꽉 채우지는 않는다(letterbox는 object-fit: contain으로 처리). */
.cam-stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: row; gap: 14px; }

/* 게임 중 실시간 스코어보드 — 참가자 트레이 위 오버레이 */
.game-scoreboard {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  min-width: 170px;
  max-height: 60%;
  overflow-y: auto;
  padding: 10px 12px;
  background: rgba(255, 253, 247, 0.96);
  border: 3px solid var(--c-ink-soft);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}
.gs-title { font-size: 8px; color: #f0a815; margin-bottom: 8px; }
.gs-row { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 8px; color: var(--c-ink-soft); }
.gs-row.me .gs-name { color: #f0a815; }
.gs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
.gs-val { color: #5cbf4a; white-space: nowrap; }
.gs-empty { font-size: 7px; color: #a99f86; }
.gs-badge { font-size: 7px; font-weight: 800; padding: 2px 6px; border: 1px solid; border-radius: 6px; white-space: nowrap; }

/* 게임④(-9) 전용 다크 테마 — 인게임 화면(BodyFitGame)과 톤을 맞춘다 */
.game-scoreboard.bf { background: rgba(18, 20, 43, 0.96); border-color: rgba(255, 255, 255, 0.12); }
.game-scoreboard.bf .gs-title { color: #ffcf4d; }
.game-scoreboard.bf .gs-row { color: #eef0ff; }
.game-scoreboard.bf .gs-row.me .gs-name { color: #45e0a8; }
.game-scoreboard.bf .gs-empty { color: #8d90b8; }

/* 자기 타일 — 항상 가장 크게 */
.self-tile.self-spot {
  flex: 0 0 62%;
  min-width: 0;
}
.self-tile {
  position: relative; min-height: 0; overflow: hidden;
  background: #fff; border: 3px solid var(--c-mint); border-radius: 14px 14px 10px 14px;
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
}
.self-video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); background: #eee6cf; }
.cam-off { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; background: #f3ead2; color: #a99f86; }
.cam-off { background: linear-gradient(135deg, var(--c-mint-soft), #fff0c4); }
.cam-on-btn { padding: 10px 16px; border: 3px solid var(--c-ink-soft); border-radius: 11px; background: var(--c-mint); color: #fff; font-size: 9px; box-shadow: var(--shadow-sm); }
.self-label { position: absolute; top: 8px; left: 8px; display: flex; align-items: center; gap: 7px; padding: 6px 9px; background: #fffdf3; border: 2px solid var(--c-ink-soft); font-size: 9px; }

/* 나머지 참가자 그리드 — 열 수(--cols)는 인원수(2~8명)에 따라 스크립트에서 계산, 세로로 쌓인다 */
.others-tray {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(var(--cols, 1), 1fr);
  grid-auto-rows: 1fr;
  gap: 12px;
}

/* 게임 시작 (상단 바 정중앙)
   절대 배치 이유 — 좌우 항목(방 제목·방 코드)의 폭이 상황마다 달라서, flex 흐름에 두면
   버튼이 진짜 중앙에 오지 않고 방 제목 길이에 따라 흔들린다. */
.start-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  border: var(--border-thick); background: #5cbf4a; color: #fff;
  display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 20px;
  border-radius: 12px 12px 9px 12px;
  box-shadow: var(--shadow-sm);
}
.start-btn.suggest { background: var(--c-yellow); color: var(--c-ink-soft); }
.start-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.play-ico { font-size: 14px; }
.start-title { font-size: 11px; }

/* 방 코드 (하단 바, 나가기 버튼 왼쪽) */
.ribbon-report {
  margin-left: auto; flex: none; width: 34px; height: 34px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--c-ink); border-radius: 10px;
  background: #fff; box-shadow: var(--shadow-sm);
}
.ribbon-report:hover { background: #ffe9ea; }
/* 방 설정(-130) — 신고 버튼과 같은 규격. margin-left:auto는 신고 버튼이 이미 갖고 있어 생략. */
.ribbon-settings {
  flex: none; width: 34px; height: 34px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--c-ink); border-radius: 10px;
  background: #fff; box-shadow: var(--shadow-sm); font-size: 15px; line-height: 1;
}
.ribbon-settings:hover { background: var(--c-mint-soft); }
.code-box { border: 2px solid var(--c-ink); background: #fff; padding: 0 12px; height: 38px; display: flex; align-items: center; gap: 8px; border-radius: 11px; box-shadow: var(--shadow-sm); }
.code-cap { font-size: 7px; color: #a99f86; }
.code-line { display: flex; align-items: center; gap: 8px; }
.code-val { font-size: 12px; color: #f0a815; }
.copy { width: 24px; height: 24px; background: #f3ead2; border: 2px solid var(--c-ink-soft); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

/* 하단 바 */
.room-footer {
  flex: none; position: relative;
  /* 3열 그리드 — 채팅(좌) · 컨트롤(중앙) · 나가기(우).
     양쪽을 minmax(0,1fr)로 두면 두 열이 항상 같은 폭이라 가운데가 바의 정중앙에 온다.
     예전엔 컨트롤을 position:absolute로 중앙에 띄웠는데, 흐름에서 빠져 폭을 차지하지 않아
     창이 좁아지면 채팅바·나가기 버튼과 그대로 겹쳤다. 그리드는 중앙 정렬과 밀어내기를 동시에 준다.
     minmax의 0이 중요하다 — 기본 1fr(=minmax(auto,1fr))은 콘텐츠 최소폭 아래로 줄지 않아 넘친다. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center; gap: 16px;
  padding: 14px 22px;
  background: rgba(255, 253, 247, .97);
  border-top: var(--border);
}
/* 행·열을 함께 명시한다 — 마크업 순서는 controls → chat-dock 인데 시각 순서는 채팅이 왼쪽이라
   열만 지정하면 자동 배치 커서가 이미 2열을 지나쳐서 1열(채팅)이 다음 행으로 밀린다. */
/* 크기 고정 — 창을 줄여도 아이콘은 그대로 두고 채팅바(1열, minmax(0,1fr))만 줄어든다.
   더 좁아지면 잘려 나가는 걸 허용한다: 작아진 아이콘이 읽기 어려운 것보다 낫다는 판단. */
.controls { grid-row: 1; grid-column: 2; justify-self: center; display: flex; gap: 10px; }
.ctrl { width: 50px; height: 50px; border: 3px solid var(--c-ink-soft); border-radius: 13px 13px 9px 13px; background: #fff; color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); }
.ctrl.on { background: #d9f2cf; color: #5cbf4a; }
.ctrl.off { background: #fbdbe0; color: #e85d6e; }

.chat-dock { grid-row: 1; grid-column: 1; position: relative; justify-self: start; width: 100%; min-width: 0; max-width: 420px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; height: 52px; background: #fff; border: 3px solid var(--c-ink-soft); border-radius: 14px; box-shadow: var(--shadow-sm); }
.chat-log {
  position: absolute; bottom: 62px; left: 0; width: 100%;
  display: flex; flex-direction: column; gap: 8px;
  overflow: visible;
}
.chat-log-list { display: flex; flex-direction: column; gap: 8px; }
.bubble { position: relative; max-width: 100%; padding: 9px 22px 9px 12px; font-size: 9px; line-height: 1.7; border: 2px solid var(--c-ink-soft); background: #fff; box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); animation: px-bubble 0.2s steps(3); word-break: break-word; overflow-wrap: anywhere; transition: opacity 0.4s ease; }
/* 6개 초과로 밀려날 땐 그대로 바로 사라지고, 시간이 지나 사라질 때만(.fading) 흐려지며 사라진다 */
.bubble.fading { opacity: 0; }
.bubble.me { background: #fff4cc; }
.bubble.suggest { background: var(--c-mint-soft); display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.bubble-name { display: block; margin-bottom: 3px; font-size: 10px; font-weight: 800; color: #2f9e3d; }
.bubble-name.me { color: #c97e00; }
.suggest-pick { border: 2px solid var(--c-ink-soft); border-radius: 8px; background: var(--c-yellow); padding: 5px 8px; font-size: 8px; font-weight: 700; }

/* 메시지 신고 버튼 — 말풍선 안쪽 우상단, 테두리 없이 아이콘만 */
.bubble-report {
  position: absolute; top: 4px; right: 4px; z-index: 1;
  width: 9px; height: 11px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
}
.bubble-report:hover { opacity: 0.75; }

/* 신고 모달 */
.report-title { margin: 0 0 12px; font-size: 15px; }
.report-target { margin-bottom: 14px; padding: 10px 12px; border: 2px solid #eaddea; border-radius: 11px; background: #fdfaf3; }
.report-target-name { font-size: 10px; font-weight: 800; color: #2f9e3d; }
.report-target-text { margin: 5px 0 0; font-size: 11px; color: var(--c-ink-soft); line-height: 1.6; word-break: break-word; overflow-wrap: anywhere; }
.report-label { margin: 0 0 8px; font-size: 10px; color: var(--c-muted); }
.report-reasons { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.report-option { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--c-ink-soft); cursor: pointer; }
.report-user-empty { font-size: 10.5px; color: #a99f86; }
.report-other-input {
  width: 100%; margin-top: 8px; padding: 8px 10px;
  border: 2px solid var(--c-ink-soft); border-radius: 9px;
  font-size: 11px; color: var(--c-ink-soft);
}
.report-field-label { margin: 14px 0 0; font-size: 10px; color: var(--c-muted); }
.report-field-label:first-of-type { margin-top: 0; }
.report-textarea {
  width: 100%; margin: 8px 0 18px; padding: 8px 10px;
  border: 2px solid var(--c-ink-soft); border-radius: 9px;
  font-size: 11px; color: var(--c-ink-soft);
  font-family: inherit; resize: vertical;
}
.chat-dock input { position: relative; z-index: 47; flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--c-ink-soft); font-size: 13px; }
.chat-count { flex: none; font-size: 7px; color: #a99f86; }
.chat-count.over { color: var(--c-coral); }
.chat-send { position: relative; z-index: 47; flex: none; width: 38px; height: 38px; border: 2px solid var(--c-ink-soft); border-radius: 10px; background: var(--c-yellow); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

/* 채팅 전체보기 토글 버튼 — 전체보기 패널이 열려도(배경 오버레이 z-index:45보다 위) 계속 클릭 가능해야 한다 */
.chat-expand { position: relative; z-index: 47; flex: none; width: 32px; height: 32px; border: 2px solid var(--c-ink-soft); border-radius: 9px; background: #fff; color: #a99f86; display: flex; align-items: center; justify-content: center; }
.chat-expand.active { background: var(--c-yellow); color: var(--c-ink-soft); }

/* 채팅 전체보기 패널 — 입장 이후 전체 대화를 반투명하게 보여준다 */
.chat-full-backdrop { position: fixed; inset: 0; z-index: 45; background: transparent; }
.chat-full {
  position: absolute; z-index: 46; bottom: 62px; left: 0;
  width: 100%; min-width: 260px; max-height: min(65vh, 520px);
  display: flex; flex-direction: column;
  background: rgba(255, 253, 247, 0.82);
  backdrop-filter: blur(6px);
  border: 3px solid var(--c-ink-soft);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  animation: px-bubble 0.15s steps(3);
}
.chat-full-head { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 9px; font-weight: 700; color: var(--c-ink-soft); border-bottom: 2px solid rgba(56, 38, 61, .12); }
.chat-full-close { width: 22px; height: 22px; border: 2px solid var(--c-ink-soft); border-radius: 7px; background: #fff; color: var(--c-ink-soft); font-size: 9px; display: flex; align-items: center; justify-content: center; }
.chat-full-body {
  flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-full-body::-webkit-scrollbar { display: none; }
.chat-full-empty { align-self: center; margin: 20px 0; font-size: 9px; color: #a99f86; }
.bubble.full { max-width: none; background: rgba(255, 255, 255, 0.9); }
.bubble.full.me { background: rgba(255, 244, 204, 0.9); }
.bubble.full.suggest { background: rgba(214, 244, 233, 0.9); }

.footer-right { grid-row: 1; grid-column: 3; justify-self: end; display: flex; align-items: center; gap: 10px; }
.leave { display: flex; align-items: center; gap: 9px; padding: 0 18px; height: 52px; border: 3px solid var(--c-ink-soft); border-radius: 14px 14px 10px 14px; background: var(--c-coral); color: #fff; font-size: 9px; box-shadow: var(--shadow-sm); }

.room-toast { position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 13px 20px; background: #fffdf3; border: 3px solid #f0a815; color: #f0a815; font-size: 9px; line-height: 1.7; box-shadow: 5px 5px 0 rgba(43, 35, 51, 0.25); }

.toast-enter-active { animation: px-pop 0.18s steps(3); }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }

@keyframes px-bubble { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
</style>
