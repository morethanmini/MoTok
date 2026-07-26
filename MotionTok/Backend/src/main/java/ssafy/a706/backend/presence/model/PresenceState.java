package ssafy.a706.backend.presence.model;

/**
 * 친구 목록에 노출되는 접속 상태. 프론트 Presence 타입과 이름이 1:1로 대응한다.
 *
 * <p>OFFLINE은 "presence 키가 없다"로 판정한다 — 하트비트가 끊기면 TTL이 키를 지우므로,
 * 오프라인 전이를 위한 별도 쓰기가 필요 없다.</p>
 */
public enum PresenceState {
    /** 접속했지만 방 밖(로비·마이페이지 등). */
    ONLINE,
    /** 방 안. currentRoomId가 함께 채워진다. */
    IN_ROOM,
    /** 하트비트가 없거나 끊긴 상태. */
    OFFLINE
}
