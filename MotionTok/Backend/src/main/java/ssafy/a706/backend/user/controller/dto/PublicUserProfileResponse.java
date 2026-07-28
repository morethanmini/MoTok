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
        String avatarUrl
) {
    public static PublicUserProfileResponse from(User user) {
        return new PublicUserProfileResponse(
                user.getId(), user.getNickname(), user.getCreatedAt(), user.getAvatarUrl());
    }
}
