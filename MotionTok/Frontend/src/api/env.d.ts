/// <reference types="vite/client" />

/** API 레이어 커스텀 환경변수 타입. (REST base URL은 루트 env.d.ts의 VITE_API_BASE_URL로 통일) */
interface ImportMetaEnv {
  /** STOMP WebSocket URL. 미설정 시 ws://localhost:8080/ws */
  readonly VITE_WS_BASE?: string
  /** 소셜 로그인 카카오 REST API 키 (authorize URL에 노출되는 공개값) */
  readonly VITE_KAKAO_REST_KEY?: string
  /** 소셜 로그인 구글 OAuth 클라이언트 ID (authorize URL에 노출되는 공개값) */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
