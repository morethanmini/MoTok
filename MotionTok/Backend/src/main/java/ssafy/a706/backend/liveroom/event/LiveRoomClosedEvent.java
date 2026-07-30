package ssafy.a706.backend.liveroom.event;

/**
 * 방이 삭제(마지막 인원 퇴장·강퇴)됐을 때 발행되는 도메인 이벤트(-164).
 *
 * <p>게임·리듬 세션 서비스가 이 이벤트로 자기 정산 타이머와 세션 잔재를 정리한다 —
 * 방이 사라졌는데 정산 예약만 남으면 삭제된 방 해시를 status 필드 하나로 되살리려다
 * 실패하고(NPE), 그 방은 좀비 키로 영구 잔존했다.</p>
 */
public record LiveRoomClosedEvent(String roomId) {
}
