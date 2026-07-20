# MotionTok

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

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

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```

## 프로젝트 구조 (협업 규칙)

기능(화면) 단위로 폴더를 나눠 **팀원 간 파일 충돌을 최소화**합니다. 각자 자기 `features/<name>/` 안에서 작업하세요.

```
src/
├─ assets/styles/        # 전역 스타일 (모든 화면 공통인 것만!)
│   ├─ tokens.css        #  └ 색·그림자·모서리·폰트 CSS 변수 — 색 바꿀 땐 여기
│   ├─ base.css          #  └ 리셋 + 기본 타이포
│   └─ pixel.css         #  └ 공유 픽셀 유틸 클래스 + 공용 keyframes
├─ components/common/    # 재사용 컴포넌트 (PixelButton, PixelCard, PixelModal, BrandLogo, BgmToggle, PixelToast)
├─ composables/          # useBgm, useCamera, useToast
├─ stores/               # Pinia — session(게스트/회원)
├─ router/
│   ├─ routeNames.ts     # 라우트 이름 상수 (문자열 대신 이걸로 이동)
│   ├─ routes.ts         # 전체 라우트 취합
│   └─ index.ts
└─ features/             # 화면별 모듈 (담당자별 소유)
    ├─ start/  auth/  lobby/  device-setup/  game-room/  game-result/
    │   ├─ <Name>View.vue    # 화면 루트 (자체 <style scoped>로 화면 CSS 소유)
    │   ├─ routes.ts         # 이 화면의 라우트 정의
    │   ├─ components/       # 화면 전용 하위 컴포넌트
    │   └─ data.ts           # 화면 목업 데이터/타입 (API 연동 시 교체 지점)
```

### 새 화면 추가하기

1. `src/features/<name>/` 폴더 생성 → `<Name>View.vue` 작성 (`<style scoped>`로 스타일 격리)
2. 같은 폴더에 `routes.ts` 작성 (기존 feature의 것을 복사)
3. `src/router/routeNames.ts`에 이름 한 줄 추가
4. `src/router/routes.ts`에 `import` + 스프레드 한 줄 추가

→ **건드리는 공용 파일은 딱 2개**(routeNames, routes)라 merge 충돌이 거의 없습니다.

### 스타일 규칙

- 색·그림자·모서리 값은 하드코딩하지 말고 `tokens.css`의 CSS 변수(`var(--c-coral)` 등)를 사용
- 화면 전용 CSS는 각 `View.vue`의 `<style scoped>`에만 — 전역 파일(`base.css` 등)에 화면 규칙 추가 금지
- 여러 화면이 쓰는 버튼/카드/모달은 `components/common/`의 공통 컴포넌트를 재사용

### 에셋

디자인 에셋(픽셀 아트, BGM)은 `public/assets/`에 있으며 절대경로(`/assets/...`)로 참조합니다.
