/**
 * API 명세(모톡_API_명세서.md §14) REST 데이터 스키마의 TypeScript 타입.
 * 백엔드 응답/요청 계약이므로 명세 변경 시 이 파일을 동기화하세요.
 */

// ── 공통 ──────────────────────────────────
export interface ApiError {
  code: string
  message: string
  path?: string
  timestamp?: string
}
export interface PageMeta {
  page: number
  size: number
  totalElements: number
  totalPages: number
}

// ── 인증 ──────────────────────────────────
export interface TokenResponse {
  tokenType: string
  accessToken: string
  /** refreshToken은 본문에 없다 — 서버가 HttpOnly 쿠키(Path=/api/auth)로 심는다. */
  expiresIn?: number
  user?: UserProfile
  /** 소셜 최초 로그인 — true면 닉네임 설정 화면으로 보내야 한다 (-22) */
  nicknameSetupRequired?: boolean
}
export interface SignupRequest {
  email: string
  password: string
  nickname: string
}
export interface LoginRequest {
  email: string
  password: string
  rememberMe?: boolean
}
export interface SocialLoginRequest {
  authorizationCode: string
  redirectUri?: string
}
export type SocialProvider = 'google' | 'kakao' | 'naver'
export interface GuestResponse {
  accessToken: string
  guestNickname: string
  roomId: string
}
export interface Availability {
  available: boolean
}
export interface FindIdResponse {
  maskedEmail: string
}

// ── 회원 ──────────────────────────────────
export type Role = 'USER' | 'ADMIN'
export interface UserProfile {
  id: number
  email: string | null
  nickname: string
  role: Role
  pointBalance: number
  createdAt: string
  /** true면 nickname이 임시값이라 닉네임 설정을 마쳐야 한다 (-22) */
  nicknamePending?: boolean
  /** 비밀번호가 없는 소셜 전용 계정 — 비밀번호 변경 불가, 탈퇴 시 소셜 재인증 필요 (-111) */
  socialOnly?: boolean
  /** 프로필 사진 URL. null이면 기본 아바타를 그린다. */
  avatarUrl?: string | null
}

/** 업로드 용도. 서버 UploadPurpose enum과 값이 일치해야 한다. */
export type UploadPurpose = 'AVATAR' | 'AI_ITEM' | 'SONG'

/** POST /uploads/presign 요청 — key·파일명은 보내지 않는다(서버가 정한다). */
export interface PresignUploadRequest {
  purpose: UploadPurpose
  contentType: string
  contentLength: number
}

/**
 * POST /uploads/presign 응답.
 *
 * requiredHeaders는 반드시 그대로 PUT에 실어야 한다 — 서명에 포함된 헤더라
 * 하나라도 빠지거나 다르면 S3가 SignatureDoesNotMatch로 거부한다.
 * 프론트에 상수로 박지 않고 서버가 내려주는 이유는 SDK 버전에 따라 서명 대상이 달라질 수 있어서다.
 */
export interface PresignUploadResponse {
  uploadUrl: string
  key: string
  /** 업로드 성공 시 갖게 될 주소. 낙관적 프리뷰용이고, DB에 남는 값은 서버가 다시 계산한다. */
  publicUrl: string
  expiresInSeconds: number
  requiredHeaders: Record<string, string>
}

/** GET /users/{userId} — 랭킹 등에서 보는 다른 사용자의 공개 프로필 (-96) */
export interface PublicUserProfile {
  id: number
  nickname: string
  createdAt: string
  /** 프로필 사진 URL. 공개 정보라 랭킹 등에서 함께 보여준다. null이면 기본 아바타 */
  avatarUrl?: string | null
  /** 총 접속시간(초, -141 친구 상세). 집계 시작(배포) 이전 접속은 포함하지 않는다 */
  totalConnectSeconds: number
}

/**
 * DELETE /users/me 본인 확인 (-111).
 * 자체 가입 계정은 password, 소셜 전용 계정은 소셜 재인증 값을 보낸다.
 */
export interface WithdrawRequest {
  password?: string
  provider?: SocialProvider
  authorizationCode?: string
  redirectUri?: string
}
/** AI_GENERATE_REFUND는 AI 아이템 생성 실패 시의 환급이라 항상 양수다(차감인 AI_GENERATE와 반대 방향). */
export type PointType =
  | 'GAME_REWARD'
  | 'SHOP_PURCHASE'
  | 'AI_GENERATE'
  | 'GUEST_MIGRATE'
  | 'AI_GENERATE_REFUND'
