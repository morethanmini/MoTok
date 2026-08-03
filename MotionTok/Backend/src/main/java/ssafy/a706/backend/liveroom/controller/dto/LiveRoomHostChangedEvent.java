package ssafy.a706.backend.liveroom.controller.dto;

/**
 * /topic/rooms/{roomId}/members로 방송되는 방장 위임 알림(S15P11A706-72, -180).
 *
 * <p>{@code hostReason}은 안내 문구를 가르기 위한 것이다 — 자동 이양이면 "방장이 나가서",
 * 수동 위임이면 "방장이 넘겨줘서"로 원인이 정반대다(전자는 방에 없고 후자는 그대로 있다).
 * 필드명을 {@code reason}으로 두지 않는 이유: 이 토픽은 판별용 type 필드가 없어 수신 측이
 * 필드 모양으로 이벤트를 가르는데, 강퇴 이벤트가 이미 {@code reason}을 쓴다.</p>
 */
public record LiveRoomHostChangedEvent(
        String hostUserId,
        String hostDisplayName,
        HostChangeReason hostReason
) {
    public enum HostChangeReason {
        /** 방장이 퇴장해 남은 참가자 중 입장 순으로 자동 이양(-72). */
        HOST_LEFT,
        /** 방장이 참가자를 지목해 넘김(-180). */
        DELEGATED
    }
}
