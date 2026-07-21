package ssafy.a706.backend.auth.oauth;

import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

/**
 * ERD v0.2 OAUTH_ACCOUNT.provider.
 * 명세 path 파라미터(google·kakao·naver)를 대문자 enum으로 매핑한다.
 * 현재 GOOGLE·KAKAO만 지원하며, 그 외(naver 포함)는 미지원으로 400을 던진다.
 */
public enum OauthProvider {
    GOOGLE, KAKAO;

    /** 명세 path의 provider 문자열 → enum. 미지원 값은 UNSUPPORTED_OAUTH_PROVIDER(400). */
    public static OauthProvider from(String path) {
        if (path != null) {
            try {
                return OauthProvider.valueOf(path.trim().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // 아래 공통 예외로 처리
            }
        }
        throw new BusinessException(ErrorCode.UNSUPPORTED_OAUTH_PROVIDER);
    }
}