export interface PointHistory {
  id: number
  amount: number
  type: PointType
  balanceAfter: number
  refId?: number
  createdAt: string
}
export interface PointHistoryPage {
  content: PointHistory[]
  page: PageMeta
}
/** 게임 전적 (명세의 Record 스키마 — TS 내장 Record<> 와 충돌 피하려 GameRecord로 명명) */
export interface GameRecord {
  gameId: number
  gameName: string
  /** SOLO | MULTI — 리더보드(-96)와 같은 구분. 같은 게임이라도 모드별로 행이 따로 온다 */
  mode?: LeaderboardMode
  playCount: number
  bestScore: number
  rankNo: number
}
/**
 * 화면 꾸미기 설정 (GET·PUT /users/me/decoration).
 * x·y는 영상 기준 정규화 좌표(0~1, 스티커 중심), scale은 영상 짧은 변 대비 비율이다.
 * 픽셀이 아니라 비율인 이유 — 편집 화면과 게임 타일의 크기가 달라서 픽셀로 저장하면 위치가 어긋난다.
 */
export type DecorAnchor = 'FIXED' | 'FACE' | 'HAND'
export interface DecorPlacement {
  itemId: number
  /** FIXED만 구현 — FACE·HAND(가면·효과 추적)는 추적기가 붙을 때 사용 */
  anchor: DecorAnchor
  x: number
  y: number
  scale: number
}
export interface DecorConfig {
  version: number
  items: DecorPlacement[]
}
export interface DecorationConfig {
  config: DecorConfig
  updatedAt?: string | null
}

// ── 상점/아이템 ───────────────────────────
export type ItemCategory = 'MASK' | 'EFFECT' | 'STICKER' | 'BACKGROUND'
export type ItemType = 'SHOP' | 'AI_CUSTOM'
export interface Item {
  id: number
  name: string
  category: ItemCategory
  itemType: ItemType
  pricePoint: number | null
  imageUrl: string
  owned: boolean
}
export interface InventoryItem {
  itemId: number
  name: string
  category: ItemCategory
  imageUrl: string
  equipped: boolean
  acquiredAt: string
}
export interface PurchaseResponse {
  itemId: number
  balanceAfter: number
}
export interface AiItemRequest {
  name: string
  category: ItemCategory
  sketchBase64: string
  /** 재생성 요청이면 최초 결제 job의 id. 없으면 서버가 새 결제(포인트 차감)로 처리한다. */
  parentJobId?: number
}
export type AiItemJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
export interface AiItemJobResponse {
  jobId: number
  status: AiItemJobStatus
}
export interface AiItemJobStatusResponse {
  jobId: number
  status: AiItemJobStatus
  itemId: number | null
  imageUrl: string | null
  errorMessage: string | null
}
/** POST /shop/ai-items/{jobId}/save 응답 — 이 호출로만 인벤토리에 지급된다("생성 → 확인 → 저장"). */
export interface AiItemSaveResponse {
  itemId: number
  imageUrl: string
}

// ── 라이브룸 (구 rooms → live-rooms, 명세 §4) ──────
export type Visibility = 'PUBLIC' | 'PRIVATE'
// 백엔드 status는 String. 생성 시 WAITING, 게임 시작 시 PLAYING.
// (오래 'IN_GAME'으로 적혀 있었는데 서버가 쓰는 값은 'PLAYING'이라 게임 중 방의 입장 차단이
//  한 번도 동작하지 않았다 — 라벨 분기가 우연히 맞아떨어져 눈에 띄지 않던 버그. 로비 실시간
//  계약을 새로 정하는 -148에서 서버 값 기준으로 통일했다.)
export type RoomStatus = 'WAITING' | 'PLAYING'

/** GET /v1/live-rooms 목록 항목 (LiveRoomSummaryResponse) */
export interface LiveRoomSummary {
  roomId: string
  title: string
  visibility: Visibility
  maxPlayers: number
  participantCount: number
  status: RoomStatus
  hasPassword: boolean
}

/** GET /v1/live-rooms?page= 응답 — 페이지당 6개 고정, page는 1부터 시작 */
export interface LiveRoomListResponse {
  rooms: LiveRoomSummary[]
  hasNext: boolean
}

/**
 * 상세/입장 응답의 참가자 (LiveRoomDetailResponse.MemberView).
 * 기존 Participant의 카메라·마이크·연결상태는 시그널링 계층으로 이동 예정(아직 미구현).
 */
export interface LiveRoomMember {
  userId: string
  displayName: string
  guest: boolean
}

/** GET /v1/live-rooms/{id}, POST .../join, POST .../join-by-invite-code 공통 응답 (LiveRoomDetailResponse) */
export interface LiveRoomDetail {
  roomId: string
  title: string
  visibility: Visibility
  maxPlayers: number
  participantCount: number
  status: RoomStatus
  hostUserId: string
  inviteCode: string | null
  members: LiveRoomMember[]
}

