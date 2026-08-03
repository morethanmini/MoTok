package ssafy.a706.backend.user.controller.dto;

import ssafy.a706.backend.user.entity.User;

import java.time.LocalDateTime;

/**
 * 다른 사용자의 공개 프로필 (명세서 v0.2.15 PublicUserProfile, -96 랭킹에서 프로필 조회).
 * 이메일·포인트·권한 같은 비공개 정보는 담지 않는다.
 */
public record PublicUserProfileResponse(
        Long id,
        String nickname,
        LocalDateTime createdAt,
        /** 프로필 사진은 공개 정보다 — 랭킹·친구 목록에서 보여준다. */
        String avatarUrl,
        /** 총 접속시간(초, -141 친구 상세). 집계 시작(배포) 이전 접속은 포함하지 않는다. */
        long totalConnectSeconds,
        /**
         * 마지막 접속 종료 시각(-179). 가입일·총 접속시간과 같은 성격의 <b>기록</b>이라
         * 접속 여부와 무관하게 늘 싣는다 — 지금 접속 중인지는 친구 목록의 상태 점이 알려준다.
         *
         * <p>출처는 {@code user_connect_times.updated_at}이고 오프라인 정산 스윕(60초)에서만
         * 갱신된다. 배포 이후 한 번도 정산되지 않은 계정은 null.</p>
         */
        LocalDateTime lastSeenAt
) {
    public static PublicUserProfileResponse from(User user, long totalConnectSeconds,
                                                 LocalDateTime lastSeenAt) {
        return new PublicUserProfileResponse(
                user.getId(), user.getNickname(), user.getCreatedAt(), user.getAvatarUrl(),
                totalConnectSeconds, lastSeenAt);
    }
}
