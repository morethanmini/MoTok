package ssafy.a706.backend.friend.controller.dto;

/**
 * API 명세 §6 FriendRoomResponse — 친구가 지금 있는 방(-98).
 *
 * <p>친구가 방에 없으면 roomId는 null이다(404가 아니다). 친구는 존재하고 단지 방에 없을 뿐이므로,
 * 호출부는 "친구가 아니다"(404)와 "친구가 방에 없다"(200 + null)를 구분해서 안내할 수 있어야 한다.</p>
 *
 * @param roomId 친구가 있는 방 ID. 방 밖이거나 접속 중이 아니면 null
 */
public record FriendRoomResponse(String roomId) {
}
