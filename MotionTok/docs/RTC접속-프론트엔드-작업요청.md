# RTC 접속(화상 연결) 프론트엔드 작업 요청 · 참고 문서

> 기준: **모톡 API 명세서 v0.2.11** (통합 rtc-access API 추가, 지라 S15P11A706-123)
> 백엔드 구현 완료 · 통합 테스트 통과. 기존 화면은 **아무것도 깨지지 않았고 당장 해야 할 작업도 없습니다.**
> 이 문서는 "언젠가 반드시 해야 하는 이행 작업"과 "방식별 구현 방안"을 미리 정리해 두는 것입니다.
> 작성일: 2026-07-23

---

## 0. 가장 중요한 것 하나만 — 최종적으로 엔드포인트를 갈아타야 합니다

> **지금:** `GET /v1/live-rooms/{roomId}/video-token` (계속 동작, 응답 그대로, 수정 불필요)
> **최종:** `GET /v1/live-rooms/{roomId}/rtc-access` 로 이행 + 응답 `mode`로 분기
>
> 이유: 백엔드가 화상 연결 방식(LiveKit / OpenVidu / 자체 P2P mesh)을 **서버 설정으로 갈아끼우는
> 어댑터 구조**가 됐는데, 이 전환 효과는 **rtc-access를 쓰는 클라이언트에게만** 적용됩니다.
> 기존 video-token은 하위호환을 위해 **영원히 LiveKit 고정**이라, 이행 전까지는
> 서버가 방식을 바꿔도(부하테스트 비교, 방 정원별 토폴로지 등) 프론트 화면엔 반영되지 않습니다.
> 이행 시점은 팀 협의로 정하면 되고(급하지 않음), 이행 완료 후 video-token은 정리(삭제) 예정입니다.

---

## 1. 신규 API 계약

| 항목 | 값 |
|---|---|
| 엔드포인트 | `GET /api/v1/live-rooms/{roomId}/rtc-access` |
| 인증 | `Authorization: Bearer {accessToken}` (회원·게스트 공통, 필수) |
| 래핑 | `{ success, message, data }` — video-token과 동일하게 `httpEnvelope` 사용 |
| 호출 시점 | **방 접속 직전** (토큰/자격에 만료가 있음. 재입장 시 재호출) |
| 에러 | `401` 미인증 · `403 SFU_NOT_IN_ROOM`(방 멤버 아님) · `404 ROOM_NOT_FOUND` |

### 응답은 "mode 판별 union"입니다

`data.mode` 값에 따라 `sfu` 또는 `p2p` **중 하나만** 존재합니다(다른 쪽은 필드 자체가 생략됨).

```jsonc
// mode가 SFU 계열일 때 (SFU_LIVEKIT 또는 SFU_OPENVIDU)
{ "mode": "SFU_LIVEKIT",
  "sfu": { "url": "wss://motok.co.kr/livekit", "token": "eyJ…", "expiresIn": 600 } }

// mode가 P2P_MESH일 때
{ "mode": "P2P_MESH",
  "p2p": {
    "iceServers": [ { "urls": ["stun:…"] }, { "urls": ["turn:…"], "username": "…", "credential": "…" } ],
    "ttl": 600,
    "signal": { "publish": "/app/rooms/{roomId}/signal",
                "subscribe": "/user/queue/signal",
                "errors": "/user/queue/errors" } } }
```

TypeScript 타입 제안 (discriminated union — `switch(mode)`에서 타입이 자동으로 좁혀집니다):

```ts
type VideoAccessResponse =
  | { mode: 'SFU_LIVEKIT' | 'SFU_OPENVIDU'
      sfu: { url: string; token: string; expiresIn: number } }
  | { mode: 'P2P_MESH'
      p2p: { iceServers: RTCIceServer[]; ttl: number
             signal: { publish: string; subscribe: string; errors: string } } }
```

---

## 2. 방식별 프론트 구현 방안 (작업량 순)

### A. SFU_LIVEKIT — 작업량: 거의 0 (엔드포인트 교체뿐)

지금의 `useLiveKitRoom.ts` 로직이 **그대로** 쓰입니다. 바뀌는 건 접속 정보의 출처 하나:

```ts
// 현재:  sfuApi.videoToken(roomId)  →  { url, token, expiresIn }
// 이행:  rtcApi.rtcAccess(roomId)   →  res.data.sfu.url / res.data.sfu.token
```

