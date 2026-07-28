package ssafy.a706.backend.presence.controller.dto;

import ssafy.a706.backend.presence.model.PresenceSnapshot;

/**
 * {@code /user/queue/presence} 개인 큐로 나가는 메시지 봉투(-143/-149).
 *
 * <p>한 큐에 두 종류가 흐르므로 <b>{@code type}으로 구분</b>한다. 기존 members 토픽은 판별 필드가
 * 없어 프론트가 필드 모양으로 추측 분기하고 있는데(useRoomChat handleMembersFrame), 새로 만드는
 * 계약에서까지 같은 부채를 지지 않는다.</p>
 *
 * <ul>
 *   <li>{@code BEAT} — 하트비트 간격 정정. 클라이언트가 쓰는 값이 서버와 다를 때만 나간다</li>
 *   <li>{@code FRIEND} — 친구 한 명의 접속 상태 변화. 초기 목록은 REST 스냅샷이고 이후는 델타만</li>
 * </ul>
 *
 * @param intervalSeconds BEAT 전용 — 다음 비트까지의 초
 * @param userId          FRIEND 전용 — 상태가 바뀐 친구
 * @param presence        FRIEND 전용 — ONLINE · IN_ROOM · OFFLINE
 * @param currentRoomId   FRIEND 전용 — IN_ROOM일 때의 방 (친구방 입장 -98이 쓴다)
 */
public record PresenceQueueMessage(
        String type,
        Long intervalSeconds,
        Long userId,
        String presence,
        String currentRoomId) {

    private static final String TYPE_BEAT = "BEAT";
    private static final String TYPE_FRIEND = "FRIEND";

    public static PresenceQueueMessage beat(long intervalSeconds) {
        return new PresenceQueueMessage(TYPE_BEAT, intervalSeconds, null, null, null);
    }

    public static PresenceQueueMessage friend(Long userId, PresenceSnapshot snapshot) {
        return new PresenceQueueMessage(TYPE_FRIEND, null, userId,
                snapshot.state().name(), snapshot.roomId());
    }
}
