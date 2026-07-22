package ssafy.a706.backend.liveroom.controller.dto;

import ssafy.a706.backend.liveroom.model.KickReason;

/** /topic/rooms/{roomId}/members로 방송되는 강퇴 알림(S15P11A706-73). */
public record LiveRoomMemberKickedEvent(
        String userId,
        String displayName,
        KickReason reason,
        int participantCount
) {
}
