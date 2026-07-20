/// <reference types="vite/client" />

/** API 레이어에서 쓰는 커스텀 환경변수 타입. (.env: VITE_API_BASE 등) */
interface ImportMetaEnv {
  /** REST API 베이스 URL. 미설정 시 http://localhost:8080/api */
  readonly VITE_API_BASE?: string
  /** STOMP WebSocket URL. 미설정 시 ws://localhost:8080/ws */
  readonly VITE_WS_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
