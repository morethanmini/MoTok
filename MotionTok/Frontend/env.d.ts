/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 백엔드 REST API base URL (예: http://localhost:8080/api) */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
