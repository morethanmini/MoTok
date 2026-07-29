/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 백엔드 REST API base URL. dev·운영 모두 상대 경로(/api) — 앞단(vite dev 프록시 / nginx)이 백엔드로 넘긴다. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
