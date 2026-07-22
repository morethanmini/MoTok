# Handoff — 2026-07-22 (저녁)

**Branch:** lee (origin/lee와 완전히 동일)

## Did this session
- **S15P11A706-73(참가자 강제 퇴장/강퇴, 재입장 방지) 구현 완료 + 커밋 + push**:
  - `LiveRoomService.kick(host, roomId, targetUserId, reason)` 신규: 방장 검증(`NOT_ROOM_HOST`) →
    자기 자신 강퇴 차단(`ROOM_CANNOT_KICK_SELF`) → 대상 미존재 시 `ROOM_MEMBER_NOT_FOUND` →
    멤버 제거 + `room:{roomId}:kicked`(Redis Set, room과 동일 24h TTL)에 등록 → 브로드캐스트 →
    마지막 인원이면 `deleteRoom()`
  - `LiveRoomRepository`에 `addKicked()`/`isKicked()` 신규, `deleteRoom()`이 kicked 키도 같이 정리하도록 확장
  - `joinRoom()`(join/joinByInviteCode 공통 진입점) 한 곳에만 `isKicked` 가드 추가 —
    "어떤 경로로도 재입장 불가" 요구사항을 단일 지점에서 충족
  - 강퇴 사유는 자유 텍스트 대신 고정 템플릿 `KickReason` enum 5종
    (MANNER_VIOLATION/INAPPROPRIATE_PROFILE/GAME_DISRUPTION/SPAM_AD/OTHER) — 세션 중 사용자와 논의해 확정
  - 신규 엔드포인트 `POST /live-rooms/{roomId}/members/{userId}/kick`, 신규 이벤트
    `LiveRoomMemberKickedEvent`(`/topic/rooms/{roomId}/members` 재사용)
  - curl로 해피패스(강퇴+재입장 2경로 차단) + 에러 4종(비방장/자기강퇴/대상없음/사유누락) +
    회귀(목록·나가기·마지막인원 방삭제) + Redis kicked-set 정리까지 전부 검증 완료
  - API 명세서(`docs/모톡_API_명세서.html`) v0.2.6 반영: kick 엔드포인트 신규 문서화 +
    -24 이전부터 있던 STOMP 잔재(`/app/rooms/{roomId}/join·leave·kick·host`) 삭제하고
    실제 구현인 `/topic/rooms/{roomId}/members` 브로드캐스트(Left/HostChanged/Kicked 3개 이벤트)로
    정식 문서화. 직전 -72 때 누락됐던 버전 뱃지(0.2.4→0.2.6)도 같이 수정
  - 커밋: `e7297de`
  - 개발로그 저장: `모션톡(공통PJT)/08_개발 로그/S15P11A706-73.md` + 인덱스(`개발 로그.md`) 갱신 완료

## Next
- MR은 -71·-72·-73 셋 다 아직 안 올라감 — 사용자가 직접 처리하겠다고 함, 먼저 묻지 말 것
- Jira -73은 사용자가 수동으로 담당자 배정+완료 전환할 예정 — Claude가 먼저 건드리지 말 것
  (참고: -73은 현재 Jira에 담당자 미배정 상태로 남아있었음, 세션 시작 시 확인)
- 다음 우선순위는 이번 세션 마지막에 `motiontalk-jira`로 재확인함 — 그 결과를 이어서 참고할 것
- -26(방 목록·게임 카테고리 필터)은 여전히 Jira 상태 미정리 — 손대지 않기
- API 명세서 STOMP 섹션 중 chat/device/game-select/game-start·통합 `RoomEvent` envelope는
  아직 미구현 설계로 이번에도 손 안 댐 — 해당 기능 구현 시점에 같은 방식으로 정리 필요(-73 로그에도 남김)
