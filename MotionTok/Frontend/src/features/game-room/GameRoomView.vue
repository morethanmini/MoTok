<script setup lang="ts">
/** 게임룸 — 화상 파티룸(LiveKit SFU). 방 정원만큼 슬롯을 만들고, 참가자는 실시간 타일로,
 *  빈 자리는 "대기 중"으로 표시한다. 무대/채팅/게임 선택은 데모. */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type AsyncComponentLoader } from 'vue'
import { isChunkLoadError, markBuildOutdated, reloadForNewBuild } from '@/composables/useBuildVersion'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ConnectionState } from 'livekit-client'
import { RouteName } from '@/router/routeNames'
import { roomsApi, friendsApi, reportsApi, chatReportsApi, gamesApi, ApiError, readAccessClaims, type ChatMessage, type ChatReportReason, type KickReason, type InventoryItem } from '@/api'
import type { DrawOp, GameEvent, GameResultEntry, LiveRoomDetail, Visibility } from '@/api/types'
import type { ActiveGameSession } from '@/features/games/session'
import { preferredAudioDeviceId, useCamera } from '@/composables/useCamera'
import { EQUIP_LIMIT, useDecoration } from '@/composables/useDecoration'
import { motionModelsReady, warmUpMotionModels } from '@/composables/motionModels'
import { useDecorSync } from '@/composables/useDecorSync'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import CameraEffectLayer from '@/features/decor/CameraEffectLayer.vue'
import EffectIntensitySlider from '@/features/decor/EffectIntensitySlider.vue'
import { videoFilter } from '@/features/decor/cameraEffect'
import { useLiveKitRoom, type ParticipantView } from '@/composables/useLiveKitRoom'
import { useRoomChat } from '@/composables/useRoomChat'
import { onStompConnected } from '@/composables/useGlobalStomp'
import { useRoomUnloadLeave } from '@/composables/useRoomUnloadLeave'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { containsProfanity } from '@/utils/profanity'
import { GAME_CATALOG, type GameEntry } from './data'
import { CHAT_REPORT_REASONS, CHAT_REPORT_DETAIL_MAX, canSubmitChatReport, chatReportErrorMessage } from './chatReport'
import ParticipantTile from './components/ParticipantTile.vue'
import GamePicker from './components/GamePicker.vue'
import GameSetupModal from './components/GameSetupModal.vue'
import RoomGuideModal from './components/RoomGuideModal.vue'
import { guidePagesOrFallback } from '@/features/games-catalog/guide/pages'
import ReportIcon from './components/ReportIcon.vue'
import HostWaitingOverlay from './components/HostWaitingOverlay.vue'
import InviteFriendsModal from './components/InviteFriendsModal.vue'
import inventoryChest from '@/assets/device-setup/inventory-chest.png'
// 방 정보 수정 모달(-130) — 입력 필드가 방 생성과 동일 규격(명세 §4)이라 로비 모달을 그대로 재사용한다.
import CreateRoomModal, { type NewRoom } from '@/features/lobby/components/CreateRoomModal.vue'
/**
 * MediaPipe 번들(~600KB)이 무거워서 게임을 시작할 때만 로드한다.
 *
 * <p>지연 로딩이라 <b>배포 교체에 취약하다</b> — 배포가 나가면 이 탭이 아는 청크 이름이 서버에서
 * 사라지고, 그때 import는 404로 조용히 실패한다. GAME_START는 정상적으로 받았는데 게임만 안 뜨는
 * 상태가 되어 "시작을 눌렀는데 카메라만 보인다"로 나타난다. 재시도는 소용없다(이름 자체가 틀렸다) —
 * 새 index.html을 받는 것, 즉 새로고침이 유일한 복구다.</p>
 */
function lazyGame(loader: AsyncComponentLoader) {
  return defineAsyncComponent({
    loader,
    onError(error, _retry, fail) {
      if (isChunkLoadError(error)) {
        markBuildOutdated() // 배너를 즉시 띄운다 — 자동 새로고침이 막혀도 사용자는 원인을 알 수 있다
        if (reloadForNewBuild()) return
      }
      fail()
    },
  })
}
const FingerStarGame = lazyGame(() => import('@/features/games/finger-star/FingerStarGame.vue'))
const BodyFitGame = lazyGame(() => import('@/features/games/body-fit/BodyFitGame.vue'))
const FishingGame = lazyGame(() => import('@/features/games/fishing/FishingGame.vue'))
const DrawingRelayGame = lazyGame(() => import('@/features/games/drawing-relay/DrawingRelayGame.vue'))
const CatchRhythmGame = lazyGame(() => import('@/features/games/catch-rhythm/CatchRhythmGame.vue'))
import { useRhythmAutoJoin } from '@/features/games/catch-rhythm/useRhythmAutoJoin'
import { useDraggablePanel } from './useDraggablePanel'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import BrandLogo from '@/components/common/BrandLogo.vue'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
// 퇴장 확인 모달을 띄울지 가리는 데만 쓴다 — 세션이 이미 끝났다면 물을 것이 없다(onBeforeRouteLeave).
const session = useSessionStore()
const bgm = useBgm()
const { message: toast, flash } = useToast(2600)
const soundSettingsOpen = ref(false)
const gameMusicPercent = computed(() => Math.round(bgm.gameMusic.value * 100))
function setGameMusicVolume(e: Event) {
  bgm.setGameMusic(Number((e.target as HTMLInputElement).value) / 100)
}

// LiveKit 실시간 방 + 로컬 카메라 캡처. 프리뷰·모션 인식 게임 입력은 항상 로컬 캡처 스트림을
// 쓰고, LiveKit에는 복제본을 발행한다 — "카메라 끄기"는 발행만 끊어서 다른 사람에게만 꺼져
// 보이고 캡처는 유지되므로, 꺼도 게임 시작·참여가 가능하다.
const lk = useLiveKitRoom()
const camera = useCamera()
const CAMERA_CONSTRAINTS = { video: { width: 640, height: 400 }, audio: false } as const

// 장착 스티커는 영상에 굽지 않고 좌표만 데이터 채널로 알린다 — 받은 쪽이 그 사람 타일에 얹는다.
// 캔버스 합성으로 발행하던 예전 방식은 다른 오리진(S3)에 있는 AI 아이템 이미지를 읽지 못해
// (버킷 CORS 없음) 내 화면에만 보였다.
const decor = useDecoration()
const decorSync = useDecorSync(lk, () => ({
  sprites: decor.sprites.value,
  effect: decor.cameraEffect.value,
}))
const showDecorInventory = ref(false)
const decorBusyItemId = ref<number | null>(null)
const selectedDecorId = ref<number | null>(null)

async function toggleDecorItem(item: InventoryItem) {
  if (decorBusyItemId.value !== null) return
  decorBusyItemId.value = item.itemId
  const equipped = !item.equipped
  const ok = await decor.setEquipped(item.itemId, equipped)
  if (ok) selectedDecorId.value = equipped ? item.itemId : null
  if (!ok && decor.error.value) flash(decor.error.value)
  decorBusyItemId.value = null
}

async function removeDecorSticker(itemId: number) {
  if (await decor.setEquipped(itemId, false)) selectedDecorId.value = null
  else if (decor.error.value) flash(decor.error.value)
}

async function saveGameDecor() {
  if (await decor.save()) flash('카메라 꾸미기를 저장했어요')
  else if (decor.error.value) flash(decor.error.value)
}

/** 발행에 쓸 카메라 트랙 — 원본 캡처 그대로(발행 시점에 복제된다). */
function publishableTrack(stream: MediaStream | null): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null
}

/** 그 참가자 타일에 얹을 스티커 — 타일이 세 레이아웃에서 렌더되므로 조회를 여기 한 곳에 둔다. */
function spritesFor(slot: Slot) {
  return slot.view ? decorSync.spritesOf(slot.view.identity) : []
}

/** 그 참가자 영상에 걸 프레임 효과(뽀샤시) — 스티커와 같은 이유로 여기 한 곳에서 본다. */
function effectFor(slot: Slot) {
  return slot.view ? decorSync.effectOf(slot.view.identity) : null
}

/** 내 캠에 거는 뽀샤시의 영상 쪽 절반(빛 레이어는 CameraEffectLayer가 맡는다). */
const selfCameraFilterStyle = computed(() => {
  const fx = decor.cameraEffect.value
  return fx ? { filter: videoFilter(fx.intensity) } : undefined
})
// 대기실 채팅 + 게임 제안 (STOMP, 명세 §7)
const roomChat = useRoomChat()
const myParticipantId = computed(() => readAccessClaims()?.sub ?? null)

const roomCode = computed(() => (route.query.room as string) || 'MP-4X9K')
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
/** 이미 방에 있는 참가자 — 친구 초대(-100) 목록에서 빼려고 들고 있는다. */
const memberIds = ref<string[]>([])
/** userId → 표시명(상세 조회 기준). 게임④ 출제자 이름·그림으로 말해요 화가 표시가 함께 쓴다. */
const memberNames = ref<Record<string, string>>({})

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
  memberIds.value = d.members.map((m) => m.userId)
  // 신고 대상은 퇴장 뒤에도 남겨야 하므로, 이번 상세 조회에 없는 기존 이름을 지우지 않는다.
  memberNames.value = { ...memberNames.value, ...Object.fromEntries(d.members.map((m) => [m.userId, m.displayName])) }
}

/**
 * 방을 로비 목록에 공개한다 — 방장이 이 화면에 도달한 것이 곧 "이 방은 굴러간다"는 신호다.
 *
 * 방 생성 시점에 공개하면 방장이 기기 점검 화면에 머무는 동안 시작 권한을 가진 사람이 없는 방이
 * 목록에 떠 있게 되고, 거기 들어간 사람은 방장을 부를 수단도 없이 기다리기만 한다.
 * 서버는 방장 여부를 다시 검증하고 멱등하게 처리하므로(이미 공개된 방이면 아무 일도 없다)
 * 새로고침·재입장으로 여러 번 불려도 괜찮다.
 *
 * 실패해도 방 이용에는 지장이 없다(로비 노출만 늦어진다) — 조용히 넘긴다.
 */
async function publishRoom() {
  try {
    await roomsApi.open(roomCode.value)
  } catch {
    /* 목록 노출 실패가 방 이용을 막을 이유는 없다 */
  }
}

/** userId → 닉네임 — 상세 조회 멤버를 기본으로 LiveKit 참가자 이름으로 보강(뒤늦게 들어온 참가자 대응). */
const participantNames = computed<Record<string, string>>(() => {
  const names = { ...memberNames.value }
  for (const p of lk.participants.value) {
    if (p.identity && p.name) names[p.identity] = p.name
  }
  return names
})

/** 이 방 화면에서 확인한 모든 참가자. 퇴장한 유저도 신고 목록에 남긴다. */
const reportTargets = computed(() =>
  Object.entries(participantNames.value)
    .filter(([userId]) => userId !== myParticipantId.value)
    .map(([userId, name]) => ({ userId, name })),
)

// ── 실시간 참가자 → 슬롯 매핑 ────────────────
const connected = computed(() => lk.state.value === ConnectionState.Connected)
const lkLocal = computed(() => lk.participants.value.find((p) => p.isLocal) ?? null)
const remotes = computed(() => lk.participants.value.filter((p) => !p.isLocal))

/** 게임 목록의 "혼자 플레이" 흐름에서만 빈 참가자 슬롯을 숨긴다. */
const isSoloPlay = computed(() => route.query.solo === '1')

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
const othersColumns = computed(() => {
  if (otherSlots.value.length <= 2) return 1
  if (otherSlots.value.length <= 4) return 2
  return 3
})
const isEightPlayerLayout = computed(() => capacity.value === 8)
const isSideBySideLayout = computed(() => capacity.value >= 5 && capacity.value <= 8)
const leftSideSlots = computed(() => otherSlots.value.slice(0, capacity.value <= 6 ? 2 : 3))
const rightSideSlots = computed(() => otherSlots.value.slice(capacity.value <= 6 ? 2 : 3, 7))

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

// 방장 입장 대기 오버레이 — 판정에 activeGame 등 뒤에 선언되는 상태가 필요해서
// 본체는 게임 세션 상태 선언 아래(hostAway watch)에 있다(-164).

const selfVideoEl = ref<HTMLVideoElement>()
const kickTarget = ref<ParticipantView | null>(null)
const kicking = ref(false)
const kickReason = ref<KickReason>('GAME_DISRUPTION')
const KICK_REASONS: ReadonlyArray<{ code: KickReason; label: string }> = [
  { code: 'MANNER_VIOLATION', label: '비매너 행위' },
  { code: 'INAPPROPRIATE_PROFILE', label: '부적절한 프로필' },
  { code: 'GAME_DISRUPTION', label: '게임 진행 방해' },
  { code: 'SPAM_AD', label: '도배·광고' },
  { code: 'OTHER', label: '기타' },
]
function openKick(target: ParticipantView | null) {
  if (!amRoomHost.value || !target) return
  kickReason.value = 'GAME_DISRUPTION'
  kickTarget.value = target
}
function closeKick() {
  if (!kicking.value) kickTarget.value = null
}
async function confirmKick() {
  if (!kickTarget.value || kicking.value) return
  kicking.value = true
  try {
    await roomsApi.kick(roomCode.value, kickTarget.value.identity, kickReason.value)
    flash(`${kickTarget.value.name}님을 방에서 내보냈어요`)
    kickTarget.value = null
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '강퇴 처리에 실패했어요')
  } finally {
    kicking.value = false
  }
}
const selfVideoAspect = ref(8 / 5)
const selfFramePixels = computed(() => ({ w: 640, h: 640 / selfVideoAspect.value }))
function syncSelfVideoAspect() {
  const video = selfVideoEl.value
  if (!video?.videoWidth || !video.videoHeight) return
  selfVideoAspect.value = video.videoWidth / video.videoHeight
}
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
/** 게임을 고른 뒤 모드·난이도를 정하는 설정 창의 대상 게임(-9). null이면 닫힘 */
const setupGame = ref<GameEntry | null>(null)

// bfcache 복원 시 로비로(뒤로가기 복귀 차단). 퇴장 통보는 서버 리퍼에 맡긴다 —
// 새로고침도 pagehide라, 여기서 통보하면 끊긴 사람이 새로고침으로 복구할 길이 막힌다.
useRoomUnloadLeave(() => route.query.room as string | undefined, { unloadLeave: false })

/**
 * 방을 벗어날 때 돌아갈 화면. 게스트를 로비로 보내면 안 된다 — 로비는 회원 전용(requiresMember)이라
 * 라우터 가드가 "로그인이 필요해요"를 띄운다. 방에서 난 오류가 로그인 요구로 둔갑하는 경로가 이것이다.
 * 게스트는 들어온 곳(1인 게임 목록)으로 돌려보낸다.
 */
function exitRoute() {
  return { name: session.isGuest ? RouteName.GamesCatalog : RouteName.Lobby }
}


