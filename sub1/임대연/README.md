# webmobile1-skeleton

실시간 그룹 화상 회의 서비스를 위한 **스켈레톤 프로젝트**입니다. 학습 목적으로 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다.

## 1. Tech Stack

| 구분 | 기술 | 버전 및 비고 |
| ---- | ---- | ---- |
| Frontend | Vue 3.4.27, Vite 5.1.0, Element Plus 2.8.6, Vue Router 4.3.2, Vuex 4.1.0 | Node.js 20.18.0 LTS, npm |
| Backend | Spring Boot 2.7.18, Spring Security, QueryDSL | Java 11 권장, Gradle 6.9.4 |
| Realtime | Kurento Media Server 6.18.0 | 수동 설치 필요 |
| Database | MySQL 8.0.39 | `ssafy_web_db` (수동 설치 필요) |
| Auth & API | JWT, REST, Swagger | `http://localhost:8080/swagger-ui/index.html` |

## 2. Prerequisites

- **Java 11 JDK** (`JAVA_HOME` 설정 필수 - JDK 17 이상이면 Gradle 빌드 실패)
- **MySQL 8.0.39** (수동 설치 필요)
- **Node.js 20.18.0 (LTS)** + npm
- **Kurento Media Server 6.18.0** (수동 설치 필요)
- **Windows/macOS/Linux** 모두 지원

## 3. 빠른 실행 흐름

### 권장 실행 순서 (로컬 개발 환경)

1. **MySQL 설치 및 DB 생성**
   - MySQL 8.0.39 설치
   - DB 생성: `create database IF NOT EXISTS ssafy_web_db collate utf8mb4_general_ci;`
   - 계정 생성 및 권한 부여

2. **백엔드 설정**
   ```bash
   cd backend
   # src/main/resources/application.properties 수정
   # spring.datasource.username=<사용자 계정>
   # spring.datasource.password=<비밀번호>
   # spring.datasource.url의 포트 번호 확인 (기본값: 3306)
   ```

3. **백엔드 빌드 & 실행**
   ```bash
   cd backend
   ./gradlew clean build
   ./gradlew bootRun
   ```
   - 기본 포트: **HTTP 8080** (Swagger: `http://localhost:8080/swagger-ui/index.html`)
   - `JAVA_HOME`이 **JDK 11**을 가리켜야 합니다(기본 `java`가 상위 버전이면 `JAVA_HOME`으로 지정). 첫 실행 시 JPA(`ddl-auto=update`)가 테이블을 생성합니다.
   - `./gradlew clean build` 시 프론트엔드도 함께 빌드되어 `src/main/resources/dist`에 번들됩니다.

4. **초기 데이터 시드 (INIT.SQL)**
   - 3번으로 스키마가 생성된 뒤 시드 스크립트를 실행합니다.
   ```bash
   cd backend
   mysql --default-character-set=utf8mb4 -u <계정> -p ssafy_web_db < src/main/resources/db/INIT.SQL
   ```
   - `user` 시드 계정 `test-1` / 비밀번호 `12345`(bcrypt)와 `conference_category` 3행(업무·교육·기타)이 삽입됩니다.

5. **프론트엔드 개발 서버 실행**
   ```bash
   cd frontend
   npm install      # 최초 한 번만 실행 (의존성 설치)
   npm run dev      # http://localhost:8083
   ```

6. **접속 및 검증**
   - 프론트엔드: `http://localhost:8083` (개발 서버)
   - 백엔드 API: `http://localhost:8080`
   - Swagger UI: `http://localhost:8080/swagger-ui/index.html`

> **참고**: skeleton 프로젝트는 학습 목적으로 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다. 완성된 코드는 `webmobile1-complete` 프로젝트를 참고하세요.

## 4. 디렉터리 구조

```
webmobile1-skeleton/
├── README.md                          # 전체 개요 및 실행 요약 (현재 문서)
├── backend/                           # Spring Boot 프로젝트
│   └── src/main/...                   # API, 도메인, 정적 리소스 포함
└── frontend/                          # Vue 3 프론트엔드
    └── src/...                        # Vue 컴포넌트, 스토어, 라우터 등
```

## 5. 주요 포트 및 서비스

| 서비스 | 포트 | 설명 |
| ---- | ---- | ---- |
| Spring Boot (HTTP) | 8080 | 백엔드 API 및 정적 리소스 (기본 접속 포트) |
| Vue 개발 서버 | 8083 | 프론트엔드 개발 서버 (`npm run dev`) |
| MySQL | 3306 | 로컬 MySQL 서버 |
| Kurento Media Server | 8888 | WebRTC 미디어 서버 (수동 설치 필요) |

## 6. Troubleshooting

- **Gradle 빌드 오류**: `JAVA_HOME`이 JDK 11을 가리키는지 확인 (`java -version`)
- **포트 충돌**: 8080, 8083, 3306, 8888 포트 사용 여부 확인
- **DB 연결 실패 / `Access denied ... (1045)`**:
  - MySQL 서버가 실행 중인지 확인
  - `application.properties`의 DB 연결 정보(username, password, url 포트)가 실제 MySQL 계정과 일치하는지 확인
  - MySQL 계정 권한 및 `ssafy_web_db` 존재 여부 확인
- **`:npmInstall` 실패 (npm ERESOLVE)**: `frontend/package.json`의 `vite`는 `^5.1.0`을 유지해야 합니다. vite 8로 올라가면 `@vitejs/plugin-vue@5`와 피어 의존성 충돌이 발생합니다.
- **INIT.SQL 한글 깨짐 / `1366` 오류**: `--default-character-set=utf8mb4`로 실행합니다(스크립트에 `SET NAMES utf8mb4;` 포함).

## 7. 구현 범위 및 주요 API

현재 **인증/유저 마일스톤**(명세 pp.42–57)이 구현되어 있습니다. Conference(방)·채팅·WebRTC 등은 이후 마일스톤으로 아직 미구현입니다.

### 백엔드 REST API (`/api/v1`)

| Method | Path | 인증 | 설명 |
| ---- | ---- | ---- | ---- |
| POST | `/auth/login` | 공개 | 로그인 · JWT 발급 (404: 없는 계정 / 401: 잘못된 비밀번호) |
| POST | `/users` | 공개 | 회원가입 (201) |
| GET | `/users/me` | 로그인 | 내 정보 조회 |
| GET | `/users/{userId}` | 공개 | 아이디 중복 확인 (409: 이미 존재) |
| PATCH | `/users/{userId}` | 로그인 | 정보 수정 (소속·직책·이름) |
| DELETE | `/users/{userId}` | 로그인 | 회원 탈퇴 (204) |

- 요청/응답 JSON 키는 명세 원문을 따릅니다: `deparment`(오탈자 그대로), `user_id`(snake_case).

### 프론트엔드
- 공통 인증/토큰 관리(JWT localStorage + Axios 인터셉터로 `Authorization` 헤더 부착 및 401/403 처리), 회원가입/로그인 팝업, 로그아웃, 로그인/비로그인 네비게이션.

### 시드 계정 참고
- `test-1` / `12345`. 단, 로그인 폼은 명세대로 비밀번호 **9자 + 영문·숫자·특수문자 조합**을 강제하므로 `test-1`은 UI 로그인 폼을 통과하지 못합니다(명세 자체의 제약). UI 로그인 흐름은 회원가입으로 만든 규칙 충족 계정으로, 시드 계정은 Swagger/API로 테스트하세요.
