package ssafy.a706.backend.liveroom.model;

/** room:{roomId}:members 해시 필드 값(JSON)의 역직렬화 형태. */
public record LiveRoomMemberValue(
        String userId,
        String displayName,
        boolean guest,
        long joinedAt
) {
}
