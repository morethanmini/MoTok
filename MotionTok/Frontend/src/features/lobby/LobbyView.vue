<script setup lang="ts">
/** 메인 로비 — 방 목록(공개방·비밀방), 친구, 빠른 메뉴, 방 만들기/코드 참가, 스플래시, BGM. */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import {
  roomsApi,
  friendsApi,
  invitationsApi,
  ApiError,
  type LiveRoomSummary,
  type Friend as ApiFriend,
  type FriendRequestItem,
  type InvitationItem,
  type KickReason,
  type LobbyRoomEvent,
  type Presence,
} from '@/api'
import { useSessionStore } from '@/stores/session'
import { useAsyncData } from '@/composables/useAsyncData'
import { useLobbyLive } from '@/composables/useLobbyLive'
import { motionModelsReady } from '@/composables/motionModels'
import { useWhisper } from '@/composables/useWhisper'
import { useBgm } from '@/composables/useBgm'
import { useToast } from '@/composables/useToast'
import { useUserProfile } from '@/composables/useUserProfile'
import type { Friend, Room } from './data'

import AppHeader from '@/components/common/AppHeader.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import UserProfileModal from '@/components/common/UserProfileModal.vue'
import RoomCard from './components/RoomCard.vue'
import FriendItem from './components/FriendItem.vue'
import InviteCardStack from './components/InviteCardStack.vue'
import FriendRequestCardStack from './components/FriendRequestCardStack.vue'
import { addDismissed, pruneDismissed } from './dismissedRequests'
import LobbySplash from './components/LobbySplash.vue'
import JoinRoomModal from './components/JoinRoomModal.vue'
import CreateRoomModal, { type NewRoom } from './components/CreateRoomModal.vue'
import { containsProfanity } from '@/utils/profanity'
import lobbyCatScene from '@/assets/lobby/lobby-cat-scene.png'
import lobbyBalloon from '@/assets/lobby/lobby-balloon.png'
import lobbyBalloonString from '@/assets/lobby/lobby-balloon-string.png'
import lobbyGardenGrassTile from '@/assets/lobby/lobby-garden-grass-tile.png'
import lobbyHeartBubble from '@/assets/lobby/lobby-heart-bubble.png'
import lobbyCloudA from '@/assets/lobby/lobby-cloud-a.png'
import lobbyCloudB from '@/assets/lobby/lobby-cloud-b.png'
import lobbyRoomListBoard from '@/assets/lobby/lobby-room-list-board.png'
import lobbyEmptyCatTuna from '@/assets/lobby/lobby-empty-cat-tuna.png'
import lobbyEmptyCatToys from '@/assets/lobby/lobby-empty-cat-toys.png'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const bgm = useBgm()
const { message: toast, flash } = useToast()
/** 친구 박스 클릭 → 공개 프로필(-96). 친구·랭킹 화면과 같은 컴포저블. */
const viewer = useUserProfile()

// 스플래시(로딩)는 "모델이 실제로 준비됐는가"로 판정한다(-161). 예전엔 sessionStorage
// 플래그로 세션당 1회만 띄웠는데, 새로고침이면 힙 싱글턴(모델)은 죽고 플래그는 살아남아
// 재다운로드 경로가 영영 사라졌다 — 8인 테스트에서 3명이 게임을 못 돌린 원인.
// 모델이 이미 있으면(SPA 재방문) 안 뜨고, 캐시 복원이면 1초 미만으로 스쳐 지나간다.
const showSplash = ref(!motionModelsReady())
const query = ref('')
const showJoin = ref(false)
const showCreate = ref(false)

const KICK_REASON_LABELS: Record<KickReason, string> = {
  MANNER_VIOLATION: '비매너 행위',
  INAPPROPRIATE_PROFILE: '부적절한 프로필',
  GAME_DISRUPTION: '게임 진행 방해',
  SPAM_AD: '도배·광고',
  OTHER: '기타',
}
function readKickReason(value: unknown): KickReason | null {
  return typeof value === 'string' && value in KICK_REASON_LABELS ? value as KickReason : null
}
const kickedReason = ref<KickReason | null>(readKickReason(route.query.kickedReason))
function closeKickedNotice() {
  kickedReason.value = null
  void router.replace({ query: { ...route.query, kickedReason: undefined } })
}

// 사이드바 친구 목록 (GET /friends, -57). 사진(avatarUrl)이 있으면 그걸 그리고, 없는 친구만
// 이모지로 채운다. 이모지·배경색은 API에 없는 값이라 userId로 팔레트를 골라
// 같은 친구가 항상 같은 아바타로 보이게 한다(매 로드마다 바뀌면 목록이 낯설어진다).
const FACES = ['🐰', '🐻', '🐱', '🦊', '🐨', '🐼', '🐯', '🐥']
const FACE_BGS = ['#ffe2e3', '#d8f4ec', '#fff0b9', '#dce7ff', '#e6e0f0', '#f0e6df', '#ffe6cc', '#e0f0e6']

function toFriend(f: ApiFriend): Friend {
  const slot = Number(f.userId) % FACES.length
  return {
    userId: f.userId,
    name: f.nickname,
    face: FACES[slot] ?? '🐰',
    bg: FACE_BGS[slot] ?? '#ffe2e3',
    avatarUrl: f.avatarUrl ?? null,
    game: presenceLabel(f.presence),
    online: f.presence !== 'OFFLINE',
  }
}

/** 실시간 델타(-149)와 최초 목록이 같은 문구를 쓰도록 한 곳에 둔다. */
function presenceLabel(presence: Presence): string {
  if (presence === 'IN_ROOM') return '게임방에 참가중'
  return presence === 'ONLINE' ? '로비에서 둘러보는 중' : '오프라인'
}

/**
 * userId → 마지막 접속 종료 시각(-179). 목록 뷰모델(data.ts의 Friend)에 얹지 않고 따로 든다 —
 * 그 타입은 로비·친구 화면이 공유하는 표시용 모델이라 서버 시각을 들일 자리가 아니다.
 *
 * <p>실시간 프레즌스 델타(-149)는 이 맵을 갱신하지 않는다. 방금 오프라인이 된 친구는
 * 서버에도 아직 정산 전이라(스윕 60초) 값이 없는 게 맞고, 다음 목록 조회에서 채워진다.</p>
 */
const lastSeenById = ref(new Map<number, string | null>())

const NO_FRIENDS: Friend[] = []
const { data: friends, reload: reloadFriends } = useAsyncData(async () => {
  const list = await friendsApi.list()
  lastSeenById.value = new Map(list.map((f) => [f.userId, f.lastSeenAt ?? null]))
  return list.map(toFriend)
}, NO_FRIENDS)

// 받은 친구 요청 (GET /friends/requests?direction=received, -57)
// 개수 전용 엔드포인트가 명세에 없어서 목록을 받아 길이를 센다(친구 화면 탭 배지와 같은 방식).
// 목록 자체는 팝업 카드에도 쓴다 — 누가 보냈는지 알려면 어차피 필요하다.
const NO_REQUESTS: FriendRequestItem[] = []
const { data: receivedRequests, reload: reloadRequests } = useAsyncData(
  () => friendsApi.requests('received'),
  NO_REQUESTS,
)
const pendingRequests = computed(() => receivedRequests.value.length)