`Room.connect(sfu.url, sfu.token)` 이후는 전부 동일. STUN/ICE 설정도 지금처럼 SDK가 알아서 합니다.

### B. SFU_OPENVIDU — 작업량: 0 (신규 구현 없음) ★ 오해 주의

**OpenVidu용 프론트를 새로 만들 필요가 없습니다.** OpenVidu 3는 내부 엔진이 LiveKit이라
클라이언트 프로토콜·SDK가 완전 호환 — 즉 **똑같은 `livekit-client`로 접속**합니다.
프론트 입장에선 `sfu.url`과 `sfu.token`의 값만 다른 "또 하나의 LiveKit 서버"입니다.

```ts
switch (res.mode) {
  case 'SFU_LIVEKIT':
  case 'SFU_OPENVIDU':          // ← 두 케이스를 한 브랜치로 묶으면 끝
    return connectLiveKit(res.sfu.url, res.sfu.token)
  case 'P2P_MESH':
    return connectMesh(res.p2p) // ← C 참고
}
```

OpenVidu SDK(openvidu-browser 등)를 **설치하지 마세요** — 그건 구버전(OpenVidu 2.x) 경로입니다.

### C. P2P_MESH — 작업량: 큼 (유일한 실질 신규 개발)

LiveKit SDK가 대신해 주던 것들을 브라우저 표준 API + 자체 시그널링으로 직접 구현해야 합니다.
**착수 전 반드시 백엔드와 협의** — 서버 쪽은 준비돼 있지만, 진행 여부·범위 자체가 팀 결정 사항입니다
(방 정원 2인 1:1부터 시작하는 단계적 계획이 있음. 8인 mesh를 처음부터 만들 일은 없습니다).

필요한 것:

1. **연결 생성**: `new RTCPeerConnection({ iceServers: res.p2p.iceServers })` — 응답을 그대로 투입.
   `ttl`(600초) 안에 연결을 시작해야 하고, 만료돼도 이미 맺어진 연결은 유지됩니다.
2. **시그널링(SDP/ICE 교환)**: 기존 STOMP 연결(`/ws`, CONNECT 헤더에 Bearer 토큰) 위에서:
   - 발행: `res.p2p.signal.publish` (= `/app/rooms/{roomId}/signal`)
     — 바디 `{ type: 'OFFER'|'ANSWER'|'CANDIDATE', toUserId, sdp?, candidate? }`
   - 수신: `res.p2p.signal.subscribe` (= `/user/queue/signal`) — `fromUserId`는 서버가 보증(위조 불가)
   - 오류: `res.p2p.signal.errors` — REST와 같은 Error 스키마(`SIGNAL_NOT_IN_ROOM` 등)
3. **페어 관리**: 방 멤버 각각과 1:1 PeerConnection을 유지(full-mesh). 입장/퇴장 이벤트에 맞춰 생성·정리.
4. **SDK가 해주던 것들을 직접**: 재협상(트랙 추가/교체), ICE 재시작·재접속, 트랙↔참가자 매핑.
   1:1(정원 2)이면 페어가 1개라 난도가 크게 내려갑니다.

참고: TURN 서버(coturn)가 배포되기 전까지 `iceServers`에 STUN만 내려올 수 있습니다(정상 동작 —
같은 망에선 직결 개발 가능, NAT 우회만 안 되는 상태).

---

## 3. 정리 — 프론트 할 일 타임라인

| 시점 | 할 일 | 규모 |
|---|---|---|
| 지금 | **없음** (기존 화면 무영향) | - |
| 이행 결정 시 | `rtcAccess()` API 모듈 추가 + `mode` switch + A·B 공용 브랜치 연결 | 반나절 이하 |
| mesh 진행 결정 시 (별도 협의) | C 구현 — 1:1부터 | 큼 (별도 일정) |
| 이행 완료 후 | `sfuApi.videoToken` 사용처 제거 (백엔드가 레거시 정리) | 소 |

## 4. 함께 갱신된 문서 / 변경 없는 것

- **API 명세서 v0.2.11** — `rtc-access` 엔드포인트 + `VideoAccessResponse` 스키마 추가분 참고
- **ERD·Redis 키맵: 변경 없음** — 이번 어댑터는 전부 무상태(토큰 서명·HMAC 계산만)라 DB 테이블·Redis 키가 하나도 늘지 않았습니다
- STOMP 채널(AsyncAPI)도 변경 없음 — mesh가 쓰는 시그널 채널은 기존 -29 계약 그대로
