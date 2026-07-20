package ssafy.a706.backend.user.controller.dto;

import ssafy.a706.backend.user.entity.User;

import java.time.LocalDateTime;

/** API 명세서 UserProfile 스키마. */
public record UserProfileResponse(
        Long id,
        String email,
        String nickname,
        String role,
        int pointBalance,
        LocalDateTime createdAt
) {
    public static UserProfileResponse from(User user) {
        return new UserProfileResponse(
                user.getId(),
                user.getEmail(),
                user.getNickname(),
                user.getRole().name(),
                user.getPointBalance(),
                user.getCreatedAt());
    }
}