// 받은 방 초대 (GET /invitations, -100)
// 이제 전역 STOMP 개인 큐로 즉시 도착한다(-142). 이 조회는 진입·재연결 시의 스냅샷 역할만 한다 —
// 푸시는 상대가 재연결 중이면 유실되므로 저장(TTL 5m)과 조회를 함께 남긴다.
const NO_INVITATIONS: InvitationItem[] = []
const { data: invitations, reload: reloadInvitations } = useAsyncData(
  () => invitationsApi.received(),
  NO_INVITATIONS,
)

// API LiveRoomSummary → 로비 카드용 Room 매핑
// 목록 응답엔 선택 게임 정보가 없음(selectedGameId 제거). currentPlayers → participantCount.
function toRoom(s: LiveRoomSummary): Room {
  return {
    roomId: s.roomId,
    title: s.title,
    game: '게임 선택 중',
    emoji: '🎮',
    count: s.participantCount,
    max: s.maxPlayers,
    state: s.status === 'WAITING' ? '대기 중' : '게임 중',
    visibility: s.visibility === 'PUBLIC' ? '공개' : '비공개',
    disabled: s.status === 'PLAYING' || s.participantCount >= s.maxPlayers,
    hasPassword: s.hasPassword,
  }
}
// 방 목록 (GET /v1/live-rooms?page=, 페이지당 6개 · 최신순)
// 실패 시 목업 대신 빈 목록을 보여준다 — 가짜 방이 뜨면 입장을 시도하다 실패하고, API 장애를 알아챌 수도 없다.
// hasNext는 응답이 알려주지만, 이전 페이지 여부는 백엔드가 안 알려줘서 page > 1로 프론트에서 직접 판단한다.
/** 서버 페이지 크기와 같아야 한다(-124). 델타로 목록을 기울 때 자르는 기준. */
const PAGE_SIZE = 6
const page = ref(1)
const hasNext = ref(false)
const NO_ROOMS: Room[] = []
const { data: rooms, reload: reloadRooms } = useAsyncData(async () => {
  const res = await roomsApi.list(page.value)
  hasNext.value = res.hasNext
  return res.rooms.map(toRoom)
}, NO_ROOMS)

const hasPrev = computed(() => page.value > 1)
function nextPage() {
  if (!hasNext.value) return
  page.value += 1
  void reloadRooms()
}
function prevPage() {
  if (!hasPrev.value) return
  page.value -= 1
  void reloadRooms()
}
function refreshRooms() {
  page.value = 1
  void reloadRooms()
}

function searchRooms() {
  query.value = query.value.trim()
  page.value = 1
}

const filteredRooms = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rooms.value.filter((r) => !q || r.title.toLowerCase().includes(q))
})

onMounted(() => {
  bgm.setVolume(0.2)
})

function enterLobby() {
  showSplash.value = false
  void bgm.play()
}

// ── 네비게이션 ──────────────────────────────
function goDevice(game: string, room: string) {
  router.push({ name: RouteName.DeviceSetup, query: { game, room } })
}
function requireLogin() {
  if (confirm('멀티플레이는 회원 전용이에요. 로그인 화면으로 이동할까요?')) {
    router.push({ name: RouteName.Auth, query: { mode: 'login' } })
  }
}
function guardMember(action: () => void) {
  if (session.isGuest) requireLogin()
  else action()
}

// ⚡ 빠른 시작 (POST /v1/live-rooms/quick-start) — 서버가 조건에 맞는 방을 랜덤으로 골라 입장.
// 조건에 맞는 방이 없으면 404(QUICK_START_NO_ROOM) → 방 만들기로 유도.
const quickStart = () =>
  guardMember(async () => {
    try {
      const res = await roomsApi.quickStart()
      goDevice('게임 선택 중', res.roomId)
    } catch (e) {
      if (e instanceof ApiError && e.code !== 'QUICK_START_NO_ROOM') return flash(e.message)
      flash('지금은 입장 가능한 방이 없어요. 새 방을 만들어 보세요')
      showCreate.value = true
    }
  })
const openCreate = () => guardMember(() => (showCreate.value = true))
const openJoin = () => guardMember(() => (showJoin.value = true))

// 방 입장 (POST /v1/live-rooms/{roomId}/join)
// 비밀방(hasPassword)은 비밀번호 모달을 먼저 띄운다 — 목록에 비밀방도 노출되므로(2026-07-25 회의)
// 로비에서 바로 입장을 시도하면 서버가 ROOM_PASSWORD_REQUIRED로 거절한다.
// 초대코드 입장(joinRoom)은 비밀번호를 받지 않는다(확정안 ③).
function enterRoom(room: Room) {
  guardMember(async () => {
    if (room.disabled || !room.roomId) return
    if (room.hasPassword) {
      pwTarget.value = room
      pwError.value = ''
      return
    }
    try {
      const res = await roomsApi.join(room.roomId)
      goDevice(room.game, res.roomId)
    } catch (e) {
      // 예전에는 네트워크 오류면 그냥 방으로 보냈다(백엔드 미연동 데모 폴백) — 서버가 모르는
      // 입장이라 "각자 1인방" 같은 유령 상태를 만든다(-164). 실패는 실패로 알린다.
      flash(e instanceof ApiError ? e.message : '방에 입장하지 못했어요 · 잠시 후 다시 시도해 주세요')
    }
  })
}

// 비밀방 비밀번호 입력 — 틀리면 모달을 닫지 않고 에러만 보여줘 재입력할 수 있게 한다.
const pwTarget = ref<Room | null>(null)
const pwError = ref('')
const pwBusy = ref(false)
/**
 * 로비 실시간 갱신 (-148/-149) — 12초 폴링 4종(방 목록·친구·친구요청·초대)을 걷어낸 자리.
 *
 * 폴링은 "남이 바꾸는 데이터"를 따라잡는 유일한 방법이었지만, 응답의 거의 전부가
 * "아무것도 안 바뀜"이었고 부하가 접속자 수에 비례했다. 이제 서버가 바뀐 순간에만 알려 준다.
 *
 * 화면 진입 시의 REST 1회 조회(useAsyncData)는 그대로 남는다 — 실시간 채널은 델타만 주므로
 * 시작점은 여전히 스냅샷이 필요하고, 연결이 끊겼다 붙을 때도 한 번 다시 받아야 한다.
 */
/**
 * 친구 귓속말(-150) — 사이드바 친구 행의 💬 버튼에서 바로 연다.
 * 수신함은 앱 수명(useWhisper)에 있어서, 로비에 없던 동안 온 말도 안 읽음으로 쌓여 있다.
 */
const whisper = useWhisper()
function openWhisper(friend: Friend) {
  if (whisper.openWith.value === friend.userId) {
    whisper.close()
    return
  }
  void whisper.open(friend.userId, friend.name)
}

/** 상호작용 중에 도착한 변화를 쌓아 뒀다가 모달이 닫히면 반영한다. */
const roomsDirty = ref(false)
/** 모달이 열려 있으면 목록이 밀려 방금 본 것과 다른 방을 누르게 된다 — 그게 더 나쁜 경험이다. */
const interacting = computed(
  () => showSplash.value || showJoin.value || showCreate.value || pwTarget.value !== null,
)
/** 델타를 그대로 기워도 되는 건 1페이지·검색 없음일 때뿐(그 밖은 서버가 모르는 상태다). */
const canPatchRooms = computed(() => page.value === 1 && query.value.trim() === '')

watch(interacting, (busy) => {
  if (busy || !roomsDirty.value) return
  roomsDirty.value = false
  void reloadRooms()
})