/** POST /v1/live-rooms 요청 (CreateLiveRoomRequest). PRIVATE이면 password(숫자 6자리) 필수, PUBLIC이면 생략 */
export interface CreateLiveRoomRequest {
  title: string
  visibility: Visibility
  maxPlayers: number
  password?: string
}

/** POST /v1/live-rooms 응답 (CreateLiveRoomResponse) */
export interface CreateLiveRoomResponse {
  roomId: string
  title: string
  visibility: Visibility
  maxPlayers: number
  status: RoomStatus
  hostUserId: string
  createdAt: number
  inviteCode: string | null
}

/**
 * PATCH /v1/live-rooms/{id} 요청 (UpdateLiveRoomRequest, -130).
 * 명세 §4 "CreateLiveRoomRequest와 동일 규격" — 부분수정이 아니라 전체 상태 재전송이므로
 * 제목만 바꿔도 4필드를 다 보낸다. PRIVATE이면 password 필수(서버가 비번을 반환하지 않아 재입력).
 */
export type UpdateLiveRoomRequest = CreateLiveRoomRequest

/** GET /v1/live-rooms/{id}/password 응답 (LiveRoomPasswordResponse, -130). 공개방은 null */
export interface LiveRoomPasswordResponse {
  password: string | null
}

/**
 * /topic/rooms/{roomId}/members 로 오는 방 정보 수정 알림 (LiveRoomUpdatedEvent, -130).
 * 방 전원에게 쏘는 채널이라 password는 실려오지 않는다.
 */
export interface LiveRoomUpdatedEvent {
  title: string
  visibility: Visibility
  maxPlayers: number
}

/**
 * /topic/rooms/{roomId}/members 로 오는 방장 변경 알림 (LiveRoomHostChangedEvent, -72).
 * 방장이 나가면 서버가 남은 참가자 중 가장 먼저 들어온 사람에게 위임하고 이 이벤트를 쏜다.
 *
 * 이 토픽에는 판별용 type 필드가 없어 필드 모양으로 가른다 — hostUserId를 갖는 건 이 이벤트뿐이다
 * (퇴장·강퇴는 userId/participantCount 계열, 방 정보 수정은 title/maxPlayers).
 */
export interface LiveRoomHostChangedEvent {
  hostUserId: string
  hostDisplayName: string
}

/**
 * /topic/rooms/{roomId}/members 로 오는 퇴장·강퇴 알림.
 * type 필드가 없어 userId와 participantCount 조합으로 식별한다.
 * 대상 본인은 이 이벤트를 받으면 즉시 방 연결을 정리하고 로비로 이동해야 한다.
 */
export interface LiveRoomMemberRemovedEvent {
  userId: string
  participantCount: number
}

/** /topic/rooms/{roomId}/members 로 오는 강퇴 알림(-73). */
export interface LiveRoomMemberKickedEvent extends LiveRoomMemberRemovedEvent {
  displayName: string
  reason: 'MANNER_VIOLATION' | 'INAPPROPRIATE_PROFILE' | 'GAME_DISRUPTION' | 'SPAM_AD' | 'OTHER'
}

/** POST /v1/live-rooms/{id}/join 요청 (JoinLiveRoomRequest). 비공개방(hasPassword)이면 password 필요 */
export interface JoinLiveRoomRequest {
  password?: string
}

// ── 게임 ──────────────────────────────────
export type GameMode = 'SOLO' | 'VERSUS' | 'COOP'
export interface Game {
  id: number
  name: string
  description: string
  mode: GameMode
  minPlayers: number
  maxPlayers: number
  supportsBot: boolean
  category: string
  thumbnailUrl: string
  /**
   * 지금 이 게임을 시작할 수 있나 — `active`이고 playerCount 조건도 맞을 때만 true.
   * (playerCount 쿼리를 안 보내면 인원 조건은 보지 않는다)
   */
  playable: boolean
  /**
   * 관리자가 열어 둔 게임인가(games.is_active). playable과 나뉘어 있는 건 화면이 이유를
   * 구분해 안내해야 하기 때문이다 — "점검 중이라 닫힘"과 "인원이 모자람"은 할 일이 다르다.
   */
  active: boolean
}
export interface GameDetail {
  id: number
  name: string
  rules: string
  controls: string
}
/** 리더보드 구분 — 솔로 세션(참가 1명) 기록과 멀티 세션 기록을 나눠 조회한다 */
export type LeaderboardMode = 'SOLO' | 'MULTI'
export interface LeaderboardEntry {
  rank: number
  userId: number
  nickname: string
  bestScore: number
  playCount: number
  /** 프로필 사진 URL. null이면 기본 아바타를 그린다. */
  avatarUrl?: string | null
}
export interface LeaderboardResponse {
  gameId: number
  entries: LeaderboardEntry[]
  myRank?: LeaderboardEntry
}
export interface Constellation {
  id: number
  name: string
  points: object
}

