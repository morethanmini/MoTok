/// <reference types="vite/client" />

/** 그림으로 말해요 — GMS 채점 환경변수. VITE_*는 번들에 노출되므로 로컬 테스트 전용(배포 시 백엔드 프록시로 이전). */
interface ImportMetaEnv {
  /** GMS API 키 — 미설정 시 채점 단계에서 에러(폴백 없음) */
  readonly VITE_GMS_KEY?: string
  /** GMS 릴레이 주소 재정의 (기본: /gmsapi 상대 경로 — vite.config.ts dev 프록시 경유) */
  readonly VITE_GMS_API_URL?: string
  /** 채점 비전 모델 — 필수. 미설정 시 채점 단계에서 에러(기본 모델 대체 없음) */
  readonly VITE_GMS_MODEL?: string
}
