package ssafy.a706.backend.auth.controller.dto;

/** API 명세서 EmailVerifyResult 스키마 (v0.2.1). */
public record EmailVerifyResult(String verificationToken, long expiresIn) {
}