// ── 친구 ──────────────────────────────────
export type Presence = 'ONLINE' | 'OFFLINE' | 'IN_ROOM'

/** /topic/lobby/rooms 배치 원소 — 로비 방 목록 델타(-148). CLOSED면 room이 없다. */
export interface LobbyRoomEvent {
  type: 'ROOM_CREATED' | 'ROOM_UPDATED' | 'ROOM_CLOSED'
  roomId: string
  room: LiveRoomSummary | null
}

/** /user/queue/presence — 하트비트 간격 정정(BEAT)과 친구 상태 델타(FRIEND)가 함께 흐른다(-143/-149). */
export interface PresenceQueueMessage {
  type: 'BEAT' | 'FRIEND'
  intervalSeconds: number | null
  userId: number | null
  presence: Presence | null
  currentRoomId: string | null
}

/** /user/queue/notifications — 방 초대·친구 요청·세션 밀림·관리자 경고 알림 봉투(-100/-57/-105). */
export interface UserNotification<T = unknown> {
  /**
   * SESSION_DISPLACED: 같은 계정으로 다른 곳에서 로그인해 이 세션이 밀려났다(단일 세션).
   * SANCTION_WARNING: 관리자 경고가 도착했다(-105). payload = WarningNotice — 이것만 세션을
   * 끊지 않는다(경고는 접근을 막지 않는다). 서버 UserNotification 팩토리와 값이 일치해야 한다.
   */
  type:
    | 'ROOM_INVITATION'
    | 'FRIEND_REQUEST'
    | 'FRIEND_LIST_CHANGED'
    | 'SESSION_DISPLACED'
    | 'SANCTION_WARNING'
  payload: T | null
}

/** /user/queue/whisper — 친구 귓속말 한 건(-150). */
export interface WhisperMessage {
  whisperId: string
  conversationWith: number
  senderId: number
  senderNickname: string
  text: string
  sentAt: string
  mine: boolean
}
export interface Friend {
  userId: number
  nickname: string
  presence: Presence
  currentRoomId: string | null
  /** 친구 프로필 사진 URL. null이면 기본 아바타(이모지)를 그린다. */
  avatarUrl?: string | null
}
export type FriendRequestStatus = 'PENDING' | 'ACCEPTED'
export interface FriendRequestItem {
  requestId: number
  requesterNickname: string
  addresseeNickname: string
  status: FriendRequestStatus
  createdAt: string
}
export interface FriendRoomResponse {
  roomId: string | null
}

// ── 방 초대 (-100) ─────────────────────────
/** POST /v1/live-rooms/{roomId}/invitations 요청 (CreateInvitationRequest) */
export interface CreateInvitationRequest {
  friendId: number
}
/**
 * GET /invitations 응답 항목 (InvitationItem).
 * inviteCode가 실려 있어 수락 시 join-by-invite-code로 바로 입장한다(비밀방 비밀번호 면제).
 */
export interface InvitationItem {
  invitationId: string
  roomId: string
  roomTitle: string
  inviteCode: string
  fromNickname: string
  createdAt: string
  expiresAt: string
}

// ── 신고 ──────────────────────────────────
/** 신고 사유 코드 — 채팅 신고(-132)와 목록을 공유한다(서버 ReportReason). */
export type ReportReason = 'ABUSE' | 'HATE' | 'SEXUAL' | 'SPAM' | 'ETC'

export interface ReportRequest {
  reportedUserId: number
  reasonType: ReportReason
  /** 직접 입력 사유(선택). 최대 200자 */
  reasonText?: string | null
}
export interface ReportCreateResponse {
  reportId: number
}

// ── 콘텐츠 (리듬게임 곡/채보/AI 제시어) ─────
export type SongSource = 'OFFICIAL' | 'USER'
export interface Song {
  id: number
  title: string
  artist: string
  audioUrl: string
  durationSec: number
  source: SongSource
}
export type ChartMode = 'MAIMAI' | 'BEATSABER'
export type ChartDifficulty = 'EASY' | 'NORMAL' | 'HARD'
export interface Chart {
  id: number
  songId: number
  mode: ChartMode
  difficulty: ChartDifficulty
  chartType: 'OFFICIAL' | 'CUSTOM'
}
export interface AiPromptResponse {
  prompts: string[]
}
export interface CreateSongRequest {
  title: string
  artist?: string
  audioUrl: string
  durationSec?: number
}
/** POST /admin/songs 요청 (명세 RegisterSongRequest — CreateSongRequest와 필드 동일) */
export type RegisterSongRequest = CreateSongRequest
/** POST /charts 요청 (명세 CreateChartRequest) */
export interface CreateChartRequest {
  songId: number
  mode: ChartMode
  difficulty?: ChartDifficulty
  patternData: object
}

