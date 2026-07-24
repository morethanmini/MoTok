/**
 * API 레이어 진입점. 화면에서는 `import { authApi, usersApi } from '@/api'` 형태로 사용하세요.
 *
 * 예)
 *   const me = await usersApi.getMe()
 *   try { ... } catch (e) { if (e instanceof ApiError) ... }
 */
export { http, httpEnvelope, ApiError, API_BASE, forceRefreshAccessToken } from './http'
export type { ApiEnvelope } from './http'
export * from './token'
export * from './types'

export { authApi } from './modules/auth'
export { usersApi } from './modules/users'
export { shopApi } from './modules/shop'
export { roomsApi } from './modules/rooms'
export { gamesApi } from './modules/games'
export { friendsApi } from './modules/friends'
export { reportsApi } from './modules/reports'
export { contentApi } from './modules/content'
export { adminApi } from './modules/admin'
export { rtcApi } from './modules/rtc'
export { sfuApi } from './modules/sfu'
