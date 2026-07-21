package ssafy.a706.backend.global.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * code 값은 API 명세서 Error 스키마의 code 필드로 그대로 노출된다(예: AUTH_INVALID_CREDENTIALS).
 */
@Getter
public enum ErrorCode {

    // common
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "COMMON_INVALID_INPUT", "잘못된 입력입니다."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "COMMON_UNAUTHORIZED", "인증이 필요합니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "COMMON_FORBIDDEN", "권한이 없습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "COMMON_NOT_FOUND", "리소스를 찾을 수 없습니다."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "COMMON_INTERNAL_ERROR", "서버 오류가 발생했습니다."),

    // auth
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다."),
    INVALID_TOKEN(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다."),
    ACCOUNT_NOT_ACTIVE(HttpStatus.FORBIDDEN, "AUTH_ACCOUNT_NOT_ACTIVE", "이용이 제한된 계정입니다."),

    // 소셜 로그인 (명세서 POST /auth/social/{provider})
    UNSUPPORTED_OAUTH_PROVIDER(HttpStatus.BAD_REQUEST, "AUTH_UNSUPPORTED_OAUTH_PROVIDER", "지원하지 않는 소셜 로그인 제공자입니다."),
    SOCIAL_LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "AUTH_SOCIAL_LOGIN_FAILED", "소셜 로그인에 실패했습니다."),

    // 비밀번호 재설정 (명세서 POST /auth/password/reset)
    PASSWORD_RESET_TOKEN_INVALID(HttpStatus.BAD_REQUEST, "AUTH_PASSWORD_RESET_TOKEN_INVALID", "비밀번호 재설정 링크가 유효하지 않거나 만료되었습니다."),

    // 이메일 인증 (명세서 v0.2.1)
    EMAIL_ALREADY_REGISTERED(HttpStatus.CONFLICT, "AUTH_EMAIL_ALREADY_REGISTERED", "이미 가입된 이메일입니다."),
    NICKNAME_ALREADY_USED(HttpStatus.CONFLICT, "AUTH_NICKNAME_ALREADY_USED", "이미 사용 중인 닉네임입니다."),
    VERIFICATION_CODE_INVALID(HttpStatus.BAD_REQUEST, "AUTH_VERIFICATION_CODE_INVALID", "인증번호가 올바르지 않거나 만료되었습니다."),
    VERIFICATION_TOKEN_INVALID(HttpStatus.BAD_REQUEST, "AUTH_VERIFICATION_TOKEN_INVALID", "이메일 인증이 필요합니다. 인증을 다시 진행해 주세요."),
    RESEND_COOLDOWN(HttpStatus.TOO_MANY_REQUESTS, "AUTH_RESEND_COOLDOWN", "잠시 후 다시 요청해 주세요."),
    SEND_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "AUTH_SEND_LIMIT_EXCEEDED", "하루 인증번호 발송 한도를 초과했습니다."),
    VERIFY_ATTEMPT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "AUTH_VERIFY_ATTEMPT_EXCEEDED", "인증 시도 횟수를 초과했습니다. 인증번호를 다시 요청해 주세요."),

    // user
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "존재하지 않는 계정입니다."),

    // room
    ROOM_NOT_FOUND(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND", "존재하지 않는 방입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "ROOM_FULL", "방 정원이 가득 찼습니다."),
    NOT_ROOM_HOST(HttpStatus.FORBIDDEN, "ROOM_NOT_HOST", "방장만 가능한 동작입니다."),
    ROOM_PASSWORD_REQUIRED(HttpStatus.BAD_REQUEST, "ROOM_PASSWORD_REQUIRED", "비밀번호가 필요합니다."),
    ROOM_INVALID_PASSWORD(HttpStatus.FORBIDDEN, "ROOM_INVALID_PASSWORD", "비밀번호가 올바르지 않습니다."),
    INVITE_CODE_NOT_FOUND(HttpStatus.NOT_FOUND, "INVITE_CODE_NOT_FOUND", "초대코드가 유효하지 않습니다."),

    // game / session
    GAME_NOT_FOUND(HttpStatus.NOT_FOUND, "GAME_NOT_FOUND", "존재하지 않는 게임입니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "존재하지 않는 세션입니다."),

    // signal
    SIGNAL_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "SIGNAL_NOT_IN_ROOM", "방 참가자만 시그널을 보낼 수 있습니다."),
    SIGNAL_TARGET_NOT_FOUND(HttpStatus.NOT_FOUND, "SIGNAL_TARGET_NOT_FOUND", "시그널 수신 대상이 방에 없습니다.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorCode(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }
}