// ── 실시간 인프라 ─────────────────────────
// (구) P2P mesh용 TURN 자격증명. 현재 백엔드에 /rtc/ice-servers 컨트롤러 없음(SFU 전환으로 미사용).
export interface IceServersResponse {
  iceServers: object[]
  ttl: number
}

/**
 * SFU(LiveKit) 접속 토큰 (GET /v1/live-rooms/{roomId}/video-token, ApiResponse 래핑).
 * livekit-client의 Room.connect(url, token)에 그대로 투입. expiresIn(초) 만료 전 접속 시작.
 */
export interface SfuTokenResponse {
  url: string
  token: string
  expiresIn: number
}

// ── 대기실 채팅 (STOMP, 명세 §7 · v0.2.17) ──────────────
// 수신: SUBSCRIBE /topic/rooms/{roomId}/chat. 발신: SEND /app/rooms/{roomId}/chat · /app/rooms/{roomId}/game-suggest.
// v0.2.17부터 서버가 Redis Stream에 저장하고 chatId를 함께 방송한다(신고 -132의 대상 식별자).
// 이력 조회 API는 없음 — 자기 메시지도 이 토픽으로 에코되어 돌아온다(로컬에 미리 추가 금지).
interface ChatMessageBase {
  /** 서버(Redis Stream) 발급 메시지 고유 ID — 채팅 신고 시 그대로 전달 */
  chatId: string
  /** 참가자 식별자 — 회원: userId(숫자 문자열), 게스트: "guest-xxxx" */
  userId: string
  nickname: string
  text: string
  /** 서버 시각(UTC, ISO-8601) — 표시 시 로컬 타임존으로 변환 */
  sentAt: string
}
export type ChatMessage =
  | (ChatMessageBase & { type: 'TALK'; gameId: null; gameName: null })
  | (ChatMessageBase & { type: 'GAME_SUGGEST'; gameId: number; gameName: string })

// ── 채팅 신고 (REST, v0.2.17 · S15P11A706-132/-133) ──────────────
// 원문·작성자는 보내지 않는다 — 서버가 Redis에서 직접 읽어 전후 ±10 맥락과 함께 DB에 스냅샷(조작 신고 차단).
export type ChatReportReason = 'ABUSE' | 'HATE' | 'SEXUAL' | 'SPAM' | 'ETC'
export type ChatReportStatus = 'RECEIVED' | 'REVIEWING' | 'RESOLVED' | 'REJECTED'

export interface ChatReportCreateRequest {
  roomId: string
  chatId: string
  reason: ChatReportReason
  /** 자유 서술(선택, 최대 200자) — ETC일 때 입력 권장 */
  detail?: string
}
export interface ChatReportCreateResponse {
  reportId: number
}

/** 신고 스냅샷 원소 — 시간순 배열, chatId가 신고 대상과 일치하는 원소를 하이라이트 */
export interface ChatContextEntry {
  chatId: string
  type: 'TALK' | 'GAME_SUGGEST'
  userId: string
  nickname: string
  text: string
  sentAt: string
}

