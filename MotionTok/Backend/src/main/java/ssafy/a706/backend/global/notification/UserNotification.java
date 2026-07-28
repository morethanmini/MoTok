package ssafy.a706.backend.global.notification;

/**
 * {@code /user/queue/notifications}로 나가는 알림 봉투.
 *
 * <p>한 큐에 여러 도메인이 흐르므로 {@code type}으로 구분하고 내용은 {@code payload}에 담는다.
 * 도메인마다 큐를 새로 파면 클라이언트 구독이 기능 수만큼 늘어나는데, 알림은 "화면 어딘가에
 * 배지를 올린다"는 성격이 같아 한 통로로 묶는 편이 낫다.</p>
 *
 * <p>{@code payload}는 각 도메인의 기존 응답 DTO를 그대로 싣는다 — REST 스냅샷과 푸시 델타의
 * 모양이 같아야 클라이언트가 둘을 같은 코드로 다룰 수 있다.</p>
 */
public record UserNotification(String type, Object payload) {

    /** 방 초대가 도착했다(-100). payload = InvitationItemResponse */
    public static UserNotification roomInvitation(Object invitation) {
        return new UserNotification("ROOM_INVITATION", invitation);
    }

    /** 친구 요청이 도착했다(-57). payload = FriendRequestItemResponse */
    public static UserNotification friendRequest(Object request) {
        return new UserNotification("FRIEND_REQUEST", request);
    }

    /**
     * 친구 요청이 처리됐다(수락·거절·취소) 또는 친구가 끊겼다.
     * 목록 전체를 다시 그리는 편이 단순해 payload 없이 신호만 보낸다.
     */
    public static UserNotification friendListChanged() {
        return new UserNotification("FRIEND_LIST_CHANGED", null);
    }
}
