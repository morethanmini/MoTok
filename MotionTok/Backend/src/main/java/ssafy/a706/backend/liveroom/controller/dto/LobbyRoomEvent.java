package ssafy.a706.backend.liveroom.controller.dto;

/**
 * {@code /topic/lobby/rooms}로 나가는 방 변화 한 건(-148).
 *
 * <p><b>봉투에 type을 둔 이유</b> — 기존 {@code /topic/rooms/{id}/members} 토픽은 판별 필드가 없어
 * 프론트가 "title이 있으면 방 수정, hostUserId가 있으면 방장 변경..." 식으로 필드 모양을 보고
 * 추측 분기하고 있다. 새로 만드는 계약에서까지 같은 부채를 지지 않는다.</p>
 *
 * <p><b>왜 목록 전체가 아니라 방 한 건인가</b> — 변화가 생길 때마다 목록 전체를 다시 계산해
 * 뿌리면 폴링보다 나빠질 수 있다(목록 1회 계산이 Redis 왕복 수십 회). 바뀐 방만 실어 보내고
 * 프론트가 들고 있는 목록을 그 자리에서 기운다. 첫 진입 스냅샷은 기존 {@code GET /v1/live-rooms}
 * 그대로다 — push는 델타만 담당한다.</p>
 *
 * @param room CLOSED면 null. 그 외에는 갱신된 요약 전체(프론트가 카드를 통째로 교체하면 된다)
 */
public record LobbyRoomEvent(String type, String roomId, LiveRoomSummaryResponse room) {

    private static final String CREATED = "ROOM_CREATED";
    private static final String UPDATED = "ROOM_UPDATED";
    private static final String CLOSED = "ROOM_CLOSED";

    public static LobbyRoomEvent created(LiveRoomSummaryResponse room) {
        return new LobbyRoomEvent(CREATED, room.roomId(), room);
    }

    /** 참가자 수·상태·방 정보 등 무엇이 바뀌었든 갱신된 요약 한 장으로 표현한다. */
    public static LobbyRoomEvent updated(LiveRoomSummaryResponse room) {
        return new LobbyRoomEvent(UPDATED, room.roomId(), room);
    }

    public static LobbyRoomEvent closed(String roomId) {
        return new LobbyRoomEvent(CLOSED, roomId, null);
    }

    public boolean isCreated() {
        return CREATED.equals(type);
    }

    public boolean isClosed() {
        return CLOSED.equals(type);
    }
}