function applyRoomEvents(events: LobbyRoomEvent[]) {
  if (interacting.value || !canPatchRooms.value) {
    roomsDirty.value = true
    return
  }
  let next = rooms.value
  let shrank = false
  for (const event of events) {
    if (event.type === 'ROOM_CLOSED') {
      const before = next.length
      next = next.filter((r) => r.roomId !== event.roomId)
      shrank ||= next.length < before
      continue
    }
    if (!event.room) continue
    const card = toRoom(event.room)
    const index = next.findIndex((r) => r.roomId === event.roomId)
    if (index >= 0) {
      next = next.map((r, i) => (i === index ? card : r))
    } else if (event.type === 'ROOM_CREATED') {
      next = [card, ...next] // 최신순이라 새 방은 맨 위
    }
  }
  // 한 페이지는 6개다. 방이 닫혀 자리가 비면 다음 방이 올라와야 하는데 그 데이터가 여기 없다.
  if (shrank && next.length < PAGE_SIZE) {
    void reloadRooms()
    return
  }
  rooms.value = next.slice(0, PAGE_SIZE)
}

useLobbyLive({
  onRoomEvents: applyRoomEvents,
  onFriendPresence: ({ userId, presence }) => {
    // 목록 전체를 다시 받지 않고 그 친구 한 명의 상태만 고쳐 그린다.
    const state = presence as Presence
    friends.value = friends.value.map((f) =>
      f.userId === userId
        ? { ...f, game: presenceLabel(state), online: state !== 'OFFLINE' }
        : f,
    )
  },
  onNotification: (notification) => {
    if (notification.type === 'ROOM_INVITATION') {
      const invitation = notification.payload as InvitationItem | null
      if (invitation) invitations.value = [invitation, ...invitations.value]
      return
    }
    // 친구 요청 도착·수락·거절·해제 — 배지와 목록을 함께 맞춘다.
    void Promise.all([reloadRequests(), reloadFriends()])
  },
  onResync: () => {
    // 끊겨 있던 동안의 이벤트는 되돌아오지 않는다. 폴링이 부수적으로 해 주던 "놓친 것 메우기".
    void Promise.all([reloadRooms(), reloadFriends(), reloadRequests(), reloadInvitations()])
  },
})

/**
 * 친구 요청 팝업 (-57).
 *
 * 요청은 수락·거절 전까지 서버에 남아 있어서 그것만 보고 띄우면 로비에 들어올 때마다 같은
 * 카드가 다시 뜬다. 한 번 닫은 요청은 기억해 두고 배지로만 알린다(dismissedRequests).
 */
const dismissedRequestIds = ref<Set<number>>(new Set())
/**
 * 응답을 보내는 중인 요청들 — 같은 요청을 연타로 두 번 보내지 않게.
 *
 * 하나만 담으면 카드 두 장이 떠 있을 때 한 장을 처리하는 동안 다른 장의 클릭이 조용히 먹힌다.
 * 서로 다른 요청이라 동시에 보내도 문제가 없으므로 요청별로 잠근다.
 */
const respondingRequestIds = ref<Set<number>>(new Set())

const popupRequests = computed(() =>
  receivedRequests.value.filter(
    (r) => r.status === 'PENDING' && !dismissedRequestIds.value.has(r.requestId),
  ),
)

// 요청 목록이 바뀔 때마다 죽은 id를 걷어낸다 — 안 그러면 저장소가 계속 자라고,
// 언젠가 같은 번호의 새 요청이 오면 뜨지도 않고 묻힌다.
//
// 내 id도 같이 본다. 저장 키가 사용자별이라 프로필이 없으면 아무것도 못 읽는데, 목록만
// 감시하면 프로필이 목록보다 늦게 온 경우 닫아 둔 기록을 영영 못 불러온다 — 닫은 카드가
// 다시 뜬다. 지금은 라우터 가드가 프로필을 먼저 채우지만 그 순서에 기대지 않는다.
watch(
  [receivedRequests, () => session.profile?.id],
  ([list, me]) => {
    if (me == null) return
    dismissedRequestIds.value = pruneDismissed(
      me,
      list.filter((r) => r.status === 'PENDING').map((r) => r.requestId),
    )
  },
  { immediate: true },
)

function dismissRequest(request: FriendRequestItem) {
  const me = session.profile?.id
  if (me != null) addDismissed(me, request.requestId)
  dismissedRequestIds.value = new Set([...dismissedRequestIds.value, request.requestId])
}

