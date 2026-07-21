/// <reference types="vite/client" />

/** API 레이어 커스텀 환경변수 타입. (REST base URL은 루트 env.d.ts의 VITE_API_BASE_URL로 통일) */
interface ImportMetaEnv {
  /** STOMP WebSocket URL. 미설정 시 ws://localhost:8080/ws */
  readonly VITE_WS_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
