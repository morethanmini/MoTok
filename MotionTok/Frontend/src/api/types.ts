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
  refreshToken: string
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
}

/** GET /users/{userId} — 랭킹 등에서 보는 다른 사용자의 공개 프로필 (-96) */
export interface PublicUserProfile {
  id: number
  nickname: string
  createdAt: string
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
export type PointType = 'GAME_REWARD' | 'SHOP_PURCHASE' | 'AI_GENERATE' | 'GUEST_MIGRATE'
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
  playCount: number
  bestScore: number
  rankNo: number
}
export interface DecorationConfig {
  config: Record<string, unknown>
  updatedAt?: string
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
  name?: string
  strokes: object[]
  category?: ItemCategory
}

// ── 라이브룸 (구 rooms → live-rooms, 명세 §4) ──────
export type Visibility = 'PUBLIC' | 'PRIVATE'
// 백엔드 status는 String. 생성 시 WAITING, 게임 시작 시 IN_GAME(예정).
export type RoomStatus = 'WAITING' | 'IN_GAME'

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
  playable: boolean
}
export interface GameDetail {
  id: number
  name: string
  rules: string
  controls: string
}
export interface LeaderboardEntry {
  rank: number
  userId: number
  nickname: string
  bestScore: number
  playCount: number
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
export interface Friend {
  userId: number
  nickname: string
  presence: Presence
  currentRoomId: string | null
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

// ── 신고 ──────────────────────────────────
export interface ReportRequest {
  reportedUserId: number
  reasonType: string
  reasonText?: string | null
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

// ── 대기실 채팅 (STOMP, 명세 §7 · v0.2.16) ──────────────
// 수신: SUBSCRIBE /topic/rooms/{roomId}/chat. 발신: SEND /app/rooms/{roomId}/chat · /app/rooms/{roomId}/game-suggest.
// v0.2.16부터 서버가 Redis Stream에 저장하고 chatId를 함께 방송한다(신고 -132의 대상 식별자).
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

// ── 채팅 신고 (REST, v0.2.16 · S15P11A706-132/-133) ──────────────
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
  score: number
  starsHit: number
  /** false = 미제출(중도 이탈·타임아웃) — 0점 처리 */
  finished: boolean
}
export type GameEvent =
  | {
      type: 'GAME_START'
      sessionId: string
      gameId: number
      constellationKey: string
      serverNow: number
      startAt: number
      endAt: number
    }
  | {
      type: 'PROGRESS'
      sessionId: string
      userId: string
      nickname: string
      starsLit: number
      holdProgress: number
    }
  | {
      type: 'PLAYER_FINISHED'
      sessionId: string
      userId: string
      nickname: string
      score: number
      starsHit: number
    }
  | { type: 'GAME_END'; sessionId: string; results: GameResultEntry[] }

// ── 관리자 ────────────────────────────────
export interface ReportedUser {
  userId: number
  nickname: string
  reportCount: number
  recentReasons: string[]
}
export type SanctionType = 'WARNING' | 'SUSPENSION' | 'PERMANENT_BAN'
export interface SanctionRequest {
  userId: number
  type: SanctionType
  reason: string
  endsAt?: string | null
}
export interface Sanction {
  id: number
  userId: number
  adminId: number
  type: SanctionType
  startsAt: string
  endsAt: string | null
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