onMounted(async () => {
  bgm.setVolume(0.2)

  // room 쿼리 없이 들어온 경로(북마크·직접 URL)는 방을 특정할 수 없다 — 예전 폴백 코드
  // ('MP-4X9K')로 존재하지 않는 방 화면("LIVE PARTY ROOM")을 그리는 대신 로비로 보낸다(-164).
  if (!route.query.room) {
    leavingIntentionally = true
    void router.replace(exitRoute())
    return
  }

  // 입장/재입장 → 정원·방장 상태 반영. detail이 아니라 join을 부른다(-164):
  // 새로고침이면 pagehide로 언로드 퇴장 통보가 이미 나갔고, 서버는 유예(10초) 안에 이 join이
  // 오면 퇴장을 없던 일로 한다. 이미 멤버면 멱등이고 재입장은 비밀번호를 다시 묻지 않는다.
  try {
    applyDetail(await roomsApi.join(roomCode.value))
    // 방장이 도착했으니 이제 로비에 내놓는다. LiveKit 접속을 기다리지 않는다 —
    // 접속에 실패해도 방장은 이 화면에 있고, 그때까지 방이 목록에서 빠져 있을 이유가 없다.
    if (amRoomHost.value) void publishRoom()
  } catch (e) {
    // 방이 사라졌거나(ROOM_NOT_FOUND) 게임 중·정원 초과·강퇴 등 — 들어갈 수 없는 방 화면에
    // 유령으로 머무느니 이유를 알리고 로비로 보낸다(-164). main의 ROOM_NOT_FOUND 분기를
    // 포괄한다: 어떤 실패든 이 화면에서 할 수 있는 게 없는 건 같다(방장 판별·자동 시작 불가).
    console.error('[game-room] 방 입장 실패', e)
    flash(e instanceof ApiError ? e.message : '방에 입장하지 못했어요')
    leavingIntentionally = true
    void router.replace(exitRoute())
    return
  }
  // 방 토픽 구독 — 카메라·LiveKit보다 먼저 건다.
  // (1) 채팅은 비영속이라 구독이 늦은 만큼 그대로 유실된다.
  // (2) 이 구독이 서버의 재실 신호다(RoomPresenceTracker). 새로고침으로 돌아온 사람은
  //     유예(RoomPresenceTracker.GRACE_MS) 안에 다시 구독해야 방에 남는데, 카메라 권한 대기와 SFU 접속 뒤로 밀려
  //     있으면 느린 기기에서 그 예산을 넘겨 멀쩡히 돌아오고도 퇴장 처리된다.
  // 연결 전에 불러도 전역 레지스트리가 등록해 뒀다가 붙는 대로 SUBSCRIBE한다 — 기다릴 필요 없다.
  void roomChat.connect(roomCode.value)
  // 로컬 캡처는 항상 켠다 — 모션 인식 게임의 입력원이라 카메라를 "꺼도" 게임 시작·참여가
  // 가능해야 한다. "카메라 끄기"는 발행·표시만 끈다: 입장 전 화면에서 껐다면 발행하지 않아
  // 내 타일과 다른 사람 화면 모두 꺼져 보이고, 방 안에서 카메라를 켜면 그때 발행한다.
  const stream = await camera.start(CAMERA_CONSTRAINTS)
  if (!stream) flash('카메라를 켤 수 없어요(권한/장치 확인)')
  // 접속 직후 방 전체에 알려야 하므로(아래 broadcast) 먼저 읽어 둔다.
  await decor.load()
  // LiveKit 접속 — 일시 장애는 재시도로 흡수하고, 그래도 안 되면 서로 안 보이는 반쪽 방에
  // 머무느니 퇴장 처리 후 로비로 보낸다(-164).
  const cameraTrack = initialCamOn.value ? publishableTrack(stream) : null
  let ok = false
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500))
    ok = await lk.connect(roomCode.value, {
      cameraTrack,
      microphone: initialMicOn.value,
      // 카메라는 로컬 캡처(camera.start)가 이미 고른 장치를 쓰지만, 마이크는 LiveKit이 직접 잡는다.
      microphoneDeviceId: preferredAudioDeviceId(),
    })
  }
  if (!ok) {
    flash('실시간 서버에 연결하지 못했어요 · 이전 화면으로 돌아가요')
    await notifyLeave()
    leavingIntentionally = true
    void router.replace(exitRoute())
    return
  }
  // 이미 있던 사람들에게 내 꾸미기를 알린다(늦게 들어오는 사람은 useDecorSync가 따로 챙긴다).
  decorSync.broadcast()

  // 자동 시작은 여기서부터 가능하다 — 구독(위 roomChat.connect)이 걸린 뒤여야 startGame이
  // 방으로 나가고 서버가 되돌려주는 GAME_START도 받는다. (감시자도 같은 조건을 보지만, 순서를 명시해 둔다)
  tryAutostart()


  // 모션 모델은 로비 스플래시가 이미 받아 뒀을 것이다(싱글턴이라 여기선 즉시 끝난다).
  // 그래도 한 번 더 확인하는 이유 — 주소창으로 방에 바로 들어오거나 게스트로 로비를 건너뛴
  // 경로가 있어서, 그대로 두면 게임 시작 버튼을 누른 뒤에야 17MB를 받기 시작한다.
  // 입장 흐름을 막지 않도록 기다리지 않는다.
  void warmUpMotionModels().then((ready) => {
    if (!ready) flash('모션 인식 모델을 준비하지 못했어요 · 게임 시작이 늦어질 수 있어요')
  })
})
// STOMP 재연결(절전 복귀·네트워크 블립) — 끊긴 동안 방장 이양·강퇴·유령 정리를 놓쳤을 수
// 있다(-164). 재입장(join)이 언로드 유예 철회와 최신 스냅샷 반영을 겸한다.
const offStompReconnect = onStompConnected(() => {
  if (!route.query.room) return
  void roomsApi.join(roomCode.value).then(applyDetail).catch(() => {})
})

onBeforeUnmount(() => {
  offStompReconnect()
  clearTimeout(autostartTimer)
  clearStartAck()
  roomChat.disconnect()
  // BGM은 모듈 싱글턴이라 suspend된 채로 방을 뜨면 로비에서도 영영 안 나온다
  bgm.resumeAfterGame()
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

// 채팅 전체보기 — 자동으로 사라지는 bubbles와 달리, 입장 이후 전체 이력을 보여준다.
// 패널(.chat-full-body)이 column-reverse라 배열은 최신이 앞에 오도록 뒤집는다(-159) —
// 화면상 순서는 그대로 위=과거/아래=최신이지만, 열자마자 최신이 보이고 새 메시지에 하단이 고정되며
// 위로 스크롤해 과거를 읽는 중에는 끌어내리지 않는다. JS 스크롤 제어 없이 브라우저 앵커링에 맡긴다.
// key는 뒤집기 전 인덱스(i) — 메시지가 추가돼도 기존 항목의 key가 밀리지 않는다.
const chatExpanded = ref(false)
const allBubbles = computed<ChatBubble[]>(() =>
  // 이력(-164, 새로고침 전 대화) + 실시간 수신을 합쳐 보여준다. 이력은 말풍선을 띄우지 않고
  // 전체보기에만 나타난다(useRoomChat.history 주석 참고).
  [...roomChat.history.value, ...roomChat.messages.value]
    .map((m, i) => ({
      id: i,
      chatId: m.chatId,
      userId: m.userId,
      nickname: m.nickname,
      text: m.text,
      me: m.userId === myParticipantId.value,
      kind: m.type,
      gameName: m.gameName,
    }))
    .reverse(),
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
    // 게임 제안 카드도 일반 채팅과 동일하게 잠시 후 사라진다.
    // (6개 초과로 밀려날 때는 그대로 바로 사라지고, 시간이 지나 사라질 때만 흐려지며 사라진다)
    setTimeout(() => {
      const target = bubbles.value.find((b) => b.id === id)
      if (target) target.fading = true
    }, BUBBLE_LIFETIME_MS - BUBBLE_FADE_MS)
    setTimeout(() => (bubbles.value = bubbles.value.filter((b) => b.id !== id)), BUBBLE_LIFETIME_MS)
  }
})
watch(
  () => roomChat.lastError.value,
  (e) => {
    if (!e) return
    // 시작 거부는 사유가 붙어 오므로 그쪽이 더 정확하다 — 대기 타이머의 막연한 안내를 겹치지 않게 끈다.
    if (e.path?.endsWith('/game/start')) clearStartAck()
    flash(e.message)
  },
)

// 도배 선차단(-159) — 서버(ChatRateLimiter)와 같은 기준(5초 5건)으로 전송 전에 막고 바로 안내한다.
// 서버가 최종 방어선이고, 여기서는 소용없는 프레임을 줄이고 즉각 피드백을 주는 게 목적.
const CHAT_BURST_MAX = 5
const CHAT_BURST_WINDOW_MS = 5000
let chatSentTimes: number[] = []

