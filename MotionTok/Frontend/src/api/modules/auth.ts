/** 인증 API (명세 §1). */
import { http } from '../http'
import { setAccessToken, setGuestAccessToken, clearTokens } from '../token'
import type {
  Availability,
  FindIdResponse,
  GuestResponse,
  LoginRequest,
  SignupRequest,
  SocialLoginRequest,
  SocialProvider,
  TokenResponse,
  UserProfile,
} from '../types'

export const authApi = {
  signup: (body: SignupRequest) => http.post<UserProfile>('/auth/signup', body),

  async login(body: LoginRequest) {
    const res = await http.post<TokenResponse>('/auth/login', body)
    setAccessToken(res.accessToken)
    return res
  },

  /** 서버가 Refresh 쿠키까지 지운다 — 클라이언트는 HttpOnly 쿠키를 건드릴 수 없다. */
  async logout() {
    await http.post<void>('/auth/logout')
    clearTokens()
  },

  /** Refresh 토큰은 쿠키로 실려 나가므로 보낼 본문이 없다. */
  refresh: () => http.post<TokenResponse>('/auth/token/refresh'),

  checkEmail: (email: string) => http.get<Availability>('/auth/availability/email', { email }),
  checkNickname: (nickname: string) =>
    http.get<Availability>('/auth/availability/nickname', { nickname }),

  async social(provider: SocialProvider, body: SocialLoginRequest) {
    const res = await http.post<TokenResponse>(`/auth/social/${provider}`, body)
    setAccessToken(res.accessToken)
    return res
  },

  async guest() {
    const res = await http.post<GuestResponse>('/auth/guest')
    // 이전 회원 토큰 잔재를 지운다. 회원 Refresh 쿠키는 이 응답의 Set-Cookie가 함께 지운다 —
    // 남겨 두면 게스트로 쓰는 동안 옛 회원 세션이 갱신으로 되살아난다.
    clearTokens()
    setGuestAccessToken(res.accessToken)
    return res
  },

  findId: (nickname: string) => http.post<FindIdResponse>('/auth/find-id', { nickname }),
  requestPasswordReset: (email: string) =>
    http.post<void>('/auth/password/reset-request', { email }),
  resetPassword: (token: string, newPassword: string) =>
    http.post<void>('/auth/password/reset', { token, newPassword }),
}
