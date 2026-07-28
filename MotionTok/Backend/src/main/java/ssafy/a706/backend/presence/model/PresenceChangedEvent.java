package ssafy.a706.backend.presence.model;

/**
 * 프레즌스가 <b>실제로 바뀐</b> 순간에만 발행되는 애플리케이션 이벤트(-149).
 *
 * <p><b>왜 이벤트인가</b> — 친구에게 알리려면 친구 관계를 읽어야 하는데, {@code FriendService}는
 * 이미 {@code PresenceService}를 참조한다. 프레즌스가 친구를 직접 부르면 순환 참조가 된다.
 * 프레즌스는 "내 상태가 이렇게 바뀌었다"만 알리고, 그걸 누구에게 전할지는 친구 도메인이 정한다.</p>
 *
 * <p><b>왜 하트비트마다가 아니라 전이에만</b> — 20초마다 도는 비트를 그대로 전파하면 친구 수만큼
 * 곱해진 fan-out이 상시로 흐른다. 값이 그대로인 비트는 받는 쪽에서 버릴 정보라 아예 보내지 않는다.</p>
 */
public record PresenceChangedEvent(Long userId, PresenceSnapshot snapshot) {

    public static PresenceChangedEvent online(Long userId, String roomId) {
        return new PresenceChangedEvent(userId, PresenceSnapshot.online(roomId));
    }

    public static PresenceChangedEvent offline(Long userId) {
        return new PresenceChangedEvent(userId, PresenceSnapshot.OFFLINE);
    }
}
