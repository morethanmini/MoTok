/** 인증 API (명세 §1). */
import { http } from '../http'
import { setTokens, clearTokens } from '../token'
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
    setTokens(res.accessToken, res.refreshToken)
    return res
  },

  async logout() {
    await http.post<void>('/auth/logout')
    clearTokens()
  },

  refresh: (refreshToken: string) =>
    http.post<TokenResponse>('/auth/token/refresh', { refreshToken }),

  checkEmail: (email: string) => http.get<Availability>('/auth/availability/email', { email }),
  checkNickname: (nickname: string) =>
    http.get<Availability>('/auth/availability/nickname', { nickname }),

  async social(provider: SocialProvider, body: SocialLoginRequest) {
    const res = await http.post<TokenResponse>(`/auth/social/${provider}`, body)
    setTokens(res.accessToken, res.refreshToken)
    return res
  },

  async guest() {
    const res = await http.post<GuestResponse>('/auth/guest')
    setTokens(res.accessToken)
    return res
  },

  findId: (nickname: string) => http.post<FindIdResponse>('/auth/find-id', { nickname }),
  requestPasswordReset: (email: string) =>
    http.post<void>('/auth/password/reset-request', { email }),
  resetPassword: (token: string, newPassword: string) =>
    http.post<void>('/auth/password/reset', { token, newPassword }),
}
