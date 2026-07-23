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
        LocalDateTime createdAt,
        /** true면 소셜 최초 로그인 직후라 nickname이 임시값이고, 닉네임 설정을 마쳐야 한다(-22). */
        boolean nicknamePending,
        /**
         * 비밀번호가 없는 소셜 전용 계정 여부(-111).
         * email이 있어도 소셜로만 만들어진 계정이 있어 email 유무로는 판별할 수 없다.
         * 클라이언트는 이 값으로 비밀번호 변경 노출 여부와 탈퇴 시 본인 확인 방식을 정한다.
         */
        boolean socialOnly
) {
    public static UserProfileResponse from(User user) {
        return new UserProfileResponse(
                user.getId(),
                user.getEmail(),
                user.getNickname(),
                user.getRole().name(),
                user.getPointBalance(),
                user.getCreatedAt(),
                user.isNicknamePending(),
                user.isSocialOnly());
    }
}
