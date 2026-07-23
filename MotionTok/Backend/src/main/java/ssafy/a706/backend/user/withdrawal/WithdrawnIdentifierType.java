package ssafy.a706.backend.user.withdrawal;

/** 재가입 제한을 걸어 둘 식별자 종류. EMAIL은 자체 가입, SOCIAL은 provider별 소셜 계정. */
public enum WithdrawnIdentifierType {
    EMAIL,
    SOCIAL
}