export interface ChatReportSummary {
  id: number
  roomId: string
  reporterNickname: string
  reportedNickname: string
  reason: ChatReportReason
  status: ChatReportStatus
  reportedText: string
  createdAt: string
}
export interface ChatReportListResponse {
  reports: ChatReportSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export interface ChatReportDetail {
  id: number
  roomId: string
  chatId: string
  reporterUserId: number
  reporterNickname: string
  reportedUserId: number
  reportedNickname: string
  reportedText: string
  reportedAt: string
  reason: ChatReportReason
  reasonDetail: string | null
  status: ChatReportStatus
  context: ChatContextEntry[]
  createdAt: string
  updatedAt: string
}

/** /user/queue/errors 수신 페이로드 — 시그널·채팅·게임 공용 큐, path로 구분 */
export interface StompErrorPayload {
  code: string
  message: string
  path?: string
}

// ── 게임 세션 (STOMP, S15P11A706-115) ─────────
// 수신: SUBSCRIBE /topic/rooms/{roomId}/game.
// 발신: SEND /app/rooms/{roomId}/game/start(방장) · /game/progress(2~5Hz 스로틀) · /game/finish(1회).
// 타이머 권위는 서버 — startAt/endAt/serverNow는 서버 epoch millis이며,
// 클라이언트는 serverNow - Date.now()로 오프셋을 보정해 표시한다.
export interface GameResultEntry {
  rank: number
  userId: string
  nickname: string
  /** 핑거 스타(게임①)는 매치 총점 — 평균은 score/completedCount로 계산 */
  score: number
  starsHit: number
  /** 핑거 스타(게임①) 90초 매치 완성 개수(1순위 승부 기준). 다른 게임은 null */
  completedCount?: number | null
  /** false = 미제출(중도 이탈·타임아웃) — 0점 처리 */
  finished: boolean
}
/** 그림으로 말해요 획 연산(명세 v0.2.20) — trim은 x=남길 점 수(펜 놓기 꼬리 삭제 동기화) */
export interface DrawOp {
  type: 'begin' | 'point' | 'end' | 'trim'
  tool?: 'pen' | 'erase' | null
  x?: number | null
  y?: number | null
}

export type GameEvent =
  | {
      type: 'GAME_START'
      sessionId: string
      gameId: number
      /** 게임①(핑거 스타): 공유 시드(숫자 문자열) — 전원이 같은 별자리 순서를 뽑는다. 그 외 게임은 null */
      constellationKey: string | null
      /** 게임별 과제 payload(-137) — 게임④는 출제 후 POSE_SET으로 도착하므로 시작 시 null */
      challenge?: string | null
      /** 게임④ 출제자 userId(-86) — 그 외 게임은 null */
      setterUserId?: string | null
      /** 게임④ 난이도(easy/normal/hard, -86) */
      difficulty?: string | null
      /** 게임④ 출제자 로테이션(-48) — 1-based 현재 라운드. 로테이션 없는 게임은 null */
      roundNo?: number | null
      /** 게임④ 로테이션(-48) — 전체 라운드 수(참가자 수). 로테이션 없는 게임은 null */
      totalRounds?: number | null
      /** 게임④ 모드(-9) — 'pose'(출제 대결) | 'chain'(연속 서바이벌). 그 외 게임은 null */
      mode?: string | null
      /** 게임④ 연속 서바이벌(-9) — 날아올 벽 수. 이때 challenge는 포즈 시드다 */
      wallCount?: number | null
      serverNow: number
      startAt: number
      endAt: number
      /** 그림으로 말해요(게임 10) 전용 — 주제어·화가 순서·인당 그리기 초·교대 초. 핑거 스타는 null */
      topicWord?: string | null
      turnOrder?: string[] | null
      turnDurationSec?: number | null
      handoverSec?: number | null
    }
  | {
      /** 게임④ 출제자 포즈 확정(-86) — challenge는 정규화 랜드마크 JSON */
      type: 'POSE_SET'
      sessionId: string
      challenge: string
      setterUserId: string
    }
  | {
      type: 'PROGRESS'
      sessionId: string
      userId: string
      nickname: string
      starsLit: number
      holdProgress: number
      /** 핑거 스타(게임①) 매치 중 완성 개수 — 다른 게임은 0/null */
      completedCount?: number | null
    }
  | {
      type: 'PLAYER_FINISHED'
      sessionId: string
      userId: string
      nickname: string
      score: number
      starsHit: number
      /** 핑거 스타(게임①) 매치 완성 개수 — 다른 게임은 null */
      completedCount?: number | null
    }
  | { type: 'GAME_END'; sessionId: string; results: GameResultEntry[] }
  | {
      /** 그리기 릴레이(게임 10) — 화가의 획 연산 배치 재방송. 발신자는 자기 에코 무시 */
      type: 'DRAW'
      sessionId: string
      userId: string
      seq: number | null
      ops: DrawOp[]
    }
  | {
      /** 조기 차례 넘기기(게임 10) — 전원이(발신자 포함, 에코 기준) remainingMs만큼 스케줄을 앞당긴다 */
      type: 'TURN_SKIPPED'
      sessionId: string
      userId: string
      turnIndex: number
      remainingMs: number
    }
  | {
      /** AI 채점 결과(게임 10) — score는 순위 점수(1위 100 … 5위 20). 직후 협동 GAME_END가 온다 */
      type: 'DRAW_RESULT'
      sessionId: string
      userId: string
      guesses: string[]
      answerRank: number
      score: number
    }
  | {
      /** 시작 준비 확인(-162) — 세션은 아직 없다. 각자 모델을 채우고 ready를 회신하면
       *  전원 완료(또는 서버 타임아웃 15초) 시 GAME_START가 온다 */
      type: 'GAME_PREPARE'
      prepareId: string
      gameId: number
      readyCount: number
      totalCount: number
    }
  | {
      /** 준비 인원 중계(-162) — ready 수리 때마다 n/m이 온다 */
      type: 'GAME_READY_PROGRESS'
      prepareId: string
      readyCount: number
      totalCount: number
    }
  | {
      /** 방장 강제종료(-164) — 정산 없이 세션 종료. 준비 확인 단계 취소면 sessionId가 null */
      type: 'GAME_ABORTED'
      sessionId: string | null
    }

// ── 관리자 ────────────────────────────────
export interface ReportedUser {
  userId: number
  nickname: string
  reportCount: number
  recentReasons: string[]
}

/**
 * 사용자 신고 (-112) — 관리자 목록 행. 닉네임은 신고 시점 스냅샷이라
 * 그 뒤 닉네임이 바뀌거나 탈퇴해도 그대로 남는다. 사유·상태 코드는 채팅 신고와 공용이다.
 */
export interface UserReportSummary {
  id: number
  reporterUserId: number
  reporterNickname: string
  reportedUserId: number
  reportedNickname: string
  reason: ChatReportReason
  reasonDetail: string | null
  status: ChatReportStatus
  createdAt: string
}
export interface UserReportListResponse {
  reports: UserReportSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
/**
 * 제재 이력 유형 — 부과(SUSPEND)와 수동 해제(RELEASE)가 시간순으로 쌓이는 append-only 이력이다.
 *
 * 명세 초안(-105)의 WARNING·SUSPENSION·PERMANENT_BAN과 다르다. 영구 정지는 스스로 풀리지 않는
 * 상태라 users.status(BANNED)가 표현하고 기간 정지만 이쪽이 맡는다 — "지금 정지 중인가"는
 * Redis TTL, "누가 언제 왜 몇 일"은 이력이 나눠 가지므로 유형이 곧 부과/해제가 된다.
 */
export type SanctionType = 'WARN' | 'SUSPEND' | 'RELEASE' | 'BAN' | 'UNBAN'

/**
 * 경고 부과 요청. 기간도 차단도 없어 사유가 전부다 —
 * 정지는 접근이 막히는 것으로 전달되지만 경고는 문구가 전달의 전부다.
 */
export interface WarnUserRequest {
  reason: string
  reportId?: number | null
  reportType?: SanctionRefType | null
}

/**
 * 당사자에게 보여 줄 경고 한 건. **집행자·근거 신고는 담기지 않는다** —
 * 어느 관리자가 내렸는지 알려 주면 개인에 대한 항의 대상이 되고, 신고 id는 신고자 역추적 여지가 된다.
 */
export interface WarningNotice {
  id: number
  reason: string
  createdAt: string
}

/**
 * 제재 근거가 된 신고가 어느 테이블의 행인지.
 *
 * 사용자 신고(user_reports)와 채팅 신고(chat_reports)는 별개 테이블이고 id가 각각 1부터
 * 증가한다. 유형 없이 id만 남기면 `refReportId: 7`이 어느 쪽 7번인지 알 수 없다 —
 * 관리자가 제재 근거를 되짚을 수 없고, 그게 이력을 남기는 이유의 절반이다.
 */
export type SanctionRefType = 'USER_REPORT' | 'CHAT_REPORT'

/**
 * 정지 부과 요청. days는 1~365 — 그보다 길면 영구 정지로 표현해야 할 다른 결정이다.
 *
 * `reportId`와 `reportType`은 **짝**이다. 한쪽만 보내면 서버가 400으로 끊는다 —
 * 되짚을 수 없는 참조가 이력에 남는 걸 막기 위해서다. 직권 제재면 둘 다 생략한다.
 */
export interface SuspendUserRequest {
  days: number
  reason: string
  reportId?: number | null
  reportType?: SanctionRefType | null
}

/**
 * 영구 정지 부과 요청.
 *
 * `days`가 없는 것이 기간 정지와의 차이다 — 필드를 두고 null을 "영구"로 해석하면 같은 요청에
 * 기간을 넣었다 뺐다 하다가 실수로 영구 제재가 나간다. 그건 되돌리기 가장 어려운 실수다.
 */
export interface BanUserRequest {
  reason: string
  reportId?: number | null
  reportType?: SanctionRefType | null
}

/** 정지·영구정지 수동 해제 요청 — 해제도 이력에 남는 결정이라 사유가 필수다. */
export interface ReleaseSuspensionRequest {
  reason: string
}

/**
 * 지금 이 계정에 걸려 있는 제재 — 기간 정지와 영구 정지를 한 응답에 담는다.
 *
 * 둘을 따로 조회하면 그 사이에 상태가 바뀌어 화면이 엇갈린다. 정상적으로는 동시에 서지 않는다
 * (영구 정지를 걸 때 서버가 기간 정지 키를 지운다).
 */
export interface SanctionStatus {
  suspended: boolean
  suspendReason: string | null
  /** Redis TTL을 읽은 값이라 초 단위 오차가 있다. 기간 정지가 아니면 null. */
  remainingSeconds: number | null
  releaseAt: string | null
  /** 영구 정지 — 남은 기간이라는 개념이 없다. 관리자가 해제할 때까지 유지된다. */
  banned: boolean
  banReason: string | null
  /** 누적 횟수(이력 기준) — TTL이 만료돼도 남는다. 반복 위반자 판단용. */
  suspendCount: number
  banCount: number
  warnCount: number
}

/** 제재 이력 한 줄. 닉네임은 제재 시점 스냅샷이라 그 뒤 바뀌거나 탈퇴해도 그대로다. */
export interface SanctionHistoryEntry {
  id: number
  userId: number
  userNickname: string
  adminUserId: number
  adminNickname: string
  type: SanctionType
  /** 정지 일수. RELEASE는 기간 개념이 없어 null. */
  days: number | null
  reason: string
  refReportId: number | null
  /** 위 id가 어느 신고인지. 직권 제재면 id와 함께 null이다. */
  refReportType: SanctionRefType | null
  createdAt: string
}

export interface SanctionHistoryListResponse {
  sanctions: SanctionHistoryEntry[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

// ── 관리자 포인트 내역 (-106 후속) ────────────────
/**
 * 포인트 흐름의 방향 필터. 서버에는 이런 컬럼이 없다 — point_history.amount의 부호가
 * 방향의 단일 원천이고(+적립/-사용), 이 값은 그걸 말로 고르기 위한 질의어다.
 *
 * type으로 대신할 수 없다: AI_GENERATE는 차감, AI_GENERATE_REFUND는 환급이라 유형만으로는
 * 방향을 알 수 없다.
 */
export type PointDirection = 'EARN' | 'SPEND'

export interface AdminPointHistoryEntry {
  id: number
  userId: number
  /** 조회 시점의 닉네임(스냅샷이 아니다). 탈퇴 등으로 사용자 행이 없으면 null. */
  nickname: string | null
  /** +적립 / -사용. 부호를 그대로 쓴다 — 화면이 방향을 다시 계산하면 한 곳에서 틀린다. */
  amount: number
  type: PointType
  refId: number | null
  balanceAfter: number
  createdAt: string
}

/**
 * 대상 회원의 <b>전체</b> 적립·사용 합계와 현재 잔액 — 현재 페이지 합계가 아니다.
 * 방향 필터를 걸어도 이 숫자는 좁아지지 않는다(두 값을 나란히 비교하는 게 요약의 목적).
 */
export interface AdminPointSummary {
  earned: number
  /** 쓴 금액. 서버가 음수 합을 양수로 뒤집어 준다. */
  spent: number
  currentBalance: number | null
}

export interface AdminPointHistoryListResponse {
  histories: AdminPointHistoryEntry[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  /** 회원을 지정하지 않으면 null — 여러 사람의 포인트를 합친 숫자는 아무 질문에도 답하지 않는다. */
  summary: AdminPointSummary | null
}

// ── 관리자 게임 관리 (-106) ───────────────────────
/**
 * 관리자 카탈로그 항목. 공개 목록의 `Game`과 나눠 두는 이유 — `Game.playable`은
 * "지금 시작할 수 있나"라 인원 조건이 섞여 있어서, 그 값으로 토글을 그리면 인원 때문에
 * false인 게임이 "숨김"으로 보인다. 여기서는 관리자가 쥔 스위치 하나(`active`)만 쓴다.
 */
export interface AdminGame {
  id: number
  name: string
  mode: GameMode
  category: string
  minPlayers: number
  maxPlayers: number
  roundDurationSec: number
  supportsBot: boolean
  /** 혼자서도 시작할 수 있는 게임인가(min_players<=1) — 싱글/멀티 분류의 기준. */
  soloCapable: boolean
  /** false면 카탈로그에 잠긴 카드로 남고 시작이 거부된다. */
  active: boolean
}

export interface AuditLog {
  id: number
  adminId: number
  action: 'SANCTION_APPLY' | 'GAME_TOGGLE' | 'SONG_REGISTER'
  targetType: 'USER' | 'GAME' | 'SONG'
  targetId: number
  detail: string
  createdAt: string
}

// ── 접속 상태(프레즌스) ───────────────────────────
/** POST /presence/heartbeat 요청 — 방 밖이면 roomId는 null. */
export interface HeartbeatRequest {
  roomId: string | null
}
/**
 * POST /presence/heartbeat 응답. 다음 하트비트까지의 간격을 서버가 정해 준다 —
 * 프론트가 자기 상수를 들고 있으면 서버 TTL만 바뀌었을 때 친구가 오프라인으로 깜빡인다.
 */
export interface HeartbeatResponse {
  intervalSeconds: number
}
