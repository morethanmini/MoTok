package ssafy.a706.backend.presence.model;

/**
 * 한 사용자의 접속 상태 한 장. roomId는 IN_ROOM일 때만 값이 있다.
 *
 * @param state  ONLINE · IN_ROOM · OFFLINE
 * @param roomId 현재 방 — 친구방 입장(-98)이 이 값을 쓴다
 */
public record PresenceSnapshot(PresenceState state, String roomId) {

    public static final PresenceSnapshot OFFLINE = new PresenceSnapshot(PresenceState.OFFLINE, null);

    /** roomId가 있으면 IN_ROOM, 없으면 ONLINE — 접속 여부는 키 존재로 이미 확인된 상태에서 부른다. */
    public static PresenceSnapshot online(String roomId) {
        return roomId == null || roomId.isBlank()
                ? new PresenceSnapshot(PresenceState.ONLINE, null)
                : new PresenceSnapshot(PresenceState.IN_ROOM, roomId);
    }
}