function send() {
  const t = draft.value.trim()
  if (!t || t.length > CHAT_MAX_LEN) return
  const now = Date.now()
  chatSentTimes = chatSentTimes.filter((ts) => now - ts < CHAT_BURST_WINDOW_MS)
  if (chatSentTimes.length >= CHAT_BURST_MAX) {
    flash('채팅을 너무 자주 보냈어요 · 잠시 후 다시 보내 주세요')
    return
  }
  chatSentTimes.push(now)
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
// 참가자 목록에서 '다른 유저'를 고른 상태를 나타내는 화면 전용 값 — 서버 사유 코드가 아니다.
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
  const target = reportTargets.value.find((p) => p.userId === userReportSelection.value)
  // 목록의 참가자는 identity(userId)를 알지만, 직접 입력한 닉네임은 신고 대상 ID를 알 수 없어(닉네임→ID 조회 API 미제공)
  // reasonText에 닉네임을 함께 담아 보낸다.
  const nickname = target ? target.name : userReportNickname.value.trim()
  const reportedUserId = target ? Number(target.userId) : 0
  reportSubmitting.value = true
  try {
    await reportsApi.report({
      reportedUserId,
      // 서버 ReportReason 에 OTHER 는 없다(ETC). 이 화면은 사유를 고르지 않고 자유 입력만 받으므로 ETC로 보낸다.
      reasonType: 'ETC',
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
    const track = publishableTrack(s)
    if (connected.value && track) await lk.publishCameraTrack(track)
    return
  }
  if (connected.value) {
    // 발행된 카메라가 없으면(입장 시 발행 실패) 지금 발행한다
    if (!(await lk.toggleCamera())) {
      const track = publishableTrack(camera.stream.value)
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
/**
 * START를 보낸 뒤 GAME_START를 기다리는 시간. 넘기면 "전달되지 않았다"고 알린다.
 *
 * <p>시작 요청은 응답이 없는 STOMP publish다. 프레임이 서버에 닿지 않아도(끊긴 걸 아직 모르는
 * 반열림 소켓·재연결 대기 구간) 클라이언트는 성공과 구분할 수 없고, 화면은 아무 일도 없었던 것처럼
 * 남는다 — 실제로 "START를 눌렀는데 내 카메라만 보인다"로 나타났다. 서버가 거부한 경우는
 * /user/queue/errors로 사유가 오므로 그쪽이 더 정확하고, 여기서는 <b>아무 응답도 없는</b>
 * 경우만 맡는다.</p>
 *
 * <p>카운트다운(서버 game.countdownSec)보다 짧아야 의미가 있다 — 정상 흐름에서는 GAME_START가
 * 카운트다운 <i>이전에</i> 도착하므로 이 타이머는 왕복 지연만 넘기면 된다.</p>
 */
const START_ACK_TIMEOUT_MS = 3000
let startAckTimer: ReturnType<typeof setTimeout> | undefined
function armStartAck() {
  clearStartAck()
  startAckTimer = setTimeout(() => {
    startAckTimer = undefined
    flash('시작 신호가 전달되지 않았어요 · 새로고침해 주세요')
  }, START_ACK_TIMEOUT_MS)
}
function clearStartAck() {
  clearTimeout(startAckTimer)
  startAckTimer = undefined
}
const gameResults = ref<GameResultEntry[] | null>(null)
/** 게임④(-86): POSE_SET으로 도착한 출제 포즈(랜드마크 JSON) — 벽 생성 입력 */
const poseChallenge = ref<string | null>(null)
/** 그림으로 말해요(게임 10) — DRAW/DRAW_RESULT 릴레이를 게임 컴포넌트로 전달하는 피드 */
const drawFeed = ref<GameEvent[]>([])

// ── 게임 시작 준비 게이트 (-161) ─────────────
// GAME_START가 와도 모션 모델이 아직 없으면(새로고침으로 힙 싱글턴이 비었을 때) 게임을
// 바로 마운트하지 않는다 — 그대로 마운트하면 화면은 도는데 손·자세만 안 잡히는, 사용자
// 눈에는 "게임 실행 실패"인 상태가 된다(8인 테스트에서 3명 재현). 준비 오버레이를 띄우고
// 모델이 채워진 뒤 마운트한다. Cache Storage 히트(modelCache)면 이 구간은 1초 미만이다.
const gamePrep = ref<{
  entry: GameEntry
  key: string
  progress: number
  failed: boolean
  /** 시작 준비 확인(-162) — 서버가 전원 ready를 기다리는 동안의 n/m. 게이트 단독 사용이면 null */
  waiting: { ready: number; total: number } | null
} | null>(null)

/** 모델이 준비됐으면 즉시, 아니면 오버레이를 걸고 받아진 뒤 게임을 마운트한다. */
function mountWhenReady(entry: GameEntry, key: string) {
  sessionEntry.value = entry // 비방장 중간 이탈 후 "게임 복귀"의 재마운트 대상(-164)
  if (motionModelsReady()) {
    gamePrep.value = null
    activeGame.value = entry
    return
  }
  gamePrep.value = { entry, key, progress: 0, failed: false, waiting: null }
  void warmUpMotionModels((f) => {
    if (gamePrep.value?.key === key) gamePrep.value.progress = f
  }).then((ok) => {
    // 그 사이 다른 세션의 GAME_START가 덮었거나 방을 정리했으면 여기서 끝낸다
    if (gamePrep.value?.key !== key) return
    if (!ok) {
      gamePrep.value.failed = true
      return
    }
    gamePrep.value = null
    activeGame.value = entry
  })
}
function retryGamePrep() {
  const prep = gamePrep.value
  if (prep) mountWhenReady(prep.entry, prep.key)
}
function cancelGamePrep() {
  gamePrep.value = null
}

/**
 * 방장 입장 대기 오버레이(-164 개정).
 *
 * 원래는 "LiveKit 참가자 중 방장 부재"를 즉시 전면 오버레이로 띄웠다 — 방장이 기기 점검
 * 중인 최초 입장 시나리오에는 맞지만, 방장이 <b>새로고침하는 몇 초</b>에도 참가자 전원의
 * 화면이 잠겨 버렸다(게임 중 포함). 부재가 유예 이상 지속될 때만 띄우고, 게임·준비 중에는
 * 띄우지 않는다 — 방장이 잠깐 빠져도 게임은 서버 시계로 계속 돈다.
 *
 * connected 조건 — 접속 중에는 참가자 목록이 비어 방장이 있는 방에서도 잠깐 부재로 보인다.
 */
const hostAway = computed(
  () => detailLoaded.value && connected.value && !amRoomHost.value && !hostInRoom.value
    && !activeGame.value && !gamePrep.value,
)
const showHostWaiting = ref(false)
/** 방장 부재가 이 시간 이상 지속될 때만 오버레이 — 새로고침 왕복(보통 3~6초)은 조용히 넘어간다. */
const HOST_WAIT_GRACE_MS = 10_000
let hostWaitTimer = 0
watch(hostAway, (away) => {
  clearTimeout(hostWaitTimer)
  if (!away) {
    showHostWaiting.value = false
    return
  }
  hostWaitTimer = window.setTimeout(() => {
    showHostWaiting.value = hostAway.value
  }, HOST_WAIT_GRACE_MS)
}, { immediate: true })

/**
 * 자체 사운드를 가진 게임은 로비 BGM을 내린다 — 안 내리면 테마와 게임 음악이 겹쳐 들린다.
 * 게임④(shape, -138)로 시작했고, 핑거 스타(finger)·그림 릴레이(draw)가 인게임 루프를 받으면서
 * 함께 들어왔다. 캐치캐치리듬(rhythm)도 인게임 곡을 갖게 되어 합류 — 판정음까지 내는 게임이라
 * 테마가 남아 있으면 셋이 겹친다. 낚시(fish)도 인게임 루프를 받아 합류했다.
 *
 * 반드시 activeGame 선언 아래에 둔다 — watch는 초기값을 잡으려고 getter를 setup 중 즉시
 * 실행하므로, 위에 두면 const TDZ에 걸려 setup 전체가 죽는다(빌드는 통과한다: TS는 화살표
 * 함수 안의 선언 전 참조를 잡지 않는다).
 */
const AUDIO_OWNING_GAMES = ['shape', 'finger', 'draw', 'rhythm', 'fish']
watch(
  // 설정 창(-9)도 인게임 베드를 직접 깔기 때문에 같이 내린다 — 소유 판정을 여기 한 곳에 모아두면
  // 창을 닫고 게임으로 넘어가는 사이에 테마가 잠깐 살아나는 일이 없다.
  () =>
    AUDIO_OWNING_GAMES.includes(activeGame.value?.id ?? '') ||
    AUDIO_OWNING_GAMES.includes(setupGame.value?.id ?? ''),
  (ownsAudio) => (ownsAudio ? bgm.suspendForGame() : bgm.resumeAfterGame()),
)

// ── 게임 화면 송출 — 게임 중에는 카메라와 함께 게임 캔버스를 화면공유 트랙으로 발행한다.
// 다른 참가자는 타일마다 게임 화면 ↔ 카메라를 토글로 골라 본다(ParticipantTile).
// 표시되지 않는 쪽은 adaptiveStream·dynacast가 자동으로 쉬게 하므로 부하는 보는 만큼만 든다.
const gameComp = ref<{ canvas?: HTMLCanvasElement } | null>(null)

/** 게임④(-9): 이번 라운드 출제자가 나인가 — 출제자 화면은 빈 무대라 송출하지 않는다 */
const iAmSetter = computed(
  () =>
    !!activeSession.value?.setterUserId &&
    activeSession.value.setterUserId === myParticipantId.value,
)
/** 게임④(-9): 이번 라운드 출제자 표시명 — 이름 조회는 participantNames 하나로 통일한다 */
const setterName = computed(() => {
  const id = activeSession.value?.setterUserId
  return id ? (participantNames.value[id] ?? '출제자') : null
})
/**
 * 게임④(-9): 출제 중인 출제자의 카메라를 다른 참가자 타일에서 가린다 — 캠으로 포즈가
 * 미리 보이면 문제가 성립하지 않는다(실기 피드백). 출제자는 게임 화면을 송출하지 않으므로
 * 타일에 보이는 건 카메라 원본이다.
 * 창은 타이머 없이 판별한다: GAME_START(poseChallenge=null) ~ POSE_SET 도착까지가 곧 출제 구간.
 */
const coveredSetterId = computed(() =>
  activeGame.value?.id === 'shape' &&
  activeSession.value?.setterUserId &&
  !poseChallenge.value &&
  !gameResults.value
    ? activeSession.value.setterUserId
    : null,
)
/**
 * 타일에 씌울 가림막 문구. 참가자 타일은 레이아웃(정원 5~8인 side-tray / 그 외 others-tray)에
 * 따라 세 군데에서 렌더되므로, 조건을 여기 한 곳에 두고 전부 이걸 쓴다 —
 * 한 곳만 빠져도 그 레이아웃에서 출제 포즈가 새어나간다.
 */
function coverFor(slot: Slot): string | null {
  return slot.view && slot.view.identity === coveredSetterId.value ? '🤫 출제 중 — 비밀!' : null
}

// ── 참가자별 개인 볼륨 ───────────────────────
// 상대의 마이크 설정과 무관하게 "내 귀에 들리는 크기"만 바꾼다(디스코드식). 타일은 세 군데
// 레이아웃에서 렌더되므로 조회·변경을 여기 두고 전부 이걸 쓴다.
function volumeFor(slot: Slot): number {
  return slot.view ? (lk.participantVolumes.value[slot.view.identity] ?? 1) : 1
}
function changeVolume(slot: Slot, value: number) {
  if (slot.view) lk.setParticipantVolume(slot.view.identity, value)
}

// 캔버스가 준비되면 송출 시작. 게임 캔버스에는 카메라 원본이 그려지지 않으므로(밤하늘+손 포인트)
// 카메라를 숨긴 상태여도 계속 송출하고, 캡처가 끊겨 새 프레임이 없을 때만 가린다(정지 화면 방지).
// 라운드가 끝나면(GAME_END 수신) 결과 화면을 닫지 않아도 송출을 내린다 — gameTrack이 사라지면서
// 모든 참가자 타일이 카메라로 복귀하고 게임/카메라 토글도 함께 사라진다. 다음 GAME_START에서
// gameResults가 초기화되면 같은 watch가 재발행한다.
// 게임④(-9) 출제자는 제외한다 — 관전 화면이라 남에게 보내봐야 빈 무대다. 로테이션으로
// 라운드마다 바뀌므로 iAmSetter를 의존성에 넣어 출제 차례가 끝나면 다시 발행된다.
// 캐치캐치리듬은 전용 채널이라 gameResults를 안 쓴다 — 컴포넌트가 RHYTHM_END 정산을
// started/ended 이벤트로 알려주면 rhythmEnded가 같은 역할(정산 즉시 송출 내림)을 한다.
const rhythmEnded = ref(false)
watch(
  [() => gameComp.value?.canvas ?? null, captureOn, gameResults, iAmSetter, rhythmEnded],
  async ([canvas, capOn, results, setter, rhythmDone]) => {
    if (!activeGame.value || !canvas) return
    // 그림으로 말해요 — 전원이 획 릴레이로 같은 도화지를 로컬 렌더링하므로 캔버스 송출이
    // 무의미하다. 송출하지 않으면 다른 참가자 타일은 게임 중에도 카메라 화면 그대로다.
    if (activeGame.value.id === 'draw') return
    if (results || setter || rhythmDone) {
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
  /** 게임①: 60초 매치 완성 개수(1순위 정렬 기준) / 게임⑤: 낚은 마리 수(표시 전용). 그 외 0 */
  completedCount: number
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
/**
 * 게임④ 연속 서바이벌(-9) — 등급 역산이 성립하지 않는 모드.
 * 위 배지는 "점수가 곧 등급"이라는 전제(100/85/70)로 만들어졌는데, 연속 모드의 점수는 벽 N장
 * 누적 총점이라 780점 같은 값이 와서 전부 FAIL로 보인다. 진행률도 일치율이 아니라 점수 비율이다.
 */
const bodyFitChain = computed(() => activeSession.value?.mode === 'chain')
/** 연속 서바이벌 만점 — 벽 수 × PERFECT(100). 중계된 진행률을 점수로 되돌리는 기준 */
const bodyFitChainMax = computed(() => (activeSession.value?.wallCount ?? 10) * 100)
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
  // ── 시작 준비 확인(-162) — 세션이 만들어지기 전 단계라 sessionId 필터보다 앞에서 처리 ──
  if (e.type === 'GAME_PREPARE') {
    const entry = GAME_CATALOG.find((g) => g.gameId === e.gameId)
    if (!entry) return
    picker.value = false
    // 설명은 시작과 함께 사라진다. 방장은 이미 닫고 왔지만, 그 프레임이 유실됐거나
    // 리듬처럼 다른 경로로 시작된 경우에도 참가자 화면에 설명이 남지 않게 여기서도 접는다.
    guideState.value = null
    // 모델을 먼저 채우고 ready를 회신한다 — 서버는 전원 완료(또는 15초) 후 GAME_START를 쏜다.
    // 모델 로드에 실패해도 ready는 보낸다: 나 하나 때문에 방 전체를 타임아웃까지 붙잡는 것보다,
    // 시작 후 내 화면의 게이트(mountWhenReady)가 실패·재시도를 처리하는 쪽이 낫다.
    gamePrep.value = {
      entry, key: e.prepareId, progress: 0, failed: false,
      waiting: { ready: e.readyCount, total: e.totalCount },
    }
    void warmUpMotionModels((f) => {
      if (gamePrep.value?.key === e.prepareId) gamePrep.value.progress = f
    }).then(() => {
      if (gamePrep.value?.key === e.prepareId) roomChat.sendGameReady(e.prepareId)
    })
    // 서버 타임아웃(15초)이 지나도 GAME_START가 안 오면(서버 장애 등) 오버레이에 갇히지 않게 자체 해제
    window.setTimeout(() => {
      if (gamePrep.value?.key === e.prepareId) {
        gamePrep.value = null
        flash('게임 시작이 취소됐어요')
      }
    }, 25_000)
    return
  }
  if (e.type === 'GAME_READY_PROGRESS') {
    if (gamePrep.value?.key === e.prepareId && gamePrep.value.waiting) {
      gamePrep.value.waiting = { ready: e.readyCount, total: e.totalCount }
    }
    return
  }
  if (e.type === 'GAME_ABORTED') {
    const wasOpen = !!activeGame.value || !!gamePrep.value
    // closeGame이 방장 abort를 재발신하지 않도록 세션부터 비운다(에코 루프 방지)
    activeSession.value = null
    closeGame()
    if (wasOpen) flash('방장이 게임을 종료했어요')
    return
  }
  if (e.type === 'GAME_START') {
    clearStartAck()
    const entry = GAME_CATALOG.find((g) => g.gameId === e.gameId)
    if (!entry) return
    gameResults.value = null
    liveScores.value = {}
    poseChallenge.value = null
    drawFeed.value = []
    activeSession.value = {
      sessionId: e.sessionId,
      constellationKey: e.constellationKey ?? '',
      startAt: e.startAt,
      endAt: e.endAt,
      clockOffset: e.serverNow - Date.now(),
      setterUserId: e.setterUserId ?? null,
      difficulty: e.difficulty ?? null,
      roundNo: e.roundNo ?? null,
      totalRounds: e.totalRounds ?? null,
      mode: e.mode ?? null,
      wallCount: e.wallCount ?? null,
      // 연속 서바이벌은 사람이 출제하지 않으므로 GAME_START의 challenge가 포즈 시드다
      // (출제 대결에서는 여기가 null이고 나중에 POSE_SET으로 랜드마크가 온다)
      chainSeed: e.mode === 'chain' ? (e.challenge ?? null) : null,
      topicWord: e.topicWord ?? null,
      turnOrder: e.turnOrder ?? null,
      turnDurationSec: e.turnDurationSec ?? null,
      handoverSec: e.handoverSec ?? null,
    }
    mountWhenReady(entry, e.sessionId)
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
  // 그리기 릴레이 — 게임 컴포넌트가 피드를 watch로 소비한다(자기 에코 무시 포함)
  if (e.type === 'DRAW' || e.type === 'DRAW_RESULT' || e.type === 'TURN_SKIPPED') {
    drawFeed.value = [...drawFeed.value, e]
    return
  }
  if (e.type === 'PROGRESS') {
    const row = liveScores.value[e.userId]
    if (row?.finished) return // 완주 확정 후의 늦은 진행 프레임은 무시
    liveScores.value[e.userId] = {
      nickname: e.nickname,
      starsLit: e.starsLit,
      holdProgress: e.holdProgress,
      completedCount: e.completedCount ?? 0,
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
      completedCount: e.completedCount ?? 0,
      finished: true,
      score: e.score,
    }
    return
  }
  if (e.type === 'GAME_END') {
    gameResults.value = e.results
    applyEarnedPoints(e.results)
    // 라운드가 끝났으니 게임 화면 송출을 즉시 내린다(-164) — 결과 화면까지 송출하면 각자
    // 결과를 닫을 때까지 다른 참가자 타일이 멈춘 게임 화면(검은 화면)으로 남는다.
    void lk.unpublishGameScreen()
    // 중간에 나가서(비방장 ✕) 게임이 안 떠 있는 사람은 결과 화면을 볼 곳이 없다 — 세션만 정리
    if (!activeGame.value) closeGame()
  }
}

// 방장이 리듬 라운드를 시작하면 방 전원이 자동 입장한다.
// (비방장은 게임 화면을 열 이유가 없어 스스로 구독하지 못한다 — 그래서 여기서 듣는다)
useRhythmAutoJoin(roomChat, roomCode, () => {
  const entry = GAME_CATALOG.find((g) => g.id === 'rhythm')
  // 리듬은 공용 세션이 없어 sessionId 대신 고정 키 — 준비 게이트(-161)는 동일하게 거친다
  if (entry) mountWhenReady(entry, 'rhythm-auto-join')
  picker.value = false
  if (!captureOn.value) flash('카메라를 켜면 게임에 참여할 수 있어요')
})

function openPicker() {
  picker.value = true
}

// ── 게임 설명 함께 보기 ─────────────────────────────────────────
/**
 * 지금 떠 있어야 할 설명. 원본은 서버 스냅샷(roomChat.gameGuide)이고, 방장이 넘길 때만
 * 여기를 먼저 고친다 — 왕복을 기다리면 자기가 누른 화살표가 한 박자 늦게 듣는다.
 * 서버 에코가 곧 같은 값으로 덮으므로 둘이 어긋난 채로 남지 않는다.
 */
const guideState = ref<{ gameId: number; page: number } | null>(null)
/** 참가자가 자기 화면에서만 닫았는지 — 방장이 게임을 바꾸거나 다시 열면 풀린다. */
const guideDismissed = ref(false)

watch(
  () => roomChat.gameGuide.value,
  (g) => {
    if (!g?.open || g.gameId == null) {
      guideState.value = null
      guideDismissed.value = false
      return
    }
    // 다른 게임의 설명이면 앞서 닫아 둔 것과 무관하다 — 새 설명은 다시 보여야 한다.
    if (guideState.value?.gameId !== g.gameId) guideDismissed.value = false
    guideState.value = { gameId: g.gameId, page: g.page }
  },
)

/**
 * 설명이 떠 있는 중에 들어오거나 재연결한 사람을 맞춘다 — 토픽은 재생되지 않아서
 * 이걸 묻지 않으면 방장이 다음 장을 넘길 때까지 혼자 아무것도 못 본다.
 * joined만으로는 이르다(소켓이 아직 안 붙었으면 발신이 버려진다).
 */
watch(
  () => [roomChat.joined.value, roomChat.connected.value] as const,
  ([isJoined, isConnected]) => {
    if (isJoined && isConnected) roomChat.requestGameGuideSync()
  },
  { immediate: true },
)

const guideGame = computed(() => {
  const id = guideState.value?.gameId
  return id == null ? null : (GAME_CATALOG.find((g) => g.gameId === id) ?? null)
})
const guidePages = computed(() => {
  const g = guideGame.value
  return g ? guidePagesOrFallback(g.gameId, g.emoji, [g.description, ...g.howToPlay]) : []
})
/** 방장에게는 닫기가 없다(다른 게임·바로 시작으로 빠져나간다) — dismiss는 참가자 얘기다. */
const guideOpen = computed(() => !!guideGame.value && (selfIsHost.value || !guideDismissed.value))

/** 방장: 설명을 방 전원에게 띄운다. 게임은 아직 시작하지 않는다. */
function openGuide(g: GameEntry) {
  picker.value = false
  guideState.value = { gameId: g.gameId, page: 0 }
  roomChat.sendGameGuide(true, g.gameId, 0)
}
/** 방장: 넘긴 장을 방 전원에게 맞춘다. */
function setGuidePage(page: number) {
  const state = guideState.value
  if (!state) return
  guideState.value = { gameId: state.gameId, page }
  roomChat.sendGameGuide(true, state.gameId, page)
}
/** 방장: 설명을 접는다 — 방 전원 화면에서 함께 사라진다. */
function closeGuide() {
  guideState.value = null
  guideDismissed.value = false
  roomChat.sendGameGuide(false, null, 0)
}
function startFromGuide() {
  const g = guideGame.value
  // 설명을 먼저 접는다 — 시작 경로(pick)가 설정 창을 띄우는 게임이면 그 창이 설명에 가린다.
  closeGuide()
  if (g) pick(g)
}
function guideBackToPicker() {
  closeGuide()
  picker.value = true
}

/**
 * 관리자가 닫은 게임(-106) — 서버 카탈로그의 `active=false`.
 *
 * <p>방 안 게임 목록(GAME_CATALOG)은 하드코딩이라 서버 상태를 모른다. 그대로 두면 관리자가
 * 게임을 닫아도 목록에 멀쩡히 보이고, 방장이 고른 뒤 시작 시점에야 서버 에러를 받는다.
 * 여기서 한 번 받아 두고 선택창·자동 시작 양쪽에 같은 집합을 쓴다.</p>
 *
 * <p>조회 실패는 <b>조용히 넘긴다</b> — 이 값은 안내용이고 강제는 서버가 한다(닫힌 게임을
 * 시작하면 GAME_CLOSED로 거부된다). 실패했다고 게임 선택 자체를 막으면 관리자가 아무것도
 * 닫지 않은 평시에 방이 못 놀게 된다.</p>
 */
const closedGameIds = ref<Set<number>>(new Set())
onMounted(async () => {
  try {
    const catalog = await gamesApi.list()
    closedGameIds.value = new Set(catalog.filter((g) => !g.active).map((g) => g.id))
  } catch {
    closedGameIds.value = new Set()
  }
})

/**
 * 게임 목록에서 고른 게임 자동 시작 — 헤더 ▸ 게임 ▸ 게임 선택 ▸ 대기실 ▸ 입장하면
 * 방 안에서 다시 고르지 않고 그 게임이 바로 열린다(쿼리 autostart = 서버 gameId).
 *
 * <p>다 기다린 뒤에 부르는 이유 —
 * <b>joined</b>(방 토픽 구독) 전이면 startGame이 발신 대상 없이 버려지고, 설령 나갔어도
 * GAME_START를 구독 전에 방송해 유실된다(토픽은 재생하지 않는다) — 서버에는 세션이 생기는데
 * 화면엔 아무것도 안 뜬다. detailLoaded 전에는 방장 여부를 몰라 launch()가 '게임 제안'으로 새고,
 * 전역 소켓 미연결이면 서버 세션 없이 로컬 폴백으로 열려 멈춘 것처럼 보이고
 * (핑거 스타는 session=null이면 'ready' 화면에서 대기한다), 캡처가 붙기 전이면
 * launch()가 '카메라를 켜고 시작해 주세요'로 되돌린다.</p>
 *
 * <p>joined는 입장 시퀀스의 <b>맨 마지막</b>에 참이 된다(onMounted의 roomChat.connect).
 * 그래서 감시자에만 맡기지 않고 그 직후에도 한 번 직접 부른다 — 순서 의도를 시퀀스에 남긴다.</p>
 *
 * <p>끝내 조건이 안 맞으면 <b>왜 못 켰는지 말해 준다</b> — 조용히 포기하면 사용자에겐
 * 그냥 "게임이 시작 안 되는" 화면이라, 무엇을 고쳐야 하는지 알 길이 없다.</p>
 */
const AUTOSTART_TIMEOUT_MS = 8000
const autostartGameId = computed(() => Number(route.query.autostart) || null)
let autostarted = false
let autostartTimer: number | undefined

/** 자동 시작을 막고 있는 게 무엇인지 — 안내 문구로 그대로 쓴다. 다 갖춰졌으면 null. */
function autostartBlocker(): string | null {
  if (!roomChat.connected.value) return '실시간 서버에 연결되지 않아'
  if (!roomChat.joined.value) return '방에 아직 입장하지 못해'
  if (!detailLoaded.value) return '방 정보를 불러오지 못해'
  if (!captureOn.value) return '카메라를 켤 수 없어'
  if (!GAME_CATALOG.some((g) => g.gameId === autostartGameId.value)) return '게임을 찾지 못해'
  // 관리자가 닫은 게임(-106)이면 서버가 시작을 거부한다. 먼저 걸러야 8초를 기다린 끝에
  // "응답을 받지 못해"라는 엉뚱한 이유가 뜨지 않는다.
  if (closedGameIds.value.has(autostartGameId.value!)) return '점검 중인 게임이라'
  return null
}

/**
 * 조건이 다 갖춰졌으면 한 번만 시작한다 — 감시자와 입장 시퀀스 양쪽에서 부르므로 멱등해야 한다.
 * 타이머를 여기서 끄지 않는 이유 — 발신에 성공해도 GAME_START가 안 돌아오면(유실) 다시
 * 조용해진다. 타이머는 게임이 <b>실제로 열렸는지</b>로 판정한다(아래 setTimeout).
 */
function tryAutostart() {
  if (autostarted || !autostartGameId.value || autostartBlocker()) return
  const entry = GAME_CATALOG.find((g) => g.gameId === autostartGameId.value)
  if (!entry) return
  autostarted = true
  void launch(entry)
}

// 마지막으로 갖춰지는 조건이 무엇이든(카메라 권한이 늦거나 재연결이 끼어도) 그때 시작되게 한다.
watch(
  () => [
    autostartGameId.value,
    detailLoaded.value,
    roomChat.connected.value,
    roomChat.joined.value,
    captureOn.value,
  ] as const,
  tryAutostart,
  { immediate: true },
)
// 자동 시작을 요청받았는데 제때 게임이 안 열렸으면 이유를 알리고 선택창을 열어 준다(막힌 채로 두지 않는다).
// 판정 기준은 "발신했는가"가 아니라 "게임이 열렸는가"다 — 그 둘이 갈리는 경우가 실제로 있었다.
if (autostartGameId.value) {
  autostartTimer = window.setTimeout(() => {
    if (activeGame.value) return
    // 발신까지는 갔는데 화면이 안 열렸다면 GAME_START를 못 받은 것이다(막고 있는 조건은 이미 없다).
    // 닫힌 게임을 먼저 보는 이유 — 카탈로그 조회가 시작 조건보다 늦게 도착하면 발신이 먼저
    // 나가고 서버가 거부한다. 그때 "응답을 받지 못해"라고 하면 원인을 반대로 알려 주게 된다.
    const reason = closedGameIds.value.has(autostartGameId.value!)
      ? '점검 중인 게임이라'
      : autostarted ? '게임 시작 응답을 받지 못해' : autostartBlocker() ?? '알 수 없는 이유로'
    flash(`${reason} 자동 시작하지 못했어요 — 직접 골라 주세요`)
    picker.value = true
  }, AUTOSTART_TIMEOUT_MS)
}
/** 지금 방에 있는 인원 — LiveKit 참가자(본인 포함)가 실시간, 상세 조회 값은 폴백 */
function roomPlayerCount(): number {
  return lk.participants.value.length || participantCount.value
}
/**
 * 게임 선택 → (옵션이 있으면) 설정 창 → 시작.
 *
 * <p>게임④만 모드·난이도·벽 수가 있어서 설정 창을 한 번 더 띄운다. 옵션이 없는 게임까지
 * 거치게 하면 "시작 버튼만 있는 빈 창"이 생긴다. 방장이 아니거나 서버에 연결되지 않았으면
 * 설정할 게 없으므로(게임 제안·로컬 폴백 경로) 지금처럼 곧바로 launch로 보낸다.</p>
 */
function pick(g: GameEntry) {
  // 선택창이 이미 잠긴 게임의 시작 버튼을 감추지만, 여기서도 막는다 — 게임 제안(비방장) 경로도
  // 이 함수를 지나가고, 카탈로그 조회가 늦게 도착했으면 선택창은 잠기지 않은 상태로 열려 있다.
  if (closedGameIds.value.has(g.gameId)) {
    flash(`${g.name}은(는) 점검 중이라 지금은 시작할 수 없어요`)
    return
  }
  if (g.id === 'shape' && g.playable && roomChat.connected.value && selfIsHost.value) {
    picker.value = false
    setupGame.value = g
    return
  }
  void launch(g)
}
function startWithSetup(difficulty: string, mode: string, wallCount?: number) {
  const g = setupGame.value
  setupGame.value = null
  if (g) void launch(g, difficulty, mode, wallCount)
}
function backToPicker() {
  setupGame.value = null
  picker.value = true
}

async function launch(g: GameEntry, difficulty?: string, mode?: string, wallCount?: number) {
  picker.value = false
  // 캐치캐치리듬은 전용 STOMP 채널을 쓴다 — 공용 게임 세션(GAME_START) 경로를 타지 않고
  // 컴포넌트가 자기 생명주기를 소유한다. 난이도 선택·시작은 컴포넌트 안에서.
  // 비방장은 여기로 새면 안 된다 — 아래 게임 제안 경로를 그대로 타야 한다.
  if (g.id === 'rhythm' && (selfIsHost.value || !roomChat.connected.value)) {
    if (!captureOn.value) {
      flash('카메라를 켜고 시작해 주세요')
      return
    }
    activeGame.value = g
    return
  }
  // 방장 + 서버 연결 + 플레이 가능 → 서버에 시작 요청. GAME_START가 방 전체에 돌아와 마운트된다.
  if (g.playable && roomChat.connected.value && selfIsHost.value) {
    if (!captureOn.value) {
      flash('카메라를 켜고 시작해 주세요')
      return
    }
    // 최소 인원은 서버도 거부하지만, 먼저 알려주는 편이 친절하다(이어그리기는 3인부터)
    if (g.minPlayers && roomPlayerCount() < g.minPlayers) {
      flash(`${g.name} 는 ${g.minPlayers}명부터 시작할 수 있어요`)
      return
    }
    // 게임④(-9): 혼자면 서버 세션을 만들지 않고 로컬 연습 모드로 돌린다.
    // 출제 대결은 출제자가 관전하는 룰이라 라운드 자체가 성립하지 않고, 연속 서바이벌은
    // 혼자서도 성립하지만 1인 세션을 허용하면 순위가 항상 1등이라 랭킹을 혼자 쌓을 수 있다
    // (서버도 같은 이유로 2인 미만을 거부한다 — 여기 검사는 그 거부를 먼저 안내하는 것).
    if (g.id === 'shape' && (await memberCountNow()) < 2) {
      flash('혼자 있어서 연습 모드로 시작해요 — 랜덤 벽이 계속 날아와요')
      activeSession.value = null
      activeGame.value = g
      return
    }
    if (!roomChat.startGame(g.gameId, undefined, difficulty, mode, wallCount)) {
      flash('실시간 연결이 끊겼어요 · 새로고침해 주세요')
      return
    }
    armStartAck()
    return
  }
  // 서버 미연동 데모 — 로컬 솔로 플레이 폴백. 멀티 전용 게임(minPlayers>1)은 혼자
  // 진행할 수 없으므로 폴백에서 제외한다(그림으로 말해요는 이어그리기라 3인부터).
  if (g.playable && !roomChat.connected.value && (g.minPlayers ?? 1) > 1) {
    flash(`${g.name} 는 실시간 서버에 연결된 뒤 ${g.minPlayers}명부터 시작할 수 있어요`)
    return
  }
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

/** 게임 컴포넌트의 진행 상황(컴포넌트에서 300ms 스로틀) → 서버 중계. completedCount는 게임① 전용 */
function onGameProgress(starsLit: number, holdProgress: number, completedCount = 0) {
  if (activeSession.value && !gameResults.value) {
    roomChat.sendGameProgress(starsLit, holdProgress, completedCount)
  }
}

/** 핑거 스타 60초 매치 집계 — score 자리에 총점, completedCount가 1순위 승부 기준 */
function onGameFinished(r: { completedCount: number; totalScore: number; avgScore: number }) {
  if (activeSession.value) {
    // 서버가 최초 1회만 수리하고 PLAYER_FINISHED → (전원 완주 시) GAME_END를 배포한다.
    roomChat.sendGameFinish(r.totalScore, 0, r.completedCount)
    return
  }
  // 솔로 폴백 — 결과를 토스트로만 알린다.
  flash(`✨ ${r.completedCount}개 완성 · 평균 ${r.avgScore}점`)
}

/**
 * 게임⑤ 낚시(-49) 진행 중계 — 물고기를 낚을 때마다.
 *
 * 낚시 총점은 누적이라 서버 progress의 starsLit(0~10 클램프)에 실을 수 없다. 마리 수만
 * completedCount 자리로 보내고 스코어보드는 "N마리"로 그린다. 총점은 아래 finished에서 한 번.
 */
function onFishingProgress(_score: number, caught: number) {
  if (activeSession.value && !gameResults.value) {
    roomChat.sendGameProgress(0, 0, caught)
  }
}

/** 게임⑤ 낚시 종료 집계 — 서버는 총점을 마리 수 × 어종 최고 점수로 상한 검사한다 */
function onFishingFinished(r: { totalScore: number; caught: number }) {
  if (activeSession.value) {
    roomChat.sendGameFinish(r.totalScore, 0, r.caught)
    return
  }
  // 솔로 폴백(서버 미연동) — 결과를 토스트로만 알린다
  flash(`🎣 ${r.caught}마리 · ${r.totalScore}점`)
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

/**
 * 게임 ✕(닫기) 요청(-164 개정) — 판이 살아 있으면 바로 닫지 않고 확인 모달을 거친다.
 * 방장의 닫기는 전체 세션 종료(abort)라 실수로 누르면 방 전체가 날아가고,
 * 비방장의 닫기는 이번 판 이탈이라 의사를 한 번 확인한다.
 *
 * activeSession 유무로 가르지 않는다 — 그건 "공용 세션이 있나"지 "판이 도는 중인가"가
 * 아니다. 리듬(전용 채널)과 게임④ 솔로 연습은 그 값이 늘 비어 있어 확인 없이 닫혔다.
 * 정산이 끝난 결과 화면에서만 그냥 닫는다.
 */
function requestCloseGame() {
  if (gameResults.value) {
    closeGame()
    return
  }
  closeGameConfirm.value = true
}
const closeGameConfirm = ref(false)
/**
 * 방장의 종료가 방 전체 판을 끝내는가 — 확인 모달 문구를 가른다.
 * 리듬은 전용 채널이라 서버 세션이 돌아도 activeSession이 비어 있어 따로 본다.
 * 둘 다 아니면 게임④ 솔로 연습이라 같이 끝날 사람이 없다.
 */
const hostCloseEndsAll = computed(
  () => !!activeSession.value || activeGame.value?.id === 'rhythm',
)
function confirmCloseGame() {
  closeGameConfirm.value = false
  if (amRoomHost.value) {
    closeGame() // 방장 — 전체 세션 종료(abort 발신 포함)
    return
  }
  // 비방장 — 서버 세션은 그대로 두고 내 화면만 나간다. 라운드가 살아 있는 동안
  // "게임 복귀"로 되돌아올 수 있다(게임은 서버 시계 기준이라 재마운트로 동기화된다).
  void lk.unpublishGameScreen()
  activeGame.value = null
}
/** 비방장 중간 이탈 후 복귀 — 같은 세션으로 재마운트(모델 게이트 재사용). */
function rejoinGame() {
  const entry = sessionEntry.value
  if (entry && activeSession.value && !gameResults.value) {
    mountWhenReady(entry, activeSession.value.sessionId)
  }
}
/** 진행 중 세션의 게임 항목 — 비방장 중간 이탈 후 복귀 버튼이 쓴다(-164). */
const sessionEntry = ref<GameEntry | null>(null)

/**
 * 방송받은 내 획득 포인트를 헤더 잔액에 즉시 얹는다.
 *
 * <p>지갑 반영은 서버가 비동기로 한다(GameRewardListener) — 기다리면 게임이 끝나도 잔액이
 * 그대로여서 "보상을 못 받았다"로 보인다. 그래서 낙관적으로 올려 두고, 결과 화면을 닫을 때
 * {@code refreshProfile}이 서버 값으로 정정한다.</p>
 *
 * <p>results의 userId는 문자열(LiveKit identity와 같은 값)이고 프로필 id는 숫자라 변환해 맞춘다.
 * 게스트는 프로필이 없어 아무 일도 하지 않는다.</p>
 */
function applyEarnedPoints(results: GameResultEntry[]) {
  const myId = session.profile?.id
  if (myId === undefined) return
  const mine = results.find((r) => r.userId === String(myId))
  if (mine?.pointsEarned) session.addPoints(mine.pointsEarned)
}

/**
 * 캐치캐치리듬 정산 — 전용 채널(RHYTHM_END)이라 위 GAME_END 경로를 타지 않는다.
 * 컴포넌트가 내 획득분을 계산해 넘겨 주므로 여기서는 잔액에만 얹는다.
 * 서버는 같은 GameSettledEvent 경로로 지급하므로 정정은 closeGame의 refreshProfile이 맡는다.
 */
function onRhythmEnded(pointsEarned: number) {
  rhythmEnded.value = true
  if (pointsEarned > 0) session.addPoints(pointsEarned)
}

function closeGame() {
  // 방장이 게임 도중 닫으면 방 전체 세션을 종료한다(-164) — 예전에는 본인 화면만 닫혀
  // 남은 사람끼리 라운드가 돌고 방은 endAt까지 잠겨 있었다. 정산 후(gameResults 존재)는
  // 해당 없음. GAME_ABORTED 에코는 세션을 먼저 비우고 이 함수를 부르므로 재발신되지 않는다.
  if (amRoomHost.value && !gameResults.value) {
    if (activeSession.value) roomChat.sendGameAbort()
    // 리듬은 전용 채널이라 game/abort가 닿지 않는다 — 안 보내면 서버 세션이 endAt까지
    // 남아 방이 PLAYING에 묶이고 다음 게임이 "이미 진행 중"으로 거절된다.
    // 서버가 멱등이라 라운드가 없을 때(시작 화면) 보내도 무해하다.
    else if (activeGame.value?.id === 'rhythm' && !rhythmEnded.value) roomChat.sendRhythmAbort()
  }
  void lk.unpublishGameScreen()
  gamePrep.value = null
  sessionEntry.value = null
  activeGame.value = null
  activeSession.value = null
  gameResults.value = null
  liveScores.value = {}
  poseChallenge.value = null
  rhythmEnded.value = false
  drawFeed.value = []
  // 낙관적으로 얹은 획득 포인트를 서버 값으로 정정한다(비동기 지급이 끝났을 시점).
  void session.refreshProfile()
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
  // 방 생성(로비)과 동일한 선검사 — 서버(@NoProfanity)가 최종 거절한다
  if (containsProfanity(payload.title)) {
    flash('방 제목에 사용할 수 없는 단어가 있어요')
    return
  }
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
    // 아직 공개되지 않은 방(방장이 기기 점검 중에 나가 버린 경우)이라면 여기서 목록에 올린다 —
    // 내가 방장이 됐고 나는 이 화면에 있으니 공개 조건을 그대로 만족한다. 이미 공개된 방이면 서버가 무시한다.
    if (e.hostUserId === myParticipantId.value) void publishRoom()
    // 결과만 알리면 "왜 갑자기?"가 되므로 원인(방장 퇴장)을 함께 붙인다.
    flash(
      e.hostUserId === myParticipantId.value
        ? '방장이 나가서 내가 새 방장이 되었어요'
        : `방장이 나가서 ${e.hostDisplayName}님이 새 방장이 되었어요`,
    )
  },
)

// 강퇴·퇴장 멤버 이벤트(-71, -73)를 즉시 반영한다. 특히 내 ID가 대상이면 REST 요청 성공만으로
// 화면이 남아 있지 않도록 LiveKit/카메라 연결을 끊고 확인 모달 없이 로비로 이동한다.
watch(
  () => roomChat.memberRemoved.value,
  async (e) => {
    if (!e) return
    participantCount.value = e.participantCount
    memberIds.value = memberIds.value.filter((id) => id !== e.userId)
    // 내 퇴장 이벤트인데 나는 나간 적이 없다(-164) — 언로드 유예가 끝나 버렸거나 레이스로
    // 서버에서만 빠진 상태다. 그대로 두면 STOMP만 살아 있는 유령 멤버(게임 시작은 전파되는데
    // 방 명단엔 없음)가 되므로 즉시 재입장해 명단과 화면을 다시 맞춘다.
    if (e.userId === myParticipantId.value && !leavingIntentionally) {
      // 세션이 끝나서 서버가 나를 뺀 경우(다른 곳에서 로그인)는 예외다 — 토큰이 없어 재입장은
      // 401이고, 그 실패로 로비로 보내면 회원 가드가 "로그인이 필요해요"를 안내 위에 겹쳐 띄운다.
      // 어디로 갈지는 세션 종료 안내(App.vue)가 정한다.
      if (!session.isAuthenticated) return
      try {
        applyDetail(await roomsApi.join(roomCode.value))
      } catch {
        leavingIntentionally = true
        void router.replace(exitRoute())
      }
    }
  },
)
watch(
  () => roomChat.memberKicked.value,
  async (e) => {
    if (!e) return
    participantCount.value = e.participantCount
    memberIds.value = memberIds.value.filter((id) => id !== e.userId)
    if (e.userId !== myParticipantId.value) return

    await lk.disconnect()
    camera.stop()
    leavingIntentionally = true
    await router.replace({ name: RouteName.Lobby, query: { kickedReason: e.reason } })
  },
)
// 헤더 링크·뒤로가기 등으로 방을 벗어나려 하면 확인 모달. "나가기" 같은 의도된 이동은 통과.
let leavingIntentionally = false
const showLeaveConfirm = ref(false)
let resolveLeave: ((ok: boolean) => void) | null = null
let leaveToLobbyAfterConfirm = false
onBeforeRouteLeave(() => {
  if (leavingIntentionally) return true
  // 세션이 끝나서 밀려나는 이탈(다른 곳에서 로그인·만료)은 선택이 아니다 — 안내 모달의
  // "로그인하러 가기"를 눌렀는데 "계속 놀기"를 다시 묻는 꼴이 된다. 이미 App.vue가 토큰을
  // 지웠으므로 방에 남아도 서버와 아무것도 할 수 없다: 확인 없이 통과시킨다.
  // (카메라·LiveKit 정리는 언마운트 시 각 컴포저블이 맡는다. 퇴장 통보는 토큰이 없어 불가능하다.)
  if (!session.isAuthenticated) return true
  showLeaveConfirm.value = true
  return new Promise<boolean>((resolve) => (resolveLeave = resolve))
})
async function answerLeave(ok: boolean) {
  showLeaveConfirm.value = false
  const routeLeaveResolver = resolveLeave
  resolveLeave = null
  if (ok) {
    await notifyLeave()
    if (leaveToLobbyAfterConfirm) {
      leavingIntentionally = true
      leaveToLobbyAfterConfirm = false
      await router.push(exitRoute())
    }
  }
  leaveToLobbyAfterConfirm = false
  routeLeaveResolver?.(ok)
}

// 백엔드 퇴장 통보 + LiveKit 연결 정리. "LEAVE" 버튼과 확인 모달("나가기") 양쪽 경로에서 공유.
async function notifyLeave() {
  // 의도된 퇴장 표시를 먼저 — 서버 MEMBER_LEFT 에코가 라우팅보다 빨리 오면
  // 자기치유 재입장(-164)이 방금 나간 방에 도로 들어가 버린다.
  leavingIntentionally = true
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
  leaveToLobbyAfterConfirm = true
  showLeaveConfirm.value = true
}

// ── 친구 초대 (-100, 대기실 전용) ─────────────
// 방 설정과 같은 이유로 열 때 상세를 다시 조회한다 — 그 사이 들어온 사람을 초대 목록에서 빼려면
// memberIds가 최신이어야 한다. 조회에 실패해도 화면에 들고 있던 값으로 연다(서버가 다시 검증한다).
const inviteOpen = ref(false)
async function openInvite() {
  try {
    applyDetail(await roomsApi.detail(roomCode.value))
  } catch {
    // 목록에 이미 방에 있는 친구가 잠깐 남을 뿐이다 — 눌러도 서버가 판정한다
  }
  inviteOpen.value = true
}

async function addFriend(target: ParticipantView | null) {
  if (!target?.name) return
  try {
    await friendsApi.sendRequest(target.name)
    flash(`${target.name}님에게 친구 요청을 보냈어요`)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '친구 요청을 보내지 못했어요')
  }
}

/**
 * 실시간 연결이 끊겼음을 방 안에서 드러낸다.
 *
 * <p>채팅·게임 시작·진행 중계가 전부 전역 소켓 하나(-142)를 쓴다. 끊긴 줄 모르면 "눌러도
 * 아무 일이 없는" 상태가 되고, 여러 명이 있는 방에서는 <b>일부만 게임이 시작되는데 아무도
 * 이유를 모르는</b> 상황이 된다 — 그래서 본인에게 먼저 알린다.</p>
 *
 * <p>복구는 새로고침이 확실하다: 새 문서는 클라이언트를 새로 만들어 재시도 백오프(최대 60초)를
 * 건너뛰고, 방 재실은 서버 유예(RoomPresenceTracker.GRACE_MS) 안에 다시 구독하면 유지된다.</p>
 */
const realtimeDown = computed(() => !roomChat.connected.value)
function reloadPage() {
  window.location.reload()
}

const startLabel = computed(() => 'GAME')
/**
 * 게임 선택 버튼 잠금 — 서버 연결 중에는 방장 여부를 알기 전까지 잠근다(제안 오발신 방지).
 * STOMP 미연결(백엔드 미연동 로컬 데모)에서는 상세 조회가 영영 안 끝나므로 잠그지 않는다 —
 * 이때 열리는 게임은 로컬 솔로 폴백뿐이고 제안 발신은 useRoomChat이 미연결 시 무시한다.
 */
/**
 * 스코어보드 위치 — 게임마다 화면이 달라 기본 자리가 무언가를 가린다(핑거 스타는 종료 ✕,
 * 바디핏·낚시는 각자의 HUD). 게임별로 자리를 잡아 주는 대신 직접 옮기게 하고 그 자리를 기억한다.
 */
const {
  el: scoreEl,
  style: scoreStyle,
  dragging: scoreDragging,
  onHandleDown: onScoreDown,
  onHandleMove: onScoreMove,
  onHandleUp: onScoreUp,
  reset: resetScorePos,
} = useDraggablePanel('motiontok:scoreboard-pos')

const pickerLocked = computed(() => roomChat.connected.value && !detailLoaded.value)
/**
 * 판이 도는 중인가 — 이 동안에는 GAME 버튼을 잠근다.
 *
 * <p>게임이 떠 있으면 푸터가 가려질 것 같지만 그렇지 않다. 게임은 셀프 타일 자리에 뜨고
 * 푸터는 그대로 남는다 — 게다가 비방장이 중간에 ✕로 나가면 화면은 없고 라운드만 도는
 * 상태가 된다(그때 "게임 복귀" 버튼이 뜬다). 그 상태에서 GAME을 누르면 방장은 서버가
 * GAME_SESSION_ALREADY_ACTIVE로 거절하고, 비방장은 아무 소용 없는 제안을 쏜다.</p>
 *
 * <p>세 값을 다 보는 이유 — activeSession은 공용 세션만 잡는다(리듬은 전용 채널이라 늘 비어
 * 있다), activeGame은 내 화면에 게임이 떠 있는지, gamePrep은 시작을 눌러 준비 확인 중인지다.
 * 하나라도 서 있으면 "종료하기 전"이다.</p>
 */
const gameInProgress = computed(
  () => !!activeSession.value || !!activeGame.value || !!gamePrep.value,
)
const startHint = computed(() =>
  gameInProgress.value
    ? '이미 게임이 진행 중입니다'
    : !roomChat.connected.value
      ? '오프라인 — 로컬 게임을 플레이할 수 있어요'
      : !detailLoaded.value
        ? '방 정보를 불러오는 중…'
        : amRoomHost.value
          ? '게임을 선택하고 시작!'
          : '하고 싶은 게임을 제안해보세요',
)
</script>

<template>
  <div class="room-shell">
    <!-- 상단 바 -->
    <div class="room-ribbon">
      <div class="px-kicker"><button type="button" class="room-logo-btn" title="방 나가기" @click="leave"><BrandLogo class="room-brand" title="" size="sm" /></button>{{ roomTitle ?? 'LIVE PARTY ROOM' }}</div>

      <div class="ribbon-sound">
        <button class="ribbon-sound-btn" :class="{ active: soundSettingsOpen }" @click="soundSettingsOpen = !soundSettingsOpen">소리 설정</button>
        <div v-if="soundSettingsOpen" class="sound-settings-pop">
          <label>
            <span>게임 음악</span>
            <input type="range" min="0" max="100" step="5" :value="gameMusicPercent" aria-label="게임 음악 볼륨" @input="setGameMusicVolume" />
          </label>
        </div>
      </div>
      <span class="ribbon-divider" aria-hidden="true">|</span>

      <!-- 유저 신고 (방 코드 왼쪽) -->
      <button class="ribbon-report" title="유저 신고" @click="openUserReport">
        신고
      </button>

      <!-- 친구 초대 (-100) — 참가자 누구나, 대기실에서만. 게임 중엔 서버도 409로 거부한다. -->
      <span v-if="!activeGame" class="ribbon-divider" aria-hidden="true">|</span>
      <button v-if="!activeGame" class="ribbon-invite" title="친구 초대" @click="openInvite">
        친구 초대
      </button>

      <!-- 방 설정 (-130) — 방장만, 대기실에서만. 게임 중엔 서버도 거부하므로 버튼을 숨긴다. -->
      <span v-if="selfIsHost && !activeGame" class="ribbon-divider" aria-hidden="true">|</span>
      <button
        v-if="selfIsHost && !activeGame"
        class="ribbon-settings"
        title="방 설정"
        @click="openSettings"
      >
        설정
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

    <!-- 실시간 끊김 안내 — 끊긴 본인만 본다. 채팅·게임 시작이 모두 이 소켓에 달려 있다. -->
    <div v-if="realtimeDown" class="offline-bar">
      <span class="px">실시간 연결이 끊겼어요 · 채팅과 게임 시작이 동작하지 않아요</span>
      <button class="px offline-reload" @click="reloadPage">새로고침</button>
    </div>

    <!-- 본문: 내 캠을 크게, 나머지는 인원수에 맞춰 그리드로 배치 -->
    <main class="room-main">
      <div
        class="cam-stage"
        :class="{
          crowded: otherSlots.length > 4,
          'side-layout': isSideBySideLayout,
          'five-player': capacity === 5,
          'four-player': capacity === 4,
          'three-player': capacity === 3,
          'two-player': capacity === 2,
          'solo-play': isSoloPlay,
          'game-active': !!activeGame,
          'fish-game': activeGame?.id === 'fish',
        }"
        :style="capacity === 2 ? { '--two-player-aspect': selfVideoAspect * 2 } : undefined"
      >
        <div
          v-if="!isSoloPlay && isSideBySideLayout"
          class="side-tray"
          :class="capacity <= 6 ? 'side-tray-left-two' : 'side-tray-left'"
        >
          <ParticipantTile
            v-for="(slot, i) in leftSideSlots"
            :key="`left-${i}`"
            :view="slot.view"
            :host="slot.host"
            :prefer-cam="!activeGame"
            :cover="coverFor(slot)"
            :volume="volumeFor(slot)"
            :sprites="spritesFor(slot)"
            :effect="effectFor(slot)"
            play-audio
            mirror
            compact
            :can-kick="amRoomHost && !!slot.view"
            :can-invite="!activeGame"
            @kick="openKick(slot.view)"
            @friend="addFriend(slot.view)"
            @volume="changeVolume(slot, $event)"
          />
        </div>
        <!-- 내 캠 — 항상 가장 크게 -->
        <div
          class="self-tile self-spot"
          :class="{ 'fish-game': activeGame?.id === 'fish' }"
          :style="{ '--camera-aspect': activeGame?.id === 'fish' ? 4 / 3 : selfVideoAspect }"
        >
          <video
            v-show="selfCamOn"
            ref="selfVideoEl"
            autoplay
            playsinline
            muted
            class="self-video"
            :style="selfCameraFilterStyle"
            @loadedmetadata="syncSelfVideoAspect"
          />
          <!-- 내 뽀샤시 — 편집 중에도 결과를 그대로 보여야 세기를 맞출 수 있다.
               이 타일은 언제나 내 카메라라 게임 화면 여부를 따지지 않는다. -->
          <CameraEffectLayer
            v-if="selfCamOn && decor.cameraEffect.value"
            class="self-fx-layer"
            :intensity="decor.cameraEffect.value.intensity"
          />
          <!-- 상대 타일(ParticipantTile)과 같은 오버레이 — self-video는 좌우 반전이라 mirrored,
               fit은 <video>의 object-fit과 같아야 영상 안 같은 자리에 얹힌다. -->
          <StickerOverlay
            v-if="selfCamOn"
            class="self-sticker-layer"
            :sprites="decor.sprites.value"
            mirrored
            :editable="showDecorInventory"
            fit="contain"
            :frame-aspect="selfVideoAspect"
            :frame-pixels="selfFramePixels"
            :selected-id="selectedDecorId"
            @move="decor.move"
            @scale="decor.setScale"
            @remove="removeDecorSticker"
            @select="selectedDecorId = $event"
          />
          <section v-if="showDecorInventory" class="game-decor-inventory" aria-label="카메라 꾸미기 인벤토리">
            <div class="game-decor-head">
              <strong>카메라 꾸미기</strong>
              <button type="button" aria-label="인벤토리 닫기" @click="showDecorInventory = false">×</button>
            </div>
            <div v-if="decor.inventory.value.length" class="game-decor-items">
              <button
                v-for="item in decor.inventory.value"
                :key="item.itemId"
                type="button"
                class="game-decor-item"
                :class="{ on: item.equipped }"
                :disabled="decorBusyItemId !== null || !decor.canEquip(item)"
                :title="decor.canEquip(item) ? item.name : `${item.name} · 장착 한도(${EQUIP_LIMIT[item.category]}개)`"
                @click="toggleDecorItem(item)"
              >
                <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" />
                <span v-else>✦</span>
              </button>
            </div>
            <p v-else class="game-decor-empty">{{ decor.loading.value ? '불러오는 중…' : '보유한 꾸미기 아이템이 없어요' }}</p>
            <!-- 효과는 영상 위 손잡이가 없어 크기 조절 자리를 이 슬라이더가 대신한다 -->
            <EffectIntensitySlider
              v-if="decor.cameraEffect.value"
              class="game-decor-fx"
              :intensity="decor.cameraEffect.value.intensity"
              @change="decor.setIntensity(decor.cameraEffect.value!.itemId, $event)"
            />
            <button v-if="decor.placements.value.length" type="button" class="game-decor-save" :disabled="decor.saving.value" @click="saveGameDecor">
              {{ decor.saving.value ? '저장 중…' : decor.dirty.value ? '꾸미기 저장 *' : '꾸미기 저장' }}
            </button>
          </section>
          <button
            type="button"
            class="game-decor-shortcut"
            :class="{ active: showDecorInventory }"
            aria-label="카메라 꾸미기 인벤토리 열기"
            @click="showDecorInventory = !showDecorInventory"
          >
            <img :src="inventoryChest" alt="" />
            <span>카메라 꾸미기</span>
          </button>
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
            @close="requestCloseGame"
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
            :scores="scoreboardRows"
            :setter-name="setterName"
            embedded
            @close="requestCloseGame"
            @pose-submit="onPoseSubmit"
            @progress="onGameProgress"
            @finished="onBodyFitFinished"
          />
          <!-- 그림으로 말해요 — 솔로(session=null)·멀티(명세 v0.2.20 턴 릴레이) -->
          <DrawingRelayGame
            v-else-if="activeGame?.id === 'draw'"
            ref="gameComp"
            :video="selfVideoEl ?? null"
            :session="activeSession"
            :results="gameResults"
            :my-user-id="myParticipantId"
            :draw-events="drawFeed"
            :names="participantNames"
            :room-id="roomCode"
            @close="requestCloseGame"
            @draw="(seq: number, ops: DrawOp[]) => roomChat.sendGameDraw(seq, ops)"
            @turn-skip="(turnIdx: number, remainingMs: number) => roomChat.sendGameTurnSkip(turnIdx, remainingMs)"
          />
          <!-- 게임⑤ 모션 낚시(S15P11A706-49) — 서버 권위 90초 세션. 점수가 누적 합계라
               실시간 스코어보드에는 마리 수만 중계하고 총점은 종료 시 한 번 제출한다. -->
          <FishingGame
            v-else-if="activeGame?.id === 'fish'"
            ref="gameComp"
            :video="selfVideoEl ?? null"
            :session="activeSession"
            :results="gameResults"
            :my-user-id="myParticipantId"
            embedded
            @close="requestCloseGame"
            @progress="onFishingProgress"
            @finished="onFishingFinished"
          />
          <!-- 캐치캐치리듬 — 전용 STOMP 채널이라 activeSession을 쓰지 않는다(자기 생명주기 소유).
               roomChat은 구독/발행 구멍만 쓰고 리듬 도메인 지식은 컴포넌트 안에 있다. -->
          <CatchRhythmGame
            v-if="activeGame?.id === 'rhythm'"
            ref="gameComp"
            :video="selfVideoEl ?? null"
            :room-id="roomCode"
            :is-host="selfIsHost"
            :my-user-id="myParticipantId"
            :room-chat="roomChat"
            @close="requestCloseGame"
            @started="rhythmEnded = false"
            @ended="onRhythmEnded"
          />
          <!-- 비방장 중간 이탈 후 복귀(-164) — 라운드가 살아 있는 동안만 노출 -->
          <button
            v-if="!activeGame && !gamePrep && activeSession && !gameResults"
            class="game-rejoin"
            @click="rejoinGame"
          >▶ 게임 복귀</button>
          <!-- 게임 시작 준비 게이트(-161) — GAME_START는 왔지만 모션 모델이 아직 없을 때.
               게임이 마운트될 자리(셀프 타일)를 그대로 덮어 "여기서 곧 시작된다"가 보이게 한다 -->
          <div v-if="gamePrep" class="game-prep">
            <template v-if="!gamePrep.failed">
              <div class="game-prep-title"><i /> {{ gamePrep.entry.name }} 준비 중</div>
              <div class="game-prep-track">
                <div class="game-prep-fill" :style="{ width: `${Math.max(Math.round(gamePrep.progress * 100), 4)}%` }" />
              </div>
              <small v-if="gamePrep.waiting && gamePrep.progress >= 1">
                참가자 준비를 기다리고 있어요… {{ gamePrep.waiting.ready }}/{{ gamePrep.waiting.total }}
              </small>
              <small v-else>모션 인식 모델을 받고 있어요… {{ Math.round(gamePrep.progress * 100) }}%</small>
            </template>
            <template v-else>
              <div class="game-prep-title fail">모션 인식 모델을 준비하지 못했어요</div>
              <small>네트워크 상태를 확인한 뒤 다시 시도해 주세요</small>
              <div class="game-prep-actions">
                <button class="px" @click="retryGamePrep">다시 시도</button>
                <button class="px ghost" @click="cancelGamePrep">닫기</button>
              </div>
            </template>
          </div>
          <div class="self-label">
            <span class="c-g">{{ selfIsHost ? 'YOU · HOST' : 'YOU' }}</span>
            <span :style="{ color: selfMicOn ? '#5cbf4a' : '#e85d6e' }">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
            </span>
          </div>
        </div>

        <!-- 나머지 참가자 — 인원수(2~8명)에 맞춰 열 수가 달라지는 그리드 -->
        <div
          v-if="!isSoloPlay && isSideBySideLayout"
          class="side-tray"
          :class="isEightPlayerLayout ? 'side-tray-right' : capacity === 5 ? 'side-tray-right-two' : 'side-tray-right-three'"
        >
          <ParticipantTile
            v-for="(slot, i) in rightSideSlots"
            :key="`right-${i}`"
            :view="slot.view"
            :host="slot.host"
            :prefer-cam="!activeGame"
            :cover="coverFor(slot)"
            :volume="volumeFor(slot)"
            :sprites="spritesFor(slot)"
            :effect="effectFor(slot)"
            play-audio
            mirror
            compact
            :can-kick="amRoomHost && !!slot.view"
            :can-invite="!activeGame"
            @kick="openKick(slot.view)"
            @friend="addFriend(slot.view)"
            @volume="changeVolume(slot, $event)"
          />
        </div>
        <div v-if="!isSoloPlay && !isSideBySideLayout" class="others-tray" :style="{ '--cols': othersColumns }">
          <ParticipantTile
            v-for="(slot, i) in otherSlots"
            :key="i"
            :view="slot.view"
            :host="slot.host"
            :prefer-cam="!activeGame"
            :cover="coverFor(slot)"
            :volume="volumeFor(slot)"
            :sprites="spritesFor(slot)"
            :effect="effectFor(slot)"
            play-audio
            mirror
            :can-kick="amRoomHost && !!slot.view"
            :can-invite="!activeGame"
            @kick="openKick(slot.view)"
            @friend="addFriend(slot.view)"
            @volume="changeVolume(slot, $event)"
          />
        </div>

        <!-- 실시간 스코어보드 (게임 중, S15P11A706-82) — 제목 줄을 잡아 옮길 수 있다 -->
        <div
          v-if="activeSession && !gameResults"
          ref="scoreEl"
          class="px game-scoreboard"
          :class="{ bf: activeGame?.id === 'shape', fs: activeGame?.id === 'finger', dragging: scoreDragging }"
          :style="scoreStyle"
        >
          <div
            class="gs-title"
            title="끌어서 옮기기 · 더블클릭하면 제자리로"
            @pointerdown="onScoreDown"
            @pointermove="onScoreMove"
            @pointerup="onScoreUp"
            @pointercancel="onScoreUp"
            @dblclick="resetScorePos"
          >
            ⭐ LIVE SCORE <span class="gs-grip" aria-hidden="true">⠿</span>
          </div>
          <div
            v-for="row in scoreboardRows"
            :key="row.userId"
            class="gs-row"
            :class="{ me: row.userId === myParticipantId }"
          >
            <span class="gs-name">{{ row.nickname }}</span>
            <!-- 등급 배지는 출제 대결 전용 — 연속 서바이벌 점수는 누적 총점이라 역산이 안 된다 -->
            <span
              v-if="activeGame?.id === 'shape' && !bodyFitChain && row.finished"
              class="gs-badge"
              :style="{ color: bodyFitGrade(row.score ?? 0).color, borderColor: bodyFitGrade(row.score ?? 0).color }"
            >
              {{ bodyFitGrade(row.score ?? 0).label }}
            </span>
            <!-- 게임④는 별이 없다 — 출제 대결은 실시간 일치율, 연속 서바이벌은 누적 점수를 보여준다 -->
            <span v-else class="gs-val">{{
              row.finished
                ? `${row.score}점 ✓`
                : activeGame?.id === 'shape'
                  ? bodyFitChain
                    ? `${Math.round(row.holdProgress * bodyFitChainMax)}점`
                    : `일치율 ${Math.round(row.holdProgress * 100)}%`
                  : activeGame?.id === 'fish'
                    ? `🐟 ${row.completedCount}마리`
                    : `⭐ ${row.starsLit}`
            }}</span>
          </div>
          <div v-if="scoreboardRows.length === 0" class="gs-empty">진행 상황 수신 대기 중…</div>
        </div>
      </div>

    </main>

    <!-- 하단 바 -->
    <footer class="room-footer">
      <div class="controls">
        <button class="ctrl" :class="{ on: speakerOn, off: !speakerOn }" title="스피커" @click="speakerOn = !speakerOn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 9a3.5 3.5 0 010 6" /></svg>
        </button>
        <button class="ctrl" :class="{ on: selfMicOn, off: !selfMicOn }" title="마이크" @click="toggleMic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="9" y="3" width="6" height="11" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
        </button>
        <button class="ctrl" :class="{ on: selfCamOn, off: !selfCamOn }" title="카메라" @click="toggleCam">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="2" y="6" width="14" height="12" /><path d="M16 10l6-4v12l-6-4" /></svg>
        </button>
      </div>

      <!-- 채팅 독 -->
      <div class="footer-chat-actions">
      <div class="chat-dock">
        <div class="chat-log">
          <div class="chat-log-list">
            <div
              v-for="b in visibleBubbles"
              :key="b.id"
              class="px bubble"
              :class="{ me: b.me, suggest: b.kind === 'GAME_SUGGEST', fading: b.fading }"
            >
              <button v-if="!b.me && isMember && b.kind !== 'GAME_SUGGEST'" class="bubble-report" title="신고" @click="openReport(b)">
                <ReportIcon />
              </button>
              <template v-if="b.kind === 'GAME_SUGGEST'">
                <span class="bubble-name">🎮 {{ b.nickname }}</span> {{ b.text }}
                <button v-if="amRoomHost" class="px suggest-pick" @click="selectSuggested(b.gameName)">
                  &gt; 플레이
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
          <svg class="send-icon" viewBox="0 0 24 24" aria-label="전송"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
        </button>

        <!-- 채팅 전체보기: 반투명 패널로 입장 이후 전체 대화 표시 -->
        <template v-if="chatExpanded">
          <div class="chat-full-backdrop" @click="chatExpanded = false" />
          <div class="chat-full">
            <div class="chat-full-body">
              <p v-if="!allBubbles.length" class="chat-full-empty">아직 대화가 없어요</p>
              <div
                v-for="b in allBubbles"
                :key="b.id"
                class="px bubble full"
                :class="{ me: b.me, suggest: b.kind === 'GAME_SUGGEST' }"
              >
                <button v-if="!b.me && isMember && b.kind !== 'GAME_SUGGEST'" class="bubble-report" title="신고" @click="openReport(b)">
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
      <button
        class="px start-btn footer-start-btn"
        :class="{ suggest: !amRoomHost }"
        :disabled="pickerLocked || gameInProgress || (detailLoaded && !amRoomHost && suggestCooldown)"
        :title="startHint"
        :aria-disabled="gameInProgress"
        @click="openPicker"
      >
        <span class="play-ico">▶</span>
        <span class="start-title">{{ startLabel }}</span>
      </button>
      </div>

      <div class="footer-right">
        <button class="px leave" @click="leave">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 16l4-4-4-4M13 12H3" /></svg>
          LEAVE
        </button>
      </div>
    </footer>

    <!-- 게임 선택 모달 -->
    <GamePicker
      v-if="picker"
      :closed-game-ids="closedGameIds"
      :is-host="selfIsHost"
      @close="picker = false"
      @launch="pick"
      @guide="openGuide"
    />

    <!-- 설명 함께 보기 — 방장이 넘기면 방 전원 화면이 같이 넘어간다 -->
    <RoomGuideModal
      v-if="guideOpen && guideGame && guideState"
      :game="guideGame"
      :pages="guidePages"
      :page="guideState.page"
      :is-host="selfIsHost"
      @update:page="setGuidePage"
      @start="startFromGuide"
      @back="guideBackToPicker"
      @dismiss="guideDismissed = true"
    />

    <!-- 게임④(-9) 설정 창 — 모드·벽 수·난이도. 옵션이 있는 게임만 이 단계를 거친다 -->
    <GameSetupModal
      v-if="setupGame"
      :game="setupGame"
      :member-count="roomPlayerCount()"
      @back="backToPicker"
      @start="startWithSetup"
    />

    <!-- 친구 초대 (-100) -->
    <InviteFriendsModal
      v-if="inviteOpen"
      :room-id="roomCode"
      :member-ids="memberIds"
      @close="inviteOpen = false"
    />

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

    <!-- 게임 ✕ 확인(-164) — 방장은 전체 종료, 비방장은 이번 판 이탈(복귀 가능) -->
    <PixelModal v-if="closeGameConfirm" variant="lobby" @close="closeGameConfirm = false">
      <div class="leave-confirm">
        <span class="leave-icon" aria-hidden="true">🎮</span>
        <p class="leave-kicker">GAME EXIT</p>
        <h3 class="leave-title">{{ amRoomHost ? '전체 게임을 종료할까요?' : '게임에서 나갈까요?' }}</h3>
        <p class="leave-desc">
          <template v-if="amRoomHost && hostCloseEndsAll">방장이 종료하면 모든 참가자의 게임이 함께 끝나요.<br />이번 판 점수는 기록되지 않습니다.</template>
          <!-- 솔로 연습(게임④) — 서버 세션이 없어 같이 끝날 사람이 없다 -->
          <template v-else-if="amRoomHost">하던 판이 사라지고 대기실로 돌아가요.<br />이번 판 점수는 기록되지 않습니다.</template>
          <template v-else>게임은 계속 진행돼요.<br />라운드가 끝나기 전이라면 ‘게임 복귀’로 다시 들어올 수 있어요.</template>
        </p>
        <div class="leave-confirm-actions">
          <PixelButton class="leave-cancel" block @click="closeGameConfirm = false">계속 하기</PixelButton>
          <PixelButton class="leave-submit" block @click="confirmCloseGame">{{ amRoomHost ? '전체 종료' : '나가기' }}</PixelButton>
        </div>
      </div>
    </PixelModal>

    <PixelModal v-if="showLeaveConfirm" variant="lobby" @close="answerLeave(false)">
      <div class="leave-confirm">
        <span class="leave-icon" aria-hidden="true">🚪</span>
        <p class="leave-kicker">ROOM EXIT</p>
        <h3 class="leave-title">정말 떠나시겠습니까?</h3>
        <p class="leave-desc">나가면 현재 방과의 연결이 종료돼요.<br />친구들과 다시 만나려면 방에 재입장해야 합니다.</p>
        <div class="leave-confirm-actions">
          <PixelButton class="leave-cancel" block @click="answerLeave(false)">계속 놀기</PixelButton>
          <PixelButton class="leave-submit" block @click="answerLeave(true)">나가기</PixelButton>
        </div>
      </div>
    </PixelModal>

    <PixelModal v-if="kickTarget" variant="lobby" @close="closeKick">
      <div class="leave-confirm">
        <span class="leave-icon" aria-hidden="true">⚠️</span>
        <p class="leave-kicker">HOST CONTROL</p>
        <h3 class="leave-title">{{ kickTarget.name }}님을 강퇴할까요?</h3>
        <p class="leave-desc">강퇴 사유를 선택해 주세요. 강퇴된 참가자는 방이 유지되는 동안 재입장할 수 없어요.</p>
        <div class="kick-reasons" role="radiogroup" aria-label="강퇴 사유">
          <label v-for="reason in KICK_REASONS" :key="reason.code" class="kick-reason-option">
            <input v-model="kickReason" type="radio" name="kick-reason" :value="reason.code" :disabled="kicking" />
            {{ reason.label }}
          </label>
        </div>
        <div class="leave-confirm-actions">
          <PixelButton class="leave-cancel" block :disabled="kicking" @click="closeKick">취소</PixelButton>
          <PixelButton class="leave-submit" block :disabled="kicking" @click="confirmKick">강퇴하기</PixelButton>
        </div>
      </div>
    </PixelModal>


    <!-- 채팅 메시지 신고 -->
    <PixelModal v-if="reportTarget" variant="lobby" @close="closeReport">
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
    <PixelModal v-if="userReportOpen" variant="lobby" @close="closeUserReport">
      <button type="button" class="report-close" aria-label="유저 신고 닫기" @click="closeUserReport">×</button>
      <h3 class="report-title">🚩 유저 신고</h3>
      <p class="report-field-label">신고할 유저를 선택해 주세요</p>
      <ul class="report-reasons">
        <li v-for="p in reportTargets" :key="p.userId">
          <label class="report-option">
            <input type="radio" name="user-report-target" :value="p.userId" v-model="userReportSelection" />
            {{ p.name }}
          </label>
        </li>
        <li v-if="!reportTargets.length" class="report-user-empty">신고할 다른 참가자가 없어요</li>
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
      <div class="leave-actions user-report-actions">
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
  /* min-width 하드 바닥을 두지 않는다 — Windows 배율 × 크롬 줌이 곱해져서 CSS 뷰포트가
     물리 해상도보다 훨씬 좁아진다(1366@125% = 1093px, 1920@150%+줌125% = 1024px).
     1120px 바닥이 있으면 그 아래에서 가로가 통째로 잘렸다. 아래 @media(max-width:1120px)로
     크롬(리본·푸터·컨트롤)을 줄여 캠 영역을 지킨다 — AppHeader가 쓰는 것과 같은 브레이크포인트. */
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
.leave-confirm { text-align: center; color: #403124; }
.leave-icon {
  display: grid;
  width: 54px;
  height: 54px;
  margin: 0 auto 12px;
  place-items: center;
  border: 3px solid #b78d5d;
  border-radius: 12px;
  background: #fff0b9;
  box-shadow: 3px 3px 0 #e2d0b5;
  font-size: 26px;
}
.leave-kicker { margin: 0 0 7px; color: #9e6b43; font-size: 9px; letter-spacing: 1px; }
.leave-confirm .leave-title { margin-bottom: 10px; font-size: 19px; }
.leave-confirm .leave-desc { margin-bottom: 22px; color: #806e5e; font-size: 11px; }
.leave-confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.leave-confirm-actions :deep(.px-btn) {
  height: 46px;
  border: 3px solid #925c47;
  border-radius: 7px;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, .42), inset -2px -3px 0 rgba(120, 58, 47, .18), 3px 3px 0 #a66b50;
  font-size: 19px;
}
.leave-confirm-actions :deep(.leave-cancel) { background: #fff7e5; color: #4b372b; }
.leave-confirm-actions :deep(.leave-submit) { background: #ef7775; color: #fff; }
.kick-reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: -7px 0 19px; text-align: left; }
.kick-reason-option { display: flex; align-items: center; gap: 5px; min-height: 27px; padding: 4px 6px; border: 1px solid #d9c29e; border-radius: 5px; background: #fffaf0; color: #715a48; font-size: 8px; cursor: pointer; }
.kick-reason-option:has(input:checked) { border-color: #d45c63; background: #ffe8e7; color: #a94d52; }
.kick-reason-option input { accent-color: #d45c63; margin: 0; }

.room-ribbon { flex: none; position: relative; height: 54px; padding: 0 28px; display: flex; align-items: center; gap: 14px; border-bottom: 2px solid rgba(56, 38, 61, .18); background: linear-gradient(110deg, rgba(207, 244, 231, .95), rgba(255, 240, 185, .95)); z-index: 5; }
.room-ribbon .px-kicker { padding: 5px 9px; font-size: 8px; }
.room-ribbon .px-kicker i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-coral); animation: px-blink 1s steps(2) infinite; }
.room-ribbon b { font-size: 12px; }

/* 실시간 끊김 안내 — 리본 바로 아래 전폭. 평소엔 렌더되지 않아 자리를 차지하지 않는다. */
.offline-bar {
  flex: none;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 7px 16px;
  border-bottom: 2px solid var(--c-ink);
  background: var(--c-coral); color: #fff;
  font-size: 9px;
  z-index: 5;
}
.offline-reload {
  flex: none;
  border: 2px solid var(--c-ink); border-radius: 8px;
  background: #fff; color: var(--c-ink);
  padding: 4px 10px; font-size: 8px; font-weight: 700;
}
.offline-reload:hover { background: var(--c-yellow); }

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
.cam-stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: row; align-items: center; gap: 14px; }

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
.gs-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 8px;
  color: #f0a815;
  cursor: grab;
  /* 손잡이를 끄는 동안 브라우저가 스크롤·선택으로 가로채지 않게 */
  touch-action: none;
  user-select: none;
}
.gs-grip { color: #c9b48b; font-size: 10px; letter-spacing: -1px; }
.game-scoreboard.dragging { cursor: grabbing; }
.game-scoreboard.dragging .gs-title { cursor: grabbing; }
.gs-row { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 8px; color: var(--c-ink-soft); }
.gs-row.me .gs-name { color: #f0a815; }
.gs-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
.gs-val { color: #5cbf4a; white-space: nowrap; }
.gs-empty { font-size: 7px; color: #a99f86; }
.gs-badge { font-size: 7px; font-weight: 800; padding: 2px 6px; border: 1px solid; border-radius: 6px; white-space: nowrap; }

/* 핑거 스타 — 게임 상단 바(top 40px, 높이 약 46px) 아래로 내린다.
   z-index:5라 그냥 두면 상단 바 오른쪽 끝의 게임 종료 ✕를 덮는다 */
.game-scoreboard.fs { top: 92px; }

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
.self-video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); background: var(--c-letterbox); }
.game-decor-shortcut { position: absolute; z-index: 5; right: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 6px; height: 39px; padding: 0 9px 0 5px; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; color: #5e4432; box-shadow: 2px 2px 0 rgba(45,28,17,.35); font-size: 10px; font-weight: 700; }
.game-decor-shortcut:hover, .game-decor-shortcut.active { background: #fff4d6; transform: translate(-1px, -1px); }
.game-decor-shortcut img { width: 28px; height: 28px; object-fit: contain; image-rendering: pixelated; }
.game-decor-inventory { position: absolute; z-index: 6; right: 12px; bottom: 59px; width: min(210px, calc(100% - 24px)); overflow: hidden; border: 2px solid #8d6a54; border-radius: 7px; background: #fffdf7; box-shadow: 3px 3px 0 rgba(45,28,17,.4); color: #533d2f; }
.game-decor-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 2px solid #dec79e; background: #f7e5bb; font-size: 11px; }
.game-decor-head button { width: 19px; height: 19px; padding: 0; border: 0; background: transparent; color: #79553d; font-size: 19px; line-height: 1; }
.game-decor-items { display: flex; flex-wrap: wrap; gap: 6px; min-height: 57px; padding: 10px; }
.game-decor-item { display: grid; width: 35px; height: 35px; place-items: center; padding: 3px; border: 2px solid #d9c3a2; border-radius: 5px; background: #fff; }
.game-decor-item.on { border-color: #75a55e; background: #e4f0d2; }
.game-decor-item:disabled:not(.on) { opacity: .45; }
.game-decor-item img { width: 100%; height: 100%; object-fit: contain; }
.game-decor-empty { margin: 0; padding: 18px 10px; color: #8f7868; font-size: 10px; text-align: center; }
.game-decor-save { width: calc(100% - 20px); height: 30px; margin: 0 10px 10px; border: 2px solid #9a694d; border-radius: 6px; background: #edc66e; color: #543a29; font-size: 10px; font-weight: 700; }
.game-decor-save:disabled { opacity: .7; }
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
  grid-auto-rows: minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.side-tray {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: grid;
  gap: 12px;
  align-items: center;
}
.side-tray-left { grid-template-rows: repeat(3, minmax(0, 1fr)); }
.side-tray-left-two { grid-template-rows: repeat(2, minmax(0, 1fr)); }
.side-tray-right { grid-template-rows: repeat(4, minmax(0, 1fr)); }
.side-tray-right-two { grid-template-rows: repeat(2, minmax(0, 1fr)); }
.side-tray-right-three { grid-template-rows: repeat(3, minmax(0, 1fr)); }
.side-tray :deep(.tile) {
  width: auto;
  height: 100%;
  max-width: 100%;
  justify-self: center;
}
.side-tray-left-two :deep(.tile), .side-tray-right-two :deep(.tile) {
  width: 100%;
  height: auto;
  max-width: none;
  justify-self: stretch;
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
/* 친구 초대(-100) — 신고 버튼과 같은 규격. margin-left:auto는 신고 버튼이 이미 갖고 있어 생략. */
.ribbon-invite {
  flex: none; width: 34px; height: 34px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--c-ink); border-radius: 10px;
  background: #fff; box-shadow: var(--shadow-sm);
}
.ribbon-invite:hover { background: var(--c-mint-soft); }
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

.footer-chat-actions { grid-row: 1; grid-column: 1; display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.chat-dock { position: relative; flex: 0 1 420px; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; height: 52px; background: #fff; border: 3px solid var(--c-ink-soft); border-radius: 14px; box-shadow: var(--shadow-sm); }
.chat-log {
  position: absolute; bottom: 62px; left: 0; width: 100%;
  display: flex; flex-direction: column; gap: 8px;
  overflow: visible;
}
.chat-log-list { display: flex; flex-direction: column; gap: 8px; }
.bubble { position: relative; max-width: 100%; padding: 10px 24px 10px 13px; font-size: 12px; line-height: 1.65; border: 2px solid var(--c-ink-soft); background: #fff; box-shadow: 2px 2px 0 rgba(43, 35, 51, 0.2); animation: px-bubble 0.2s steps(3); word-break: break-word; overflow-wrap: anywhere; transition: opacity 0.4s ease; }
/* 6개 초과로 밀려날 땐 그대로 바로 사라지고, 시간이 지나 사라질 때만(.fading) 흐려지며 사라진다 */
.bubble.fading { opacity: 0; }
.bubble.me { background: #fff4cc; }
.bubble.suggest { background: var(--c-mint-soft); display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.bubble-name { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 800; color: #2f9e3d; }
.bubble-name.me { color: #c97e00; }
.suggest-pick { align-self: flex-end; border: 2px solid var(--c-ink-soft); border-radius: 8px; background: var(--c-yellow); padding: 5px 8px; font-size: 8px; font-weight: 700; }

/* 메시지 신고 버튼 — 말풍선 안쪽 우상단, 테두리 없이 아이콘만 */
.bubble-report {
  position: absolute; top: 4px; right: 4px; z-index: 1;
  width: 9px; height: 11px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
}
.bubble-report:hover { opacity: 0.75; }

/* 신고 모달 */
:deep(.modal.lobby) { position: relative; }
.report-close { position: absolute; top: 21px; right: 22px; display: grid; width: 24px; height: 24px; place-items: center; padding: 0; border: 0; background: transparent; color: #79553d; font-size: 23px; line-height: 1; }
.report-close:hover { color: #c15d5a; }
.report-title { margin: 0 0 14px; color: #3d2c22; font-family: var(--font-pixel); font-size: 20px; font-weight: 400; }.report-title::before { display: block; margin-bottom: 5px; color: #b17b51; content: 'REPORT'; font-family: inherit; font-size: 9px; letter-spacing: 1px; }
.report-target { margin-bottom: 14px; padding: 12px; border: 2px solid #dec59e; border-radius: 7px; background: #fff7e8; }
.report-target-name { font-size: 11px; font-weight: 800; color: #8c5a42; }
.report-target-text { display: -webkit-box; margin: 5px 0 0; overflow: hidden; color: var(--c-ink-soft); font-size: 11px; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
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
.report-field-label + .report-reasons { margin-top: 12px; }
.report-textarea {
  width: 100%; margin: 8px 0 18px; padding: 8px 10px;
  border: 2px solid var(--c-ink-soft); border-radius: 9px;
  font-size: 11px; color: var(--c-ink-soft);
  font-family: inherit; resize: vertical;
}
.report-title ~ .leave-actions { margin-top: 20px; }.report-title ~ .leave-actions :deep(.px-btn) { border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 14px; }.report-title ~ .leave-actions :deep(.v-secondary) { background: #fffaf0; color: #6e5646; }.report-title ~ .leave-actions :deep(.v-primary) { background: #e97872; color: #fff; }
.user-report-actions { grid-template-columns: 1fr; margin-top: 8px !important; }
.chat-dock input { position: relative; z-index: 47; flex: 1; min-width: 0; margin-left: -5px; background: transparent; border: none; outline: none; color: var(--c-ink-soft); font-size: 15px; }
.chat-count { flex: none; font-size: 9px; color: #a99f86; }
.chat-count.over { color: var(--c-coral); }
.chat-send { position: relative; z-index: 47; flex: none; width: 38px; height: 38px; border: 2px solid var(--c-ink-soft); border-radius: 10px; background: var(--c-yellow); color: var(--c-ink-soft); display: flex; align-items: center; justify-content: center; }

/* 채팅 전체보기 토글 버튼 — 전체보기 패널이 열려도(배경 오버레이 z-index:45보다 위) 계속 클릭 가능해야 한다 */
.chat-expand { position: relative; z-index: 47; flex: none; width: 32px; height: 32px; border: 2px solid var(--c-ink-soft); border-radius: 9px; background: #fff; color: #a99f86; display: flex; align-items: center; justify-content: center; }
.chat-expand.active { background: var(--c-yellow); color: var(--c-ink-soft); }

/* 채팅 전체보기 패널 — 입장 이후 전체 대화를 반투명하게 보여준다 */
/*
 * 백드롭은 헤더(AppHeader z-index:20)보다 아래에 둔다. 45로 두면 화면 전체를 덮는 투명 레이어가
 * 헤더 위에 깔려서, 전체보기가 열린 동안 헤더 클릭이 이 백드롭에 먹힌다("한 번 눌렀는데 아무 일도
 * 안 일어남" — 첫 클릭은 패널만 닫고 끝난다). 바깥 클릭 감지에는 19로도 충분하고,
 * 패널 자신은 z-index:46이라 여전히 백드롭 위에 뜬다.
 */
.chat-full-backdrop { position: fixed; inset: 0; z-index: 19; background: transparent; }
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
  /* column-reverse + 뒤집힌 allBubbles — 열자마자 최신(스크롤 하단)이 보이고 새 메시지에 하단 고정(-159) */
  flex: 1; min-height: 0; display: flex; flex-direction: column-reverse; gap: 8px; padding: 10px 12px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-full-body::-webkit-scrollbar { display: none; }
.chat-full-empty { align-self: center; margin: 20px 0; font-size: 13px; color: #a99f86; }
.bubble.full { max-width: none; background: rgba(255, 255, 255, 0.9); }
.bubble.full.me { background: rgba(255, 244, 204, 0.9); }
.bubble.full.suggest { background: rgba(214, 244, 233, 0.9); }

.footer-right { grid-row: 1; grid-column: 3; justify-self: end; display: flex; align-items: center; gap: 10px; }
.leave { display: flex; align-items: center; gap: 9px; padding: 0 18px; height: 52px; border: 3px solid var(--c-ink-soft); border-radius: 14px 14px 10px 14px; background: var(--c-coral); color: #fff; font-size: 9px; box-shadow: var(--shadow-sm); }

.room-toast { position: fixed; top: 50%; left: 50%; z-index: 90; padding: 13px 20px; transform: translate(-50%, -50%); background: rgba(56, 38, 61, .9); border: 0; border-radius: 9px; color: #fff; font-size: 11px; line-height: 1.7; box-shadow: none; }

.toast-enter-active { animation: room-toast-pop 0.18s steps(3); }
.toast-leave-active { transition: opacity 0.2s; }
.toast-leave-to { opacity: 0; }
@keyframes room-toast-pop {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
  to { opacity: 1; transform: translate(-50%, -50%); }
}

@keyframes px-bubble { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* Lobby visual language: warm paper, garden pastels, and soft wood outlines. */
.room-shell {
  --room-paper: #fffdf7;
  --room-wood: #d9b77f;
  --room-ink: #403124;
  --room-muted: #806e5e;
  --room-shadow: #dfcdb0;
  background-color: #fffaf0;
  background-image:
    linear-gradient(0deg, rgba(204, 169, 115, .11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(204, 169, 115, .08) 1px, transparent 1px);
  background-size: 16px 16px;
  color: var(--room-ink);
}

.room-ribbon {
  height: 80px;
  padding: 0 42px;
  border-bottom: 3px solid var(--room-wood);
  background: rgba(255, 250, 240, .94);
  box-shadow: 0 4px 0 rgba(217, 183, 127, .2);
}
.room-ribbon .px-kicker {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--room-ink);
  box-shadow: none;
  font-size: 32px;
}
.room-ribbon .px-kicker i { background: #ef7775; }
.room-brand { margin-right: 10px; }
.room-brand :deep(.mark) { width: 48px; height: 48px; font-size: 24px; transform: none; box-shadow: none; }
.room-logo-btn { display: flex; padding: 0; border: 0; background: transparent; cursor: pointer; }
.ribbon-report, .ribbon-invite, .ribbon-settings, .ribbon-sound-btn {
  width: auto;
  height: 22px;
  min-width: 32px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--room-ink);
  font-family: var(--font-pixel);
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
}
.ribbon-invite { min-width: 58px; }
.ribbon-sound { position: relative; }
.ribbon-sound-btn { min-width: 58px; cursor: pointer; }
.ribbon-sound-btn.active, .ribbon-sound-btn:hover { color: #5b8d45; }
.sound-settings-pop { position: absolute; z-index: 30; top: 30px; right: 0; width: 188px; padding: 12px; border: 2px solid #8d6048; border-radius: 9px; background: #fff8e9; color: #5a3e30; box-shadow: 3px 3px 0 rgba(92, 63, 44, .22); }
.sound-settings-pop label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; font-size: 11px; }
.sound-settings-pop input { width: 100%; min-width: 0; accent-color: #6c9b54; }
.ribbon-report:hover { background: transparent; color: #c15d5a; }
.ribbon-invite:hover, .ribbon-settings:hover { background: transparent; color: #5b8d45; }
/* 음악 버튼도 이웃과 같은 아이콘 형태로 — 컴포넌트 자체 스타일은 박스라 여기서 벗긴다.
   열려 있을 때만 배경으로 표시한다(팝오버가 떠 있다는 신호). */
.ribbon-music-wrap :deep(.ribbon-music) {
  width: auto;
  height: auto;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  box-shadow: none;
  color: var(--room-ink);
}
.ribbon-music-wrap :deep(.ribbon-music:hover) { background: transparent; color: #5b8d45; }
.ribbon-music-wrap :deep(.ribbon-music.open) { background: rgba(183, 141, 93, .18); color: #5b8d45; box-shadow: none; }
.ribbon-music-wrap :deep(.ribbon-music.silent) { color: #c15d5a; }
.code-box {
  display: grid;
  gap: 2px;
  height: auto;
  padding: 0 6px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.code-cap { color: var(--room-muted); font-size: 9px; }
.code-val { color: #bd6d45; font-size: 18px; }
.code-line { gap: 4px; }
.copy { border: 0; border-radius: 0; background: transparent; color: var(--room-ink); }
.room-ribbon .px-kicker { order: 0; }
.code-box { position: relative; order: 1; }
.code-box { margin-right: auto; }
.ribbon-report { margin-left: 0; }
/* 음악 버튼도 버튼 그룹(order 2)에 넣는다 — 기본 order 0으로 두면 방 코드 앞으로 튄다.
   같은 order 안에서는 DOM 순서를 따르므로 신고 버튼 왼쪽에 선다. */
.ribbon-report, .ribbon-invite, .ribbon-settings, .ribbon-music-wrap, .ribbon-sound, .ribbon-divider { position: relative; order: 2; }
.ribbon-divider {
  display: inline-flex;
  align-items: center;
  height: 22px;
  color: #b78d5d;
  font-size: 12px;
  font-weight: 300;
  line-height: 1;
}

.start-btn {
  border: 3px solid #925c47;
  border-radius: 7px;
  background: #ef6d70;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, .4), inset -2px -3px 0 rgba(120, 58, 47, .2), 4px 4px 0 #a66b50;
}
.start-btn.suggest { background: #e7c996; color: var(--room-ink); }
.controls .start-btn {
  position: static;
  transform: none;
  height: 50px;
  padding: 0 16px;
  white-space: nowrap;
}
.footer-start-btn, .footer-start-btn.suggest { position: static; flex: none; height: 50px; padding: 0 12px; border: 3px solid #4e67a3; border-radius: 7px; background: #7195df; color: #fff; box-shadow: 3px 3px 0 #4e67a3; white-space: nowrap; transform: none; }
.footer-start-btn .start-title { font-size: 10px; }

.room-main { gap: 18px; padding: clamp(20px, 2vw, 26px) clamp(28px, 3.6vw, 46px); }
.cam-stage {
  padding: 12px;
  gap: 16px;
  border: 2px dashed #dfc9a6;
  border-radius: 18px;
  background: rgba(255, 253, 247, .65);
}
.self-tile {
  border-color: var(--room-wood);
  border-radius: 16px;
  background: var(--room-paper);
  box-shadow: none;
}
.self-tile.self-spot {
  flex: 0 0 62%;
}
.cam-stage.crowded .self-tile.self-spot { flex-basis: 55%; }
.cam-stage.side-layout { justify-content: center; gap: 16px; }
.cam-stage.side-layout .self-tile.self-spot {
  flex-basis: 58%;
  align-self: stretch;
  aspect-ratio: 8 / 5;
}
.cam-stage.five-player .self-tile.self-spot {
  flex-basis: 42%;
  align-self: center;
}
.cam-stage.four-player {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  grid-template-rows: repeat(3, minmax(0, 1fr));
  width: auto;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 32 / 15;
  align-self: center;
  align-items: stretch;
}
.cam-stage.four-player .self-tile.self-spot {
  grid-column: 1;
  grid-row: 1 / -1;
  width: auto;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  aspect-ratio: 8 / 5;
  place-self: center;
}
.cam-stage.four-player .others-tray { display: contents; }
.cam-stage.four-player .others-tray :deep(.tile) {
  width: auto;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  aspect-ratio: 8 / 5;
  place-self: center;
}
.cam-stage.three-player {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  grid-template-rows: repeat(2, minmax(0, 1fr));
  width: auto;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 12 / 5;
  align-self: center;
  align-items: stretch;
}
.cam-stage.three-player .self-tile.self-spot {
  grid-column: 1;
  grid-row: 1 / -1;
  width: auto;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  aspect-ratio: 8 / 5;
  place-self: center;
}
.cam-stage.three-player .others-tray { display: contents; }
.cam-stage.three-player .others-tray :deep(.tile) {
  width: auto;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  aspect-ratio: 8 / 5;
  place-self: center;
}
.cam-stage.two-player {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  flex: 0 1 auto;
  width: 100%;
  height: auto;
  max-height: 100%;
  aspect-ratio: var(--two-player-aspect, 16 / 5);
  gap: 12px;
  align-self: center;
  align-items: stretch;
}
.cam-stage.two-player .self-tile.self-spot {
  width: 100%;
  height: 100%;
  min-width: 0;
  aspect-ratio: var(--camera-aspect, 8 / 5);
  place-self: stretch;
}
.cam-stage.two-player .others-tray { display: contents; }
.cam-stage.two-player .others-tray :deep(.tile) {
  width: 100%;
  height: 100%;
  min-width: 0;
  aspect-ratio: var(--camera-aspect, 8 / 5);
  place-self: stretch;
}
/* 타일 비율은 레이아웃이 8/5로 고정하는데 실제 카메라는 4:3일 수도 있다 — cover면 그 차이만큼
   얼굴이 잘려 나간다. 잘라내지 않고 남는 자리를 회색 여백으로 둔다(스티커 오버레이의 fit도 같은 값). */
/* 솔로는 방 정원과 상관없이 다인 그리드 규칙을 전부 해제하고 내 화면 한 장만 채운다. */
.cam-stage.solo-play,
.cam-stage.solo-play.two-player,
.cam-stage.solo-play.three-player,
.cam-stage.solo-play.four-player {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  aspect-ratio: auto;
  align-self: stretch;
  align-items: stretch;
  justify-content: center;
}
.cam-stage.solo-play .self-tile.self-spot {
  flex: 0 1 auto;
  width: auto;
  height: 100%;
  max-width: 100%;
  aspect-ratio: var(--camera-aspect, 8 / 5);
  align-self: center;
  place-self: center;
}

/* 낚시는 640×480 캔버스라서 일반 카메라의 8:5 규칙을 쓰면 확대 시 세로가 잘린다. */
.self-tile.self-spot.fish-game,
.cam-stage.side-layout .self-tile.self-spot.fish-game,
.cam-stage.four-player .self-tile.self-spot.fish-game,
.cam-stage.three-player .self-tile.self-spot.fish-game {
  aspect-ratio: 4 / 3;
}
.self-video { object-fit: cover; background: var(--c-letterbox); }
.cam-off { background: linear-gradient(135deg, #bfe9ff, #d7e7ad); color: var(--room-muted); }
.cam-on-btn { border-color: #925c47; border-radius: 7px; background: #4078cf; box-shadow: 3px 3px 0 #a66b50; }
.self-label {
  border-color: #b78d5d;
  border-radius: 6px;
  background: #fffdf7;
  color: var(--room-ink);
  box-shadow: 2px 2px 0 #e2d0b5;
}
.c-g { color: #5b8d45; }
.game-scoreboard {
  border-color: var(--room-wood);
  border-radius: 12px;
  background: rgba(255, 253, 247, .97);
  box-shadow: 3px 3px 0 var(--room-shadow);
}
.gs-title, .gs-row.me .gs-name { color: #bd6d45; }
.gs-row { color: var(--room-ink); }
.gs-val { color: #5b8d45; }

.room-footer {
  padding: 16px 40px;
  border-top: 3px solid var(--room-wood);
  background: rgba(255, 250, 240, .96);
}
.ctrl, .chat-dock, .leave {
  border-color: #b78d5d;
  border-radius: 7px;
  box-shadow: 3px 3px 0 #e2d0b5;
}
.ctrl { background: #fffdf7; color: var(--room-ink); }
.ctrl.on { background: #d7e7ad; color: #5b8d45; }
.ctrl.off { background: #ffe2e3; color: #d45c63; }
.ctrl, .ctrl.on, .ctrl.off { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.chat-dock { background: #fffdf7; }
.chat-dock input { color: var(--room-ink); }
.chat-send { margin-left: -5px; border: 0; border-radius: 0; background: transparent; color: #bd6d45; box-shadow: none; }.send-icon { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-linecap: square; stroke-linejoin: round; stroke-width: 2.4; transform: translate(1px, 1px); }.chat-send:hover { background: transparent; color: #8e4d32; transform: translateY(-1px); }
.chat-expand { margin-left: -7px; border: 0; border-radius: 0; background: transparent; color: #bd6d45; box-shadow: none; }
.chat-expand.active { background: transparent; color: #bd6d45; }
.chat-expand:hover { color: #8e4d32; }
.bubble { border-color: #dfc9a6; border-radius: 9px; background: rgba(255, 253, 247, .78); box-shadow: 2px 2px 0 rgba(226, 208, 181, .65); }
.bubble.me { background: rgba(255, 240, 185, .78); }
.bubble.suggest { background: rgba(216, 244, 236, .78); }
.bubble-name { color: #5b8d45; }
.bubble-name.me { color: #bd6d45; }
.suggest-pick { border-color: #925c47; border-radius: 6px; background: #e7c996; color: var(--room-ink); }
.chat-full { border-color: var(--room-wood); border-radius: 12px; background: rgba(255, 253, 247, .95); box-shadow: 4px 4px 0 var(--room-shadow); }
.chat-full-head { color: var(--room-ink); border-bottom-color: #ead9bd; }
.chat-full-close { border-color: #b78d5d; border-radius: 5px; background: #fff7e5; color: var(--room-ink); }
.leave { border-color: #925c47; border-radius: 7px; background: #ef7775; box-shadow: 3px 3px 0 #a66b50; font-size: 10px; font-weight: 700; }

/* 비방장 중간 이탈 후 게임 복귀 버튼(-164) — 셀프 타일 우상단 */
.game-rejoin {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
  padding: 8px 14px;
  border: 2px solid #925c47;
  border-radius: 7px;
  background: #e7c996;
  color: var(--room-ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 2px 2px 0 rgba(43, 34, 28, 0.35);
}

/* ── 게임 시작 준비 게이트(-161) — 셀프 타일을 덮는 로딩/실패 패널 ── */
.game-prep {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px;
  background: rgba(43, 34, 28, .82);
  color: #fffdf7;
  text-align: center;
}
.game-prep-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
}
.game-prep-title i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #7fe0c3;
  animation: px-blink 1s steps(2) infinite;
}
.game-prep-title.fail { color: #ffb3ba; }
.game-prep-track {
  width: min(340px, 80%);
  height: 15px;
  padding: 3px;
  border: 2px solid #fffdf7;
  border-radius: 8px;
  background: rgba(255, 253, 247, .18);
  overflow: hidden;
}
.game-prep-fill {
  height: 100%;
  border-radius: 3px;
  background: repeating-linear-gradient(90deg, #7fe0c3 0 16px, #5cc9a8 16px 20px);
  transition: width .2s ease-out;
}
.game-prep small { font-size: 9px; color: rgba(255, 253, 247, .85); }
.game-prep-actions { display: flex; gap: 8px; }
.game-prep-actions .px {
  padding: 7px 14px;
  border: 2px solid #925c47;
  border-radius: 7px;
  background: #e7c996;
  color: var(--room-ink);
  font-size: 11px;
  cursor: pointer;
}
.game-prep-actions .px.ghost { background: #fff7e5; color: var(--room-muted); }

@media (max-width: 1280px) {
  .room-ribbon { padding: 0 28px; }
  .room-footer { padding: 14px 26px; }
}

/* 브라우저 125% 배율처럼 세로 여유가 줄어든 경우에도 게임 화면을 한 프레임 안에 유지한다. */
@media (max-height: 900px) {
  .room-shell:has(.cam-stage.game-active) .room-main {
    gap: 10px;
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .cam-stage.game-active {
    padding: 8px;
    gap: 10px;
  }
  .room-shell:has(.cam-stage.game-active) .room-footer {
    padding-top: 9px;
    padding-bottom: 9px;
  }
}

/**
 * 배율 대응 — AppHeader·BgmToggle이 쓰는 1120px 브레이크포인트와 같은 경계.
 *
 * 여기서 줄이는 건 전부 **고정 px 크롬**(리본·푸터·컨트롤·패딩)이다. `.cam-stage`는
 * `flex: 1`이라 크롬이 먹는 만큼만 남으므로, 세로가 짧아졌을 때(1366@125% = 614px) 고정
 * 크롬을 그대로 두면 그 차이가 전부 캠에서 깎여 타일 안 내용이 `overflow: hidden`에 잘린다.
 * 폰트도 8~12px 고정이라 같이 줄지 않으니 여기서 함께 낮춘다.
 */
@media (max-width: 1120px) {
  .room-ribbon { height: 54px; padding: 0 16px; }
  .room-ribbon b { font-size: 11px; }
  .room-ribbon .px-kicker { padding: 4px 7px; font-size: 7px; }

  .room-main { gap: 10px; padding: 12px 16px; }
  .cam-stage { gap: 10px; }

  /* 푸터 — 3열 그리드 구조는 그대로 두고 높이만 낮춘다(중앙 정렬 로직 유지) */
  .room-footer { gap: 10px; padding: 10px 14px; }
  .controls { gap: 7px; }
  .ctrl { width: 42px; height: 42px; border-width: 2px; border-radius: 11px 11px 8px 11px; }
  .chat-dock { height: 44px; padding: 0 6px 0 11px; }
  .leave { height: 44px; padding: 0 13px; }
  /* chat-log는 chat-dock 높이에 맞춰 띄운다 — 52+10 이었으므로 44+10 */
  .chat-log { bottom: 54px; }

  .game-scoreboard { min-width: 140px; padding: 8px 9px; }
}
</style>
