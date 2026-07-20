package ssafy.a706.backend.auth.dto;

public record TokenResponse(
        String accessToken,
        String userId,
        String nickname,
        boolean guest
) {
}
