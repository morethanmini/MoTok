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

// ── 방 ────────────────────────────────────
export type Visibility = 'PUBLIC' | 'PRIVATE'
export type RoomStatus = 'WAITING' | 'IN_GAME'
export interface RoomSummary {
  roomId: string
  title: string
  visibility: Visibility
  currentPlayers: number
  maxPlayers: number
  status: RoomStatus
  selectedGameId: number | null
}
export interface RoomListResponse {
  content: RoomSummary[]
  page: PageMeta
}
export interface CreateRoomRequest {
  title: string
  visibility: Visibility
  maxPlayers: number
}
export interface CreateRoomResponse {
  roomId: string
  inviteCode: string | null
  inviteUrl: string | null
}
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED'
export interface Participant {
  userId: number
  nickname: string
  isHost: boolean
  cameraOn: boolean
  micOn: boolean
  connection: ConnectionState
}
export interface RoomDetail {
  roomId: string
  title: string
  visibility: Visibility
  status: RoomStatus
  maxPlayers: number
  selectedGameId: number | null
  participants: Participant[]
}
export interface JoinResult {
  roomId: string
  sessionToken: string
}
export interface QuickMatchResponse {
  matched: boolean
  roomId: string | null
  suggestCreate: boolean
}
export interface InvitationInfo {
  inviteCode: string
  inviteUrl: string
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
export interface IceServersResponse {
  iceServers: object[]
  ttl: number
}

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
