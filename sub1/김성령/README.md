# webmobile1-skeleton

실시간 그룹 화상 회의 서비스를 위한 **스켈레톤 프로젝트**입니다. 학습 목적으로 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다.

## Sub 1 구현 내역 (회원가입 / 로그인)

1주차(Sub PJT Ⅰ) 요구사항인 **회원가입·로그인 기능**을 Front-end / Back-end 양쪽에 구현했습니다.

### Back-end

- **인증 API** — `POST /auth/login` 에 존재하지 않는 계정 404, 비밀번호 불일치 401 분기 추가
  (기존 코드는 없는 계정일 때 NPE로 500이 발생하던 것을 수정)
- **유저 API** — 회원가입(`POST /users`, 201), 내 정보 조회(`GET /users/me`),
  아이디 중복 확인(`GET /users/{userId}`, 409), 정보 수정(`PATCH`), 탈퇴(`DELETE`) 구현
  - 회원가입 시 소속/직책/이름까지 저장 (기존 스켈레톤은 아이디·비밀번호만 저장)
  - 수정/삭제는 토큰의 유저와 경로 변수를 대조해 **본인만** 가능하도록 처리
  - 모든 엔드포인트에 Swagger 어노테이션 부착
- **엔티티/리포지토리** — ERD에 맞춰 `ConferenceCategory` 엔티티·Repository·RepositorySupport 추가
- **INIT.SQL** — 테스트 유저(`test-1` / `12345`)와 카테고리 3건(업무/교육/기타) 초기 데이터
  (`backend/src/main/resources/db/init.sql`)

### Front-end

- **공용 인증 처리** — axios 요청 인터셉터로 토큰 자동 주입, 응답 인터셉터로 401(세션 만료/무효)·403 분기 처리
- **상태 관리** — 새로고침 시 localStorage에서 토큰·유저 정보 복원, 로그인/로그아웃/회원가입 액션
- **로그인 팝업** — 입력별 유효성 검사, 버튼 활성/비활성, 로딩 스피너, 실패 시 서버 메시지 표시
- **회원가입 팝업 신규** — 6개 필드 유효성, 아이디 중복 확인, 성공/실패 팝업
- **네비게이션** — 로그인 상태에 따라 메뉴(홈/지난 회의 이력/로그아웃)와 회원가입·로그인 버튼 분기

### 팀 결정 사항 (명세서와 다르게 조정한 부분)

| 항목 | 조정 내용 |
| ---- | ---- |
| 소속 필드 철자 | 명세서 오타(`deparment`) 대신 `department`로 통일 |
| 로그인 비밀번호 유효성 | 필수 + 최대 16자만으로 완화 (테스트 계정 `12345` 로그인 가능하도록) |
| 회원가입 비밀번호 유효성 | 명세 그대로 (9~16자 + 영문·숫자·특수문자 조합) 유지 |
| `test-1` 비밀번호 해시 | 명세서 p.50 해시가 `12345`와 실제로 불일치(명세 오류)하여, 재인코딩한 해시로 INIT.SQL 교체 |

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
   - **주의**: skeleton은 기본 설정만 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다.

4. **프론트엔드 개발 서버 실행**
   ```bash
   cd frontend
   npm install      # 최초 한 번만 실행 (의존성 설치)
   npm run dev      # http://localhost:8083
   ```

5. **접속 및 검증**
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
- **DB 연결 실패**: 
  - MySQL 서버가 실행 중인지 확인
  - `application.properties`의 DB 연결 정보 확인 (username, password, url의 포트 번호)
  - MySQL 계정 권한 확인
