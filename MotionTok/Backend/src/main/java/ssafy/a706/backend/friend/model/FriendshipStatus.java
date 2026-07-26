package ssafy.a706.backend.friend.model;

/**
 * ERD v0.2 FRIENDSHIP.status — PENDING | ACCEPTED 두 값뿐이다.
 * 거절에 해당하는 상태가 없는 건 의도된 설계다: 거절은 행을 삭제해 처리한다(그래야 나중에 다시 요청할 수 있다).
 */
public enum FriendshipStatus {
    PENDING,
    ACCEPTED
}