async function respondToRequest(request: FriendRequestItem, action: 'ACCEPT' | 'REJECT') {
  if (respondingRequestIds.value.has(request.requestId)) return
  respondingRequestIds.value = new Set([...respondingRequestIds.value, request.requestId])
  try {
    await friendsApi.respond(request.requestId, action)
    // 서버가 처리했으니 목록에서 사라진다. 수락이면 친구 목록에 새로 들어온다.
    await Promise.all([reloadRequests(), action === 'ACCEPT' ? reloadFriends() : Promise.resolve()])
  } catch (e) {
    // 실패하면 카드를 남긴다 — 조용히 지우면 처리된 줄 알고 넘어간다.
    flash(e instanceof ApiError ? e.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.')
  } finally {
    const next = new Set(respondingRequestIds.value)
    next.delete(request.requestId)
    respondingRequestIds.value = next
  }
}

/**
 * 초대 수락 (-100) — 초대에 실린 초대코드로 기존 입장 흐름을 탄다.
 * 초대받아 들어가는 경로라 비밀방이어도 비밀번호를 묻지 않는다(방 안 사람이 허락한 입장이다).
 *
 * <b>카드는 일회용</b>이다 — 참가든 거절이든 누른 순간 사라진다. 종전에는 입장이 실패하면
 * 카드를 남겨 다시 눌러 볼 수 있게 했는데, 그러면 실패 사유마다 "남길 것/치울 것"을 따져야 하고
 * (방이 사라진 초대는 영영 성공하지 못하면서 계속 남았다) 사용자도 카드가 언제 사라지는지 알 수 없다.
 * 입장이 막혔으면 초대를 다시 받으면 된다 — 방 안에서 다시 부르는 건 한 번의 클릭이다.
 *
 * 입장 요청보다 치우기가 먼저다 — 응답을 기다렸다 지우면 그 사이 카드가 눌린 채 남아 있다.
 * 서버 정리(DELETE)는 기다리지 않는다: 화면에서 사라지는 것이 이 동작의 본체다.
 */
async function acceptInvitation(invitation: InvitationItem) {
  void dismissInvitation(invitation)
  try {
    const { roomId } = await roomsApi.joinByInviteCode(invitation.inviteCode)
    goDevice('친구의 게임', roomId)
  } catch (e) {
    // 카드가 이미 사라졌으므로 "다시 누르면 된다"가 성립하지 않는다 — 다음 행동까지 알려 준다.
    // 강퇴만 예외다: 그 방이 유지되는 동안 어떤 경로로도 막히므로(LiveRoomService.kick)
    // 다시 초대받아도 같은 실패다. 할 수 없는 일을 권하지 않는다.
    const reason = e instanceof ApiError ? e.message : '방에 입장하지 못했어요'
    const kicked = e instanceof ApiError && e.code === 'ROOM_KICKED'
    flash(kicked ? reason : `${reason} · 초대를 다시 받아 주세요`)
  }
}

/** 초대를 서버와 화면에서 치운다. 이미 만료됐으면 404가 나는데, 사라지는 게 목적이라 그대로 둔다. */
async function dismissInvitation(invitation: InvitationItem) {
  invitations.value = invitations.value.filter(
    (i) => i.invitationId !== invitation.invitationId,
  )
  try {
    await invitationsApi.dismiss(invitation.invitationId)
  } catch {
    // 이미 만료·처리된 초대 — 화면에서 지웠으면 됐다
  }
}

async function submitRoomPassword(password: string) {
  const room = pwTarget.value
  if (!room?.roomId || pwBusy.value) return
  if (password.length < 6) {
    pwError.value = '비밀번호 6자리를 입력해 주세요'
    return
  }
  pwBusy.value = true
  try {
    const res = await roomsApi.join(room.roomId, password)
    pwTarget.value = null
    goDevice(room.game, res.roomId)
  } catch (e) {
    pwError.value = e instanceof ApiError ? e.message : '입장에 실패했어요'
  } finally {
    pwBusy.value = false
  }
}

// 코드 참가 (POST /v1/live-rooms/join-by-invite-code)
async function joinRoom(code: string) {
  if (code.length < 6) {
    flash('6자리 방 코드를 입력해 주세요')
    return
  }
  showJoin.value = false
  try {
    const res = await roomsApi.joinByInviteCode(code)
    goDevice('친구의 게임', res.roomId)
  } catch (e) {
    // 초대코드는 roomId가 아니다 — 실패 시 코드로 입장하는 폴백은 없는 방을 그린다(-164)
    flash(e instanceof ApiError ? e.message : '방에 입장하지 못했어요 · 잠시 후 다시 시도해 주세요')
  }
}

// 방 만들기 (POST /v1/live-rooms)
const creating = ref(false)
async function createRoom(payload: NewRoom) {
  if (creating.value) return // 요청 중 중복 제출 방지
  // 빈 제목 검사는 없다 — 모달이 비어 있으면 placeholder에 보여 준 기본 제목으로 채워 보낸다(-175).
  if (containsProfanity(payload.title)) {
    flash('방 제목에 사용할 수 없는 단어가 있어요')
    return
  }
  creating.value = true
  try {
    const res = await roomsApi.create({
      title: payload.title.trim(),
      visibility: payload.visibility === '비밀' ? 'PRIVATE' : 'PUBLIC',
      maxPlayers: Number(payload.max),
      // 모달이 넘겨준 비밀번호를 그대로 전달 — 공개방이면 undefined라 요청에서 빠진다
      // (서버는 PUBLIC + password 조합을 거부한다).
      password: payload.password,
    })
    showCreate.value = false // 성공했을 때만 닫는다 — 실패 시엔 모달을 남겨 재시도할 수 있게
    goDevice('게임 선택 중', res.roomId)
  } catch (e) {
    // 예전에는 실패하면 가짜 roomId로 방에 들어갔다(데모 폴백) — 서버엔 없는 방이라
    // "오프라인인데 방이 만들어지고 둘 다 방장" 같은 유령 상태의 근원이었다(-164).
    flash(e instanceof ApiError ? e.message : '방을 만들지 못했어요 · 잠시 후 다시 시도해 주세요')
  } finally {
    creating.value = false
  }
}

const roomResult = computed(() => `${filteredRooms.value.length}개의 방`)
</script>

<template>
  <div class="shell px-paper-bg">
    <!-- 상단 바 (공용 헤더) -->
    <AppHeader />

    <!-- 본문 -->
    <div class="layout">
      <main class="content">
        <section class="lobby-hero">
          <div>
            <h1 class="hero-title">같이 놀 방을 찾아볼까요?</h1>
          </div>
          <img class="hero-cloud hero-cloud-a pixel-image" :src="lobbyCloudA" alt="" aria-hidden="true" />
          <img class="hero-cloud hero-cloud-b pixel-image" :src="lobbyCloudB" alt="" aria-hidden="true" />
          <div class="hero-grass pixel-image" :style="{ backgroundImage: `url(${lobbyGardenGrassTile})` }" aria-hidden="true" />
          <div class="hero-cat-group">
            <img class="hero-cat-scene pixel-image" :src="lobbyCatScene" alt="풍선을 든 고양이 캐릭터" />
            <img class="hero-balloon-string pixel-image" :src="lobbyBalloonString" alt="" aria-hidden="true" />
            <span class="hero-rope-hook" aria-hidden="true" />
            <img class="hero-balloon pixel-image" :src="lobbyBalloon" alt="둥둥 떠다니는 풍선" />
          </div>
          <img class="hero-heart pixel-image" :src="lobbyHeartBubble" alt="" aria-hidden="true" />
          <div class="hero-actions">
            <PixelButton variant="primary" @click="quickStart">＋ 빠른 입장</PixelButton>
            <PixelButton @click="openJoin">＋ 코드 입장</PixelButton>
          </div>
        </section>

        <div v-if="session.isGuest" class="guest-note">
          👋 게스트는 1인 게임만 가능해요. 멀티플레이 방에 참여하려면 로그인해 주세요.
        </div>

        <div class="section-head">
          <h2 class="room-list-title" :style="{ backgroundImage: `url(${lobbyRoomListBoard})` }">
            <span>방 목록</span>
          </h2>
          <p>{{ roomResult }}</p>
          <div class="room-pager room-pager-inline">
            <button class="pager-btn" :disabled="!hasPrev" @click="prevPage">← 이전</button>
            <span class="pager-page">{{ page }}</span>
            <button class="pager-btn" :disabled="!hasNext" @click="nextPage">다음 →</button>
          </div>
          <label class="room-search">
            ⌕ <input v-model="query" placeholder="방 제목 검색" />
          </label>
          <button class="room-search-btn" type="button" @click="searchRooms">검색</button>
          <PixelButton class="create-room-btn" @click="openCreate">＋ 방 만들기</PixelButton>
          <button class="refresh-btn" @click="refreshRooms">새로고침 ↻</button>
        </div>

        <div class="room-list-wrap">
          <section class="room-list">
            <RoomCard
              v-for="(room, i) in filteredRooms"
              :key="i"
              :room="room"
              @enter="enterRoom(room)"
            />
            <div v-if="filteredRooms.length === 0" class="empty">
              <img class="empty-sign pixel-image" :src="lobbyEmptyCatTuna" alt="" aria-hidden="true" />
              <p>아직 생성된 방이 없어요.</p>
              <span>새 방을 만들어 친구와 함께 놀아보세요!</span>
            </div>
          </section>
        </div>

      </main>

      <aside class="side">
        <section class="side-card friends-card">
          <div class="friends-title-row">
            <div
              class="side-title friend-title"
              :style="{ backgroundImage: `url(${lobbyRoomListBoard})` }"
            >
            친구 목록
            <span v-if="pendingRequests > 0" class="req-badge">요청 {{ pendingRequests }}개</span>
            <button class="side-link" @click="router.push({ name: RouteName.Friends })">친구 목록 관리 →</button>
            </div>
            <button class="side-link" @click="router.push({ name: RouteName.Friends })">친구목록 관리</button>
          </div>
          <div class="friends-list">
            <!-- key는 userId — 접속 상태가 바뀌면 목록 순서가 바뀌는데(온라인 우선 정렬),
                 인덱스를 키로 쓰면 그때마다 <img>가 새로 만들어져 사진을 다시 받는다. -->
            <FriendItem
              v-for="f in friends"
              :key="f.userId"
              :friend="f"
              :unread="whisper.unreadWith(f.userId)"
              :last-seen-at="lastSeenById.get(f.userId)"
              @open="openWhisper(f)"
              @profile="viewer.open(f.userId, f.name)"
            />
            <p v-if="friends.length === 0" class="friends-empty">
              <img class="friends-empty-toys pixel-image" :src="lobbyEmptyCatToys" alt="" aria-hidden="true" />
              아직 친구가 없어요.<br />친구 목록 관리에서 추가해 보세요!
            </p>
          </div>
        </section>

        <section class="side-card notice">
          <div class="side-title">📣 오늘의 소식</div>
          <p><b>주말 더블 포인트!</b><br />게임을 플레이하고 별 코인을 2배로 받아보세요.</p>
        </section>
      </aside>
    </div>

    <!-- 모달 -->
    <JoinRoomModal v-if="showJoin" @close="showJoin = false" @join="joinRoom" />

    <!-- 비밀방 입장 비밀번호 (-68) — 같은 모달을 문구·입력 규칙만 바꿔 재사용 -->
    <JoinRoomModal
      v-if="pwTarget"
      heading="비밀방 입장"
      :desc="`'${pwTarget.title}' 방의 비밀번호 6자리를 입력해 주세요.`"
      placeholder="숫자 6자리"
      submit-label="입장"
      numeric
      :error-text="pwError"
      :busy="pwBusy"
      @close="pwTarget = null"
      @join="submitRoomPassword"
    />
    <CreateRoomModal v-if="showCreate" :busy="creating" @close="showCreate = false" @create="createRoom" />

    <PixelModal v-if="kickedReason" variant="lobby" @close="closeKickedNotice">
      <div class="kick-notice">
        <span class="kick-notice-icon" aria-hidden="true">⚠️</span>
        <p class="kick-notice-kicker">ROOM NOTICE</p>
        <h3>방에서 강퇴되었어요</h3>
        <p class="kick-notice-desc">강퇴 사유: <strong>{{ KICK_REASON_LABELS[kickedReason] }}</strong><br />이 방이 유지되는 동안 다시 입장할 수 없어요.</p>
        <PixelButton class="kick-notice-confirm" block @click="closeKickedNotice">확인</PixelButton>
      </div>
    </PixelModal>

    <!-- 받은 방 초대 (-100) — 모달이 아니라 쌓이는 카드. 배경 조작을 막지 않는다. -->
    <!--
      알림 카드는 한 열에 모아 흘린다. 각 스택이 따로 fixed면 둘 다 같은 자리(top 96px)에서
      시작해 겹친다 — 방 초대와 친구 요청이 동시에 오면 뒤쪽 카드가 통째로 가려졌다.
    -->
    <div class="notice-stacks">
      <InviteCardStack
        :invitations="invitations"
        @accept="acceptInvitation"
        @reject="dismissInvitation"
      />
      <FriendRequestCardStack
        :requests="popupRequests"
        :busy-ids="[...respondingRequestIds]"
        @accept="respondToRequest($event, 'ACCEPT')"
        @reject="respondToRequest($event, 'REJECT')"
        @dismiss="dismissRequest"
      />
    </div>

    <!-- 친구 박스를 누르면 공개 프로필(-96). 친구·랭킹 화면과 같은 모달·같은 조회 규칙을 쓴다. -->
    <UserProfileModal
      v-if="viewer.isOpen.value"
      :user-id="viewer.targetId.value!"
      :profile="viewer.profile.value"
      :nickname="viewer.nickname.value"
      :loading="viewer.loading.value"
      :error="viewer.error.value"
      @close="viewer.close()"
      @reported="flash"
    />

    <PixelToast :message="toast" />

    <!-- 스플래시 -->
    <LobbySplash v-if="showSplash" @enter="enterLobby" />
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.kick-notice { text-align: center; color: #403124; }
.kick-notice-icon { display: grid; place-items: center; width: 54px; height: 54px; margin: 0 auto 12px; border: 3px solid #b78d5d; border-radius: 12px; background: #fff0b9; box-shadow: 3px 3px 0 #e2d0b5; font-size: 26px; }
.kick-notice-kicker { margin: 0 0 7px; color: #9e6b43; font-size: 9px; letter-spacing: 1px; }
.kick-notice h3 { margin: 0 0 10px; font-size: 19px; }
.kick-notice-desc { margin: 0 0 22px; color: #806e5e; font-size: 11px; line-height: 1.6; }
.kick-notice-confirm { height: 46px; border: 3px solid #925c47; border-radius: 7px; background: #ef7775; color: #fff; box-shadow: inset 2px 2px 0 rgba(255, 255, 255, .42), inset -2px -3px 0 rgba(120, 58, 47, .18), 3px 3px 0 #a66b50; font-size: 12px; }
/* 상단 무지개 스트라이프 */
.shell::before {
  content: '';
  position: absolute;
  inset: 78px 0 auto;
  height: 13px;
  z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(90deg, var(--c-yellow) 0 36px, var(--c-coral) 36px 72px, var(--c-mint) 72px 108px, var(--c-blue) 108px 144px);
  opacity: 0.24;
}

/* 떠다니는 스티커 */
.pixel-decor { position: absolute; inset: 78px 0 0; z-index: 1; pointer-events: none; overflow: hidden; }
.d-sticker {
  position: absolute;
  display: grid;
  place-items: center;
  border: var(--border);
  background: #fff;
  box-shadow: var(--shadow-md);
  animation: px-float 3.4s steps(3) infinite;
}
.d-moon { width: 48px; height: 48px; left: 9px; top: 23%; border-radius: 50%; background: #ffd34f; color: #9a6810; font-size: 24px; transform: rotate(-10deg); }
.d-headphone { width: 62px; height: 54px; right: 8px; top: 7%; border-radius: 20px; background: #d9ccfa; color: #6b45bd; font-size: 28px; animation-delay: 0.5s; }
.d-palette { width: 58px; height: 52px; left: 8px; bottom: 5%; border-radius: 50% 50% 46% 54%; background: #efbf79; font-size: 27px; animation-delay: 1s; }
.d-fish { width: 58px; height: 48px; right: 8px; bottom: 8%; border-radius: 50%; background: #cdeaff; font-size: 28px; animation-delay: 1.4s; }
.spark { position: absolute; color: var(--c-yellow); font-size: 20px; text-shadow: 2px 2px 0 var(--c-ink); animation: px-twinkle 1.8s steps(2) infinite; }
.s1 { left: 17px; top: 10%; }
.s2 { right: 24px; top: 36%; color: var(--c-coral); animation-delay: 0.4s; }
.s3 { left: 18px; bottom: 29%; color: var(--c-blue); animation-delay: 0.8s; }

/* 레이아웃 */
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 286px;
  gap: 20px;
  padding: 20px 28px 22px;
  z-index: 2;
}
.content {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 4px 10px 6px;
  margin-left: -6px;
}
/* 방 목록만 내부 스크롤 — 헤더/검색/이전·다음 버튼은 스크롤 없이 항상 보이게 고정 */
/* 그림자(box-shadow)가 컨테이너 경계에 잘리지 않도록 최소 여백 확보 */
.room-list-wrap { flex: 1; min-height: 0; overflow: auto; scrollbar-width: none; padding: 2px 6px 4px 6px; }
.room-list-wrap::-webkit-scrollbar { display: none; }

/* 로비 히어로 배너 */
.lobby-hero {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 18px;
  min-height: 150px;
  margin-bottom: 18px;
  padding: 16px 22px;
  border: var(--border);
  border-radius: 20px;
  background: linear-gradient(110deg, #cff4e7, #fff0b9);
  box-shadow: var(--shadow-lg);
}
.lobby-hero > div:first-child { align-self: flex-start; }
.lobby-hero h1 { margin: 0; font-size: 28px; }
.lobby-hero p { margin: 8px 0 0; color: var(--c-muted); font-size: 13px; }
.lobby-hero .hero-actions { align-self: flex-end; margin: 0 0 0 auto; display: flex; gap: 10px; }

.guest-note {
  flex: none;
  margin-bottom: 12px;
  padding: 10px 13px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff1d2;
  font-size: 10px;
}

.section-head { flex: none; display: flex; align-items: center; margin: 2px 0 2px; }
.section-head h2 { margin: 0; font-size: 22px; }
.section-head p { margin: 0 0 0 9px; font-size: 13px; color: var(--c-muted); }
.create-room-btn { height: 38px; padding: 0 16px; font-size: 14px; border-radius: 11px 11px 8px 11px; margin-left: 10px; }
.room-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 13px;
  background: #fff;
  border: 2px solid var(--c-ink);
  border-radius: 11px;
  box-shadow: 2px 2px 0 #d9cbd9;
  font-size: 25px;
}
.room-search input { width: 240px; border: 0; outline: 0; background: transparent; font-size: 14px; }
.refresh-btn { margin-left: 12px; border: 0; background: transparent; color: var(--c-blue); font-size: 14px; font-weight: 700; }

.room-list { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 7px; }
.empty {
  grid-column: 1 / -1;
  padding: 40px;
  border: 3px dashed #cbbdca;
  border-radius: 18px;
  text-align: center;
  color: var(--c-muted);
  font-size: 11px;
}

.room-pager { flex: none; display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 6px; }
.pager-btn { border: 2px solid var(--c-ink); border-radius: 10px; background: #fff; padding: 8px 14px; font-size: 11px; font-weight: 700; box-shadow: var(--shadow-sm); }
.pager-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
.pager-page { min-width: 20px; text-align: center; font-size: 12px; font-weight: 700; color: var(--c-muted); }

/* 사이드 */
.side { min-height: 0; display: flex; flex-direction: column; gap: 14px; }
.side-card { border: var(--border); border-radius: 19px 19px 14px 19px; background: #fff; box-shadow: var(--shadow-lg); padding: 17px; }
.friends-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}
.friends-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 12px;
  margin-right: -12px;
  scrollbar-width: thin;
  scrollbar-color: var(--c-mint) #f3ecf3;
}
.friends-empty { margin: 24px 4px; font-size: 14px; line-height: 1.8; color: #7e6856; text-align: center; }
.friends-empty-toys { display: block; width: 104px; height: auto; margin: 0 auto 13px; }
.friends-list::-webkit-scrollbar { width: 10px; }
.friends-list::-webkit-scrollbar-button,
.friends-list::-webkit-scrollbar-button:start:decrement,
.friends-list::-webkit-scrollbar-button:end:increment,
.friends-list::-webkit-scrollbar-button:vertical:start,
.friends-list::-webkit-scrollbar-button:vertical:end {
  display: none;
  height: 0;
  width: 0;
  -webkit-appearance: none;
}
.friends-list::-webkit-scrollbar-track { background: #f3ecf3; border-left: 2px solid var(--c-ink); }
.friends-list::-webkit-scrollbar-thumb { background: var(--c-mint); border: 2px solid var(--c-ink); border-radius: 0; }
.friends-list::-webkit-scrollbar-thumb:hover { background: var(--c-yellow); }
.side-title { display: flex; align-items: center; font-size: 13px; font-weight: 700; margin-bottom: 13px; }
.side-title span { margin-left: auto; font-size: 9px; color: var(--c-mint); }
/* 받은 친구 요청 배지 — 위 span 규칙의 margin-left:auto가 '친구 목록 관리' 링크와 여백을 나눠 갖지 않도록 덮어쓴다 */
.side-title .req-badge {
  margin-left: 7px;
  padding: 2px 6px;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-yellow);
  color: var(--c-ink);
  font-size: 8px;
  font-weight: 700;
}
.side-link { margin-left: auto; border: 0; background: transparent; color: var(--c-blue); font-size: 9px; font-weight: 700; }
.quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick button { height: 62px; border: 2px solid var(--c-ink); border-radius: var(--radius-md); background: var(--c-yellow); font-size: 11px; font-weight: 700; box-shadow: var(--shadow-sm); }
.quick button:last-child { background: var(--c-mint-soft); }
.notice { background: #fff7d9; }
.notice p { font-size: 10px; line-height: 1.65; color: #66586a; margin: 0; }
.notice b { color: var(--c-coral); }

@media (max-width: 1260px) {
  .layout { grid-template-columns: minmax(0, 1fr) 260px; }
}

/* Reference-inspired sunny pixel lobby skin. Scoped to the lobby so other screens retain their tokens. */
.lobby-page {
  --lobby-bg: #fffaf0;
  --lobby-surface: #fffdf7;
  --lobby-border: #d9b77f;
  --lobby-text: #34251f;
  --lobby-muted: #8c7966;
  --lobby-yellow: #ffd976;
  --lobby-coral: #ef7775;
  --lobby-blue: #4f86d9;
  --lobby-green: #a8c979;
  --lobby-sky: #bfe9ff;
  color: var(--lobby-text);
  background-color: var(--lobby-bg);
  background-image:
    linear-gradient(0deg, rgba(204, 169, 115, .11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(204, 169, 115, .08) 1px, transparent 1px);
  background-size: 16px 16px;
}
.shell::before { height: 5px; background: #bd6d45; opacity: 1; }
.layout { max-width: 1640px; width: 100%; box-sizing: border-box; margin: 0 auto; gap: 26px; padding: 32px 46px 26px; }
.content { padding: 0; margin: 0; }
.lobby-hero {
  position: relative;
  isolation: isolate;
  min-height: 228px;
  overflow: hidden;
  padding: 34px 46px;
  border: 3px solid var(--lobby-border);
  border-radius: 19px;
  box-shadow: 5px 5px 0 #d9c6a5;
  background: #bfe9ff;
}
.lobby-hero::before {
  content: none;
  position: absolute;
  z-index: 1;
  inset: auto 0 0;
  height: 27px;
  border-top: 3px solid #5b8d45;
  background:
    repeating-linear-gradient(90deg, transparent 0 5px, #5e9f49 5px 8px, transparent 8px 13px) 0 0 / 100% 10px,
    repeating-linear-gradient(90deg, #9ad269 0 12px, #77b959 12px 22px, #b8df7a 22px 28px) 0 8px / 100% 13px,
    repeating-linear-gradient(90deg, #bc8454 0 18px, #d6a469 18px 35px) 0 21px / 100% 8px;
  pointer-events: none;
}
.lobby-hero::after {
  content: none;
  position: absolute;
  right: 30%; bottom: 13px;
  width: 70px; height: 70px;
  display: grid; place-items: center;
  border: 3px solid #9e6b43;
  border-radius: 35% 35% 28% 28%;
  background: #ffc578;
  font-size: 43px;
  image-rendering: pixelated;
  box-shadow: 5px 5px 0 rgba(111, 74, 48, .2);
}
.lobby-hero > div:first-child { max-width: 49%; z-index: 2; }
.hero-cloud {
  position: absolute;
  z-index: 0;
  width: 150px;
  height: auto;
  opacity: .62;
  pointer-events: none;
  animation: hero-cloud-drift 19s ease-in-out infinite;
}
.hero-cloud-a { top: 15px; left: 43%; }
.hero-cloud-b {
  top: 56px;
  left: 63%;
  width: 125px;
  opacity: .48;
  animation-duration: 25s;
  animation-delay: -9s;
  animation-direction: reverse;
}
@keyframes hero-cloud-drift {
  0%, 100% { transform: translate(-10px, 0); }
  50% { transform: translate(15px, -4px); }
}
.hero-grass {
  position: absolute;
  z-index: 4;
  inset: auto 0 -9px;
  width: 100%;
  height: 58px;
  background-repeat: repeat-x;
  background-size: auto 58px;
  background-position: left bottom;
  pointer-events: none;
}
.hero-cat-group {
  position: absolute;
  z-index: 2;
  right: 28%;
  bottom: -2px;
  width: 145px;
  height: 145px;
  pointer-events: none;
}
.hero-cat-scene { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.hero-balloon {
  position: absolute;
  z-index: 4;
  left: -8px;
  bottom: 139px;
  width: 60px;
  height: auto;
  transform-origin: bottom center;
  animation: hero-balloon-float 3.2s ease-in-out infinite;
}
.hero-balloon-string {
  position: absolute;
  z-index: 3;
  left: 14px;
  bottom: 53px;
  width: 17px;
  height: 97px;
  object-fit: fill;
  object-position: top center;
  pointer-events: none;
}
.hero-rope-hook {
  position: absolute;
  z-index: 3;
  left: 27px;
  bottom: 53px;
  width: 27px;
  height: 9px;
  border-bottom: 3px solid #837462;
  border-radius: 0 0 0 7px;
  transform: rotate(-7deg);
  transform-origin: left center;
  pointer-events: none;
}
@keyframes hero-balloon-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.hero-heart {
  position: absolute;
  z-index: 2;
  right: calc(28% - 24px);
  bottom: 112px;
  width: 60px;
  height: auto;
  pointer-events: none;
}
.pixel-image { image-rendering: pixelated; image-rendering: crisp-edges; }
.lobby-hero .hero-title {
  color: var(--lobby-text);
  font-family: var(--font-pixel);
  font-size: 42px;
  font-weight: normal;
  letter-spacing: -1px;
  white-space: nowrap;
  text-shadow: 2px 2px 0 #ead7b8;
}
.lobby-hero h1::after { content: none; }
.lobby-hero p { max-width: 620px; color: #594941; font-size: 14px; line-height: 1.75; }
.lobby-hero .hero-actions { z-index: 3; flex-direction: column; align-self: center; margin-left: auto; }
.lobby-hero .hero-actions :deep(.px-btn) {
  min-width: 224px;
  height: 62px;
  justify-content: center;
  padding-left: 0;
  border: 3px solid #925c47;
  border-radius: 7px;
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.25), 5px 5px 0 #a66b50;
  color: #fff;
  font-size: 19px;
  font-weight: 400;
  letter-spacing: 0;
}
.lobby-hero .hero-actions :deep(.v-primary) { background: #ef6d70; }
.lobby-hero .hero-actions :deep(.v-secondary) { background: #4078cf; }
.guest-note { border-color: var(--lobby-border); background: #fff0b9; color: #73583e; }
.section-head { min-height: 70px; padding: 0 8px; }
.section-head .room-list-title {
  display: grid;
  width: 145px;
  height: 49px;
  padding: 0 13px 1px 6px;
  place-items: center;
  border: 0;
  border-radius: 0;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  box-shadow: none;
  color: #32231b;
  font-size: 18px;
  line-height: 1;
  text-shadow: 1px 1px 0 rgba(255, 237, 191, .65);
}
.room-list-title span { transform: translateX(4px); }
.section-head p { color: var(--lobby-muted); }
.room-search {
  border: 0;
  border-bottom: 2px solid #d9b77f;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.room-search input { color: var(--lobby-text); }
.room-search-btn {
  height: 34px;
  padding: 0 12px;
  border: 2px solid #b78d5d;
  border-radius: 7px;
  background: #fff7e5;
  box-shadow: 2px 2px 0 #e4cfad;
  color: #4b372b;
  font-size: 12px;
}
.create-room-btn {
  min-width: 148px;
  height: 43px;
  border: 3px solid #925c47 !important;
  border-radius: 7px !important;
  background: #e7c996 !important;
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.42), inset -2px -3px 0 rgba(120,58,47,.18), 4px 4px 0 #a66b50 !important;
  color: #34251f !important;
  font-size: 14px;
}
.refresh-btn { color: #69513e; }
/*
 * 알림 카드 한 열 — 방 초대·친구 요청이 같이 와도 겹치지 않게 위에서부터 쌓는다.
 * 각 스택은 혼자서도 쓸 수 있게 자기 fixed 좌표를 들고 있으므로, 묶을 때만 여기서 푼다.
 */
.notice-stacks {
  position: fixed;
  top: 96px;
  right: 20px;
  z-index: 250;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 236px;
  /* 카드가 없는 빈 자리가 뒤쪽 클릭을 먹지 않게 */
  pointer-events: none;
}
.notice-stacks :deep(.invite-stack),
.notice-stacks :deep(.req-stack) {
  position: static;
  width: 100%;
  z-index: auto;
}
.notice-stacks :deep(.invite-card),
.notice-stacks :deep(.req-card) { pointer-events: auto; }
/*
 * 헤더 한 줄 유지 — 좁아지면 글자가 접히는 대신 검색창만 줄어든다.
 * flex-wrap은 원래 nowrap이라 줄이 바뀌는 게 아니라, 버튼들이 같이 찌그러지며 그 안의
 * 글자가 접혔다("방 만들기"·"새로고침"·"n개의 방"). 그래서 나머지는 flex:none으로 고정하고
 * 검색창 하나만 줄어들 수 있게 남긴다.
 */
.section-head > * { flex: none; white-space: nowrap; }
.section-head > .room-search { flex: 0 1 auto; min-width: 0; }
/* 미디어 쿼리가 정한 input width는 '선호 크기'로 남기고, 모자라면 그 아래로 줄어들게 한다 */
.section-head .room-search input { min-width: 0; }
.room-list-title span,
.room-pager-inline .pager-btn { white-space: nowrap; }
.room-list-wrap { padding: 10px; border: 2px dashed #dfc9a6; border-radius: 18px; background: rgba(255, 253, 247, .65); }
.room-list { gap: 13px; }
.empty { min-height: 170px; display: grid; place-content: center; gap: 10px; border-color: #dfc9a6; background: #fffdf8; color: var(--lobby-muted); }
.empty::before { content: '↔'; justify-self: center; display: grid; place-items: center; width: 48px; height: 35px; border: 3px solid #a97b51; border-radius: 8px; background: #d8b184; color: #fff7df; font-size: 28px; }
.room-pager { margin: 16px 0 0; }
.room-list-wrap { min-height: 260px; }
.empty {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #75624f;
  font-size: 17px;
  transform: translateY(60px);
}
.empty::before { content: none; }
.empty-sign { width: 106px; height: auto; margin-bottom: 4px; }
.empty p { margin: 0; line-height: 1.25; }
.empty span { color: #8b7965; font-size: 14px; }
.room-pager { margin: 18px 0 0; }
.room-pager-inline { margin: 0 12px 0 10px; gap: 7px; }
.room-pager-inline .pager-btn { padding: 5px 8px; font-size: 10px; }
.room-pager-inline .pager-page { min-width: 13px; font-size: 11px; }
.pager-btn { border-color: var(--lobby-border); box-shadow: 2px 2px 0 #e2d0b5; color: #735f4c; }
.side { gap: 20px; }
.side-card { border: 3px solid var(--lobby-border); border-radius: 16px; box-shadow: 4px 4px 0 #dfcdb0; background: var(--lobby-surface); }
.side-title { margin: -17px -17px 14px; padding: 12px 15px; border-bottom: 2px solid #ead9bd; background: #d7e7ad; color: #403124; font-size: 16px; }
.friends-card { position: relative; padding: 14px; border: 0; background: transparent; box-shadow: none; }
.friends-title-row {
  position: static;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: -14px -14px 14px;
}
.friends-card .friend-title {
  position: relative;
  flex: 0 0 145px;
  width: 145px;
  min-height: 49px;
  box-sizing: border-box;
  margin: 0 auto;
  transform: translate(-71px, 8px);
  padding: 11px 14px;
  justify-content: center;
  text-align: center;
  font-size: 18px;
  border: 0;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  box-shadow: none;
  clip-path: none;
}
.friends-card .req-badge { display: none; }
.friends-card .friend-title .side-link { display: none; }
.friends-card .side-link { position: absolute; top: 34px; right: 14px; margin: 0; color: #72583d; font-size: 13px; }
.friends-title-row:has(.req-badge) > .side-link::before {
  content: '새로운 친구 요청 !';
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  width: max-content;
  color: #b8704f;
  font-size: 9px;
  font-weight: 700;
}
.friends-title-row > .side-link::after { content: ' →'; }
.friends-list {
  padding: 4px 8px;
  margin-left: -15px;
  margin-bottom: -14px;
  border: 2px dashed #dfc9a6;
  border-radius: 12px;
  background: rgba(255, 253, 247, .65);
}
.friends-list:has(.friends-empty) {
  display: flex;
  align-items: center;
  justify-content: center;
}
.friends-list .friends-empty {
  width: 100%;
  margin: auto 4px;
}
.side-link { color: #7b5d3d; }
.notice { flex: none; min-height: 148px; background: #fffdf7; }
.notice { display: none; }
.notice .side-title { background: #ffe294; }
.notice .side-title::after { content: 'NEW'; margin-left: auto; padding: 4px 6px; border-radius: 4px; background: #e77491; color: #fff; font-size: 8px; font-style: normal; }
.notice p { position: relative; padding-right: 38px; color: #67594d; font-size: 12px; }
.notice b { color: #db6673; font-size: 16px; }
.notice p::after { content: '🎁'; position: absolute; right: 0; bottom: -6px; font-size: 36px; }

@media (min-width: 921px) and (max-width: 1260px) {
  .layout { gap: 24px; padding: 28px 34px; }
  .lobby-hero { min-height: 218px; padding: 30px 38px; }
  .lobby-hero .hero-title { font-size: clamp(30px, 3vw, 37px); }
  .lobby-hero .hero-actions :deep(.px-btn) { min-width: 185px; height: 52px; font-size: 16px; }
  .section-head { min-height: 64px; }
  .section-head .room-list-title { width: 140px; height: 48px; font-size: 18px; }
  .room-search input { width: 190px; }
  .create-room-btn { min-width: 140px; height: 42px; font-size: 14px; }
  .room-search, .room-search-btn { height: 36px; }
  .friends-card .friend-title { transform: translate(-64px, 6px); }
  .friends-card .side-link { top: 29px; font-size: 12px; }
}

/* A 1920px-wide screen becomes about 1536px at 125% zoom. */
@media (min-width: 1261px) and (max-width: 1600px) {
  .layout { gap: 28px; padding: 34px 42px 30px; }
  .lobby-hero { min-height: 238px; padding: 36px 44px; }
  .lobby-hero .hero-title { font-size: clamp(32px, 2.65vw, 42px); }
  .lobby-hero .hero-actions :deep(.px-btn) { min-width: 180px; height: 52px; font-size: 16px; }
  .section-head { min-height: 72px; }
  .section-head .room-list-title { width: 150px; height: 51px; font-size: 18px; }
  .room-search input { width: 250px; }
  .create-room-btn { min-width: 148px; height: 43px; font-size: 14px; }
}

/* Enlarge only at common 90% browser scale factors. */
@media (min-resolution: .89dppx) and (max-resolution: .91dppx),
       (min-resolution: 1.115dppx) and (max-resolution: 1.135dppx),
       (min-resolution: 1.34dppx) and (max-resolution: 1.36dppx),
       (min-resolution: 1.565dppx) and (max-resolution: 1.585dppx),
       (min-resolution: 1.79dppx) and (max-resolution: 1.81dppx) {
  .lobby-hero .hero-actions :deep(.px-btn) { min-width: 228px; height: 60px; font-size: 18px; }
}

@media (min-width: 921px) and (max-height: 800px) {
  .layout { padding-top: 20px; padding-bottom: 18px; }
  .lobby-hero { min-height: 182px; padding-top: 22px; padding-bottom: 22px; margin-bottom: 12px; }
  .lobby-hero .hero-actions :deep(.px-btn) { height: 48px; }
  .section-head { min-height: 56px; }
  .room-list-wrap { padding-top: 6px; }
}

@media (max-width: 920px) {
  .shell { height: auto; min-height: 100vh; overflow: visible; }
  .layout { grid-template-columns: 1fr; padding: 22px 18px 30px; }
  .side { display: grid; grid-template-columns: 1fr 1fr; }
  .friends-card { min-height: 240px; }
  .lobby-hero > div:first-child { max-width: 52%; }
  .hero-cat-group { right: 27%; }
}

/* This is the common desktop width at roughly 150% browser zoom. */
@media (min-width: 641px) and (max-width: 920px) {
  .lobby-hero { min-height: 198px; padding: 24px 28px; }
  .lobby-hero .hero-title { font-size: 31px; }
  .lobby-hero .hero-actions :deep(.px-btn) { min-width: 138px; height: 43px; font-size: 13px; }
}
@media (max-width: 640px) {
  .layout { padding: 16px 12px 24px; }
  .lobby-hero { min-height: 300px; padding: 23px; }
  .lobby-hero > div:first-child { max-width: 100%; }
  .lobby-hero .hero-actions { position: absolute; bottom: 20px; left: 23px; flex-direction: row; }
  .lobby-hero .hero-actions :deep(.px-btn) { min-width: 0; height: 43px; padding: 0 12px; font-size: 11px; }
  .hero-grass { inset: auto 0 -7px; height: 45px; background-size: auto 45px; }
  .hero-cat-group { right: 12%; bottom: -3px; width: 118px; height: 118px; }
  .hero-balloon { left: -4px; bottom: 113px; width: 45px; }
  .hero-balloon-string { left: 12px; bottom: 42px; width: 14px; height: 85px; }
  .hero-rope-hook { left: 22px; bottom: 42px; width: 21px; height: 7px; border-bottom-width: 2px; }
  .hero-heart { right: calc(12% - 16px); bottom: 126px; width: 48px; }
  .hero-cloud-a { top: 10px; left: 42%; width: 105px; }
  .hero-cloud-b { top: 48px; left: 64%; width: 88px; }
  .section-head { flex-wrap: wrap; gap: 10px; padding: 8px 0; }
  .section-head .room-list-title { width: 123px; height: 42px; padding: 0 11px 1px 5px; font-size: 18px; }
  .room-pager-inline { margin: 0; }
  .room-search { order: 3; width: 100%; margin-left: 0; }
  .room-search input { width: 100%; }
  .room-search-btn { order: 4; }
  .create-room-btn { min-width: 135px; height: 43px; margin-left: 0; font-size: 13px; }
  .room-list { grid-template-columns: 1fr; }
  .side { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-balloon, .hero-cloud { animation: none; }
}
</style>
