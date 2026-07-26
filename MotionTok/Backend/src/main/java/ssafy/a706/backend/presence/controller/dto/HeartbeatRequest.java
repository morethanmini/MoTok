package ssafy.a706.backend.presence.controller.dto;

/**
 * 하트비트 본문. 프론트가 지금 방에 있으면 그 roomId를, 로비·마이페이지 등 방 밖이면 null을 보낸다.
 * 이 한 필드가 ONLINE과 IN_ROOM을 가르고, 친구방 입장(-98)의 currentRoomId가 된다.
 *
 * @param roomId 현재 방 (방 밖이면 null)
 */
public record HeartbeatRequest(String roomId) {
}
