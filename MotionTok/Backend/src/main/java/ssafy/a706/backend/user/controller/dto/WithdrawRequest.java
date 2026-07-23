package ssafy.a706.backend.user.controller.dto;

/**
 * DELETE /users/me 본인 확인 (명세서 v0.2.15, -111).
 *
 * 자체 가입 계정은 password로, 소셜 전용 계정(비밀번호 없음)은 소셜 재인증으로 본인을 확인한다.
 * 소셜 전용 계정에게 비밀번호를 요구하면 탈퇴 자체가 불가능해지므로 두 경로를 모두 연다.
 * 둘 다 비어 있으면 400(USER_WITHDRAW_REAUTH_REQUIRED).
 */
public record WithdrawRequest(
        /** 자체 가입 계정의 현재 비밀번호. */
        String password,
        /** 소셜 전용 계정 재인증 — 연동된 provider(google·kakao). */
        String provider,
        /** 소셜 전용 계정 재인증 — 방금 받은 OAuth 인가 코드. */
        String authorizationCode,
        /** 소셜 전용 계정 재인증 — 인가 코드를 받은 리다이렉트 URI. */
        String redirectUri
) {
    public boolean hasPassword() {
        return password != null && !password.isBlank();
    }

    public boolean hasSocialProof() {
        return provider != null && !provider.isBlank()
                && authorizationCode != null && !authorizationCode.isBlank();
    }
}
