# MotionTok (Frontend)

웹캠 **모션 인식**으로 즐기는 실시간 멀티플레이 미니게임 서비스의 프론트엔드입니다.
손동작(MediaPipe Hand Landmarker)으로 게임을 하고, 화상(LiveKit)·채팅(STOMP)으로 친구들과 같은 방에서 함께 놉니다.

**기술 스택**: Vue 3 · TypeScript · Vite · Pinia · Vue Router · MediaPipe Tasks Vision · LiveKit · STOMP(@stomp/stompjs)

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

> 모션 인식은 **웹캠 접근**이 필요합니다. 로컬 개발은 `localhost`(보안 컨텍스트)에서, 배포는 HTTPS에서만 카메라가 동작합니다.

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

This project uses [pnpm](https://pnpm.io/) as its package manager (pinned via the `packageManager` field). Enable it once with Corepack:

```sh
corepack enable
```

> Windows에서 Node가 `C:\Program Files`에 설치돼 있으면 `corepack enable`은 **관리자 권한 터미널**에서 한 번 실행해야 합니다.
> Corepack이 막혀 있으면 npm 전역 설치

```sh
npm install -g pnpm
```


```sh
pnpm install
```

### 환경 변수

REST API 서버 주소는 `VITE_API_BASE_URL`로 지정합니다. 설정하지 않으면 `http://localhost:8080/api`로 기본 연결됩니다.

```sh
# .env.local
VITE_API_BASE_URL=http://localhost:8080/api
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test:unit
```

### Lint & Format

린트는 [oxlint](https://oxc.rs/)(빠른 1차) + [ESLint](https://eslint.org/)(2차)를 순서대로 돌리고, 포매팅은 [Prettier](https://prettier.io/)를 씁니다.

```sh
pnpm lint      # oxlint → eslint (둘 다 --fix)
pnpm format    # prettier --write src/
```

## 프로젝트 구조 (협업 규칙)

기능(화면) 단위로 폴더를 나눠 **팀원 간 파일 충돌을 최소화**합니다. 각자 자기 `features/<name>/` 안에서 작업하세요.

```
src/
├─ api/                   # REST API 레이어 — 화면에서는 `import { roomsApi } from '@/api'`로 사용
│   ├─ http.ts            #  └ fetch 래퍼 + 토큰 자동 주입/401 재시도. http(raw DTO), httpEnvelope(래핑 응답)
│   ├─ token.ts           #  └ JWT 저장소(local/sessionStorage) — 앱 전체 토큰 단일 소스
│   ├─ refreshScheduler.ts#  └ 요청이 뜸한 세션에서도 만료 전 액세스 토큰을 자동 갱신
│   ├─ types.ts           #  └ 공용 DTO·에러 스키마 타입
│   ├─ index.ts           #  └ 진입점 (authApi, usersApi, roomsApi, gamesApi, shopApi …)
│   └─ modules/           #  └ 도메인별 API (auth·users·rooms·games·shop·friends·reports·admin·content·rtc·sfu)
├─ assets/styles/         # 전역 스타일 (모든 화면 공통인 것만!) — 순서: tokens → base → pixel
│   ├─ tokens.css         #  └ 색·그림자·모서리·폰트 CSS 변수 — 색 바꿀 땐 여기
│   ├─ base.css           #  └ 리셋 + 기본 타이포
│   └─ pixel.css          #  └ 공유 픽셀 유틸 클래스 + 공용 keyframes
├─ components/common/     # 재사용 컴포넌트 (AppHeader, AppPage, PixelButton/Card/Modal/Toast,
│                         #   BrandLogo, BgmToggle, CoinIcon, ChargePointsModal,
│                         #   LoginRequiredModal, GuestSignupPromptModal)
├─ composables/           # 재사용 로직 — useCamera, useHandLandmarker(MediaPipe), useLiveKitRoom,
│                         #   useRoomChat, useBgm, useToast, useAsyncData, useLoginRequired,
│                         #   useAccessDenied, useGuestSignupPrompt, useRoomUnloadLeave
├─ stores/                # Pinia — session(게스트/회원 세션)
├─ router/
│   ├─ routeNames.ts      # 라우트 이름 상수 (문자열 대신 이걸로 이동)
│   ├─ routes.ts          # 전체 라우트 취합
│   └─ index.ts           # createRouter + 전역 인증 가드(beforeEach)
└─ features/              # 화면별 모듈 (담당자별 소유)
    ├─ start/  auth/  auth-recovery/  lobby/  device-setup/  game-room/  game-result/
    ├─ account/  shop/  inventory/  friends/  ranking/  games-catalog/  games/
    ├─ admin/  report/  unsupported/
    │   ├─ <Name>View.vue    # 화면 루트 (자체 <style scoped>로 화면 CSS 소유)
    │   ├─ routes.ts         # 이 화면의 라우트 정의 + 접근 가드(meta)
    │   ├─ components/       # 화면 전용 하위 컴포넌트
    │   └─ data.ts           # 화면 목업 데이터/타입 (API 연동 시 교체 지점)
```

### API 레이어

- 화면·컴포저블은 `@/api`에서 도메인 API(`authApi`, `roomsApi` …)를 import해 씁니다. `fetch`를 직접 부르지 않습니다.
- 백엔드 응답 규약이 리소스마다 달라 클라이언트가 둘로 나뉩니다.
  - `http` — `/auth`·`/users` 등 **raw DTO**를 그대로 반환하는 경로용
  - `httpEnvelope` — `/v1/live-rooms`·SFU처럼 `{ success, message, data }`로 **래핑된** 응답에서 `data`만 꺼내 반환
- 액세스 토큰은 요청 시 자동 주입되고, 만료 임박 시 선제 갱신 + 401 시 1회 재발급 후 재시도합니다(single-flight). 오류는 전부 `ApiError`(`{ status, code, message }`)로 정규화됩니다.

### 새 화면 추가하기

1. `src/features/<name>/` 폴더 생성 → `<Name>View.vue` 작성 (`<style scoped>`로 스타일 격리)
2. 같은 폴더에 `routes.ts` 작성 (기존 feature의 것을 복사, 필요 시 `meta` 가드 지정)
3. `src/router/routeNames.ts`에 이름 한 줄 추가
4. `src/router/routes.ts`에 `import` + 스프레드 한 줄 추가

→ **건드리는 공용 파일은 딱 2개**(routeNames, routes)라 merge 충돌이 거의 없습니다.

### 스타일 규칙

- 색·그림자·모서리 값은 하드코딩하지 말고 `tokens.css`의 CSS 변수(`var(--c-coral)` 등)를 사용
- 화면 전용 CSS는 각 `View.vue`의 `<style scoped>`에만 — 전역 파일(`base.css` 등)에 화면 규칙 추가 금지
- 여러 화면이 쓰는 버튼/카드/모달은 `components/common/`의 공통 컴포넌트를 재사용

### 에셋

- 디자인 에셋(픽셀 아트, BGM, 아이콘)은 `public/assets/`에 있으며 절대경로(`/assets/...`)로 참조합니다.
- MediaPipe wasm·손 인식 모델은 CDN 대신 `public/mediapipe/`에서 **셀프호스팅**합니다. 모델은 로비 진입 스플래시에서 미리 받아 세션 동안 재사용됩니다.

## 인증 가드

라우터 전역 가드(`router/index.ts`의 `beforeEach`)가 화면 진입 전에 세션을 복원하고 접근 권한을 확인합니다. 판단 근거는 저장된 **액세스 토큰의 클레임**이며, 실제 데이터 권한은 서버가 다시 검증합니다. 각 라우트의 `meta`로 요구 수준을 지정합니다.

| `meta` | 의미 | 미충족 시 |
|---|---|---|
| (없음) | 공개 — 누구나 접근 | — |
| `requiresAuth` | 유효 세션 필요 (**회원 또는 게스트**) | 로그인/게스트 시작 유도 |
| `requiresMember` | **회원 전용** (게스트 불가) | 로그인 유도 후 시작 화면 |
| `requiresAdmin` | 관리자(`role: ADMIN`) 전용 | 접근 불가 안내 후 로비 |

## 화면 경로

> 개발 서버: `pnpm dev` → 기본 `http://localhost:5173`. 예) 로비 → `http://localhost:5173/lobby`
>
> ⚠️ 공개(가드 없음) 화면 외에는 세션/권한이 없으면 전역 가드가 다른 화면으로 리다이렉트합니다. 디자인 확인용으로 가드 화면을 바로 열려면 로그인(또는 게스트 시작)이 필요합니다.

### 진입 · 인증
| 경로 | 화면 | 가드 | 설명 · 쿼리 |
|---|---|---|---|
| `/` | 시작(Start) | 공개 | 랜딩. 로그인/회원가입/게스트 진입 |
| `/auth` | 로그인·회원가입 | 공개 | `?mode=login`(기본) \| `?mode=signup`, 소셜 콜백 `?code=...` |
| `/auth/nickname` | 닉네임 설정 | 회원 | 소셜 최초 로그인 후 닉네임 확정 (완료 전까지 여기서 못 벗어남) |
| `/auth/find-id` | 아이디 찾기 | 공개 | |
| `/auth/reset-password` | 비밀번호 재설정 | 공개 | `?token=...` (메일 링크) |

### 로비 · 게임 탐색
| 경로 | 화면 | 가드 | 설명 |
|---|---|---|---|
| `/lobby` | 로비 | 회원 | 공개방 목록·친구·빠른시작 |
| `/games` | 게임 목록 | 공개 | 게임 카탈로그 |
| `/ranking` | 랭킹 | 공개 | 게임별 리더보드 |

### 게임 플레이 흐름
| 경로 | 화면 | 가드 | 설명 · 쿼리 |
|---|---|---|---|
| `/device-setup` | 기기 점검 | 세션 | 카메라/마이크 확인. `?game=...&room=...` |
| `/room` | 게임룸 | 세션 | 화상 파티룸(LiveKit)·채팅·모션 게임. `?game=...&room=...&host=1` |
| `/result` | 게임 결과 | 세션 | 포디움·획득 포인트. `?game=...&room=...` |

### 계정 · 상점 · 인벤토리
| 경로 | 화면 | 가드 | 설명 |
|---|---|---|---|
| `/me` | 마이페이지 | 회원 | 프로필·포인트·포인트내역·전적 |
| `/me/settings` | 계정 설정 | 회원 | 닉네임 변경·비밀번호 변경·탈퇴 |
| `/shop` | 상점 | 회원 | 아이템 구매·포인트 충전 |
| `/shop/ai-create` | AI 아이템 생성 | 회원 | 드로잉 기반 아이템 생성 |
| `/inventory` | 인벤토리·꾸미기 | 회원 | 아이템 장착/해제·꾸미기 저장 |

### 소셜 · 관리자 · 기타
| 경로 | 화면 | 가드 | 설명 |
|---|---|---|---|
| `/friends` | 친구 | 회원 | 친구 목록/요청/방 합류 |
| `/admin` | 관리자 | 관리자 | 신고·제재·감사로그·게임 노출·곡 등록 |
| `/unsupported` | 미지원 안내 | 공개 | 미지원 브라우저/기기 안내 |

> 새 화면 추가 시 위 표에 한 줄 추가해 주세요. (라우트 정의는 각 `features/<name>/routes.ts`)
