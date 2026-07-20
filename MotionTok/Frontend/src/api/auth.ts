/**
 * 인증 도메인 API — 모톡 API 명세서 v0.2.1 기준.
 * 경로·필드명·응답 스키마는 명세서를 그대로 따른다.
 */
import { request } from './client'

/** 명세서 UserProfile */
export interface UserProfile {
  id: number
  email: string
  nickname: string
  role: 'USER' | 'ADMIN'
  pointBalance: number
  createdAt: string
}

/** 명세서 TokenResponse */
export interface TokenResponse {
  tokenType: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: UserProfile
}

/** 명세서 Availability */
export interface Availability {
  available: boolean
}

/** 명세서 EmailVerifyResult */
export interface EmailVerifyResult {
  verificationToken: string
  expiresIn: number
}

/** GET /auth/availability/email — 이메일 중복 확인 */
export function checkEmailAvailability(email: string) {
  return request<Availability>(`/auth/availability/email?email=${encodeURIComponent(email)}`)
}

/** GET /auth/availability/nickname — 닉네임 중복 확인 */
export function checkNicknameAvailability(nickname: string) {
  return request<Availability>(
    `/auth/availability/nickname?nickname=${encodeURIComponent(nickname)}`,
  )
}

/**
 * POST /auth/email/verify-request — 6자리 인증번호 발송.
 * 이미 가입된 이메일이면 409 AUTH_EMAIL_ALREADY_REGISTERED로 거절된다(메일 발송 안 함).
 */
export function sendEmailVerificationCode(email: string) {
  return request<void>('/auth/email/verify-request', { method: 'POST', body: { email } })
}

/** POST /auth/email/verify — 인증번호 확인 후 1회용 verificationToken 발급 */
export function verifyEmailCode(email: string, code: string) {
  return request<EmailVerifyResult>('/auth/email/verify', {
    method: 'POST',
    body: { email, code },
  })
}

/** POST /auth/signup — 회원가입. verificationToken은 서버가 1회 소비한다. */
export function signup(payload: {
  email: string
  password: string
  nickname: string
  verificationToken: string
}) {
  return request<UserProfile>('/auth/signup', { method: 'POST', body: payload })
}

/** POST /auth/login — 일반 로그인 */
export function login(email: string, password: string, rememberMe = false) {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: { email, password, rememberMe },
  })
}

/** POST /auth/token/refresh — Access 토큰 재발급(refreshToken도 회전됨) */
export function refreshToken(token: string) {
  return request<TokenResponse>('/auth/token/refresh', {
    method: 'POST',
    body: { refreshToken: token },
  })
}

/** POST /auth/logout — 서버측 Refresh 토큰 무효화 */
export function logout(accessToken: string) {
  return request<void>('/auth/logout', { method: 'POST', token: accessToken })
}
