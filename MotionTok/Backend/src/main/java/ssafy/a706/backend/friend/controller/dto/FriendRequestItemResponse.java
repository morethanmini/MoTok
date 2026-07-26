package ssafy.a706.backend.friend.controller.dto;

import ssafy.a706.backend.friend.model.Friendship;

import java.time.LocalDateTime;

/**
 * API 명세 §6 FriendRequestItem. 받은 요청·보낸 요청 두 목록이 같은 스키마를 쓰고, 화면은
 * 받은 쪽에서 requesterNickname을, 보낸 쪽에서 addresseeNickname을 보여준다 — 그래서 둘 다 실어야 한다.
 *
 * <p>닉네임은 스냅샷이 아니라 조회 시점의 현재 값이다(채팅 신고와 반대 정책). 요청은 수락·거절로
 * 금방 사라지는 단기 데이터이고, 상대가 닉네임을 바꿨으면 바뀐 이름으로 보이는 게 맞다.</p>
 */
public record FriendRequestItemResponse(
        Long requestId,
        String requesterNickname,
        String addresseeNickname,
        String status,
        LocalDateTime createdAt
) {

    public static FriendRequestItemResponse of(Friendship friendship,
                                               String requesterNickname,
                                               String addresseeNickname) {
        return new FriendRequestItemResponse(
                friendship.getId(),
                requesterNickname,
                addresseeNickname,
                friendship.getStatus().name(),
                friendship.getCreatedAt()
        );
    }
}
