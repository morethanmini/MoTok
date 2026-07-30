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
    PROFANITY_DETECTED(HttpStatus.BAD_REQUEST, "COMMON_PROFANITY_DETECTED", "비속어가 포함되어 있습니다. 표현을 바꿔 주세요."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "COMMON_UNAUTHORIZED", "인증이 필요합니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "COMMON_FORBIDDEN", "권한이 없습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "COMMON_NOT_FOUND", "리소스를 찾을 수 없습니다."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "COMMON_INTERNAL_ERROR", "서버 오류가 발생했습니다."),

    // auth
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다."),
    INVALID_TOKEN(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다."),
    // 단일 세션(v0.2.25) — 같은 계정의 새 로그인이 이 세션을 밀어냈다. 클라이언트는 이 코드로
    // "다른 곳에서 로그인" 안내를 띄운다(일반 만료와 문구가 달라야 계정 도용을 알아챌 수 있다).
    SESSION_DISPLACED(HttpStatus.UNAUTHORIZED, "AUTH_SESSION_DISPLACED", "다른 곳에서 로그인되어 로그아웃되었습니다."),
    ACCOUNT_NOT_ACTIVE(HttpStatus.FORBIDDEN, "AUTH_ACCOUNT_NOT_ACTIVE", "이용이 제한된 계정입니다."),
    // 기간 정지는 ACCOUNT_NOT_ACTIVE와 분리한다 — 클라이언트가 "언제 풀리는지"를 안내해야 하는데
    // 영구 제재·탈퇴와 같은 코드로 내려가면 그 구분이 응답에서 사라진다.
    ACCOUNT_SUSPENDED(HttpStatus.FORBIDDEN, "AUTH_ACCOUNT_SUSPENDED", "정지된 계정입니다."),
    // 영구 정지도 코드를 나눈다 — 기간 정지 문구("기간이 끝나면 다시 로그인")를 영구 제재에 띄우면 거짓말이 된다.
    ACCOUNT_BANNED(HttpStatus.FORBIDDEN, "AUTH_ACCOUNT_BANNED", "영구 정지된 계정입니다."),

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

    // 남용 방지 레이트리밋
    LOGIN_ATTEMPTS_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "AUTH_LOGIN_ATTEMPTS_EXCEEDED", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."),
    GUEST_START_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "AUTH_GUEST_START_LIMIT_EXCEEDED", "게스트 시작 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."),

    // 소셜 최초 로그인 닉네임 설정 (명세서 v0.2.15, -22)
    NICKNAME_SETUP_REQUIRED(HttpStatus.FORBIDDEN, "AUTH_NICKNAME_SETUP_REQUIRED", "닉네임 설정을 먼저 완료해 주세요."),

    // 탈퇴·재가입 정책 (명세서 v0.2.15, -111)
    REJOIN_COOLDOWN(HttpStatus.CONFLICT, "AUTH_REJOIN_COOLDOWN", "탈퇴 후 1주일이 지나야 다시 가입할 수 있습니다."),
    WITHDRAW_REAUTH_REQUIRED(HttpStatus.BAD_REQUEST, "USER_WITHDRAW_REAUTH_REQUIRED", "탈퇴하려면 비밀번호를 입력해 주세요."),
    WITHDRAW_SOCIAL_REAUTH_REQUIRED(HttpStatus.BAD_REQUEST, "USER_WITHDRAW_SOCIAL_REAUTH_REQUIRED", "소셜 계정으로 다시 인증해야 탈퇴할 수 있습니다."),

    // user
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "존재하지 않는 계정입니다."),

    // 계정 제재(관리자) — 정지 상태는 Redis TTL, 이력은 sanction_history가 나눠 갖는다
    SANCTION_SELF_FORBIDDEN(HttpStatus.BAD_REQUEST, "SANCTION_SELF_FORBIDDEN", "자기 자신은 제재할 수 없습니다."),
    SANCTION_TARGET_ADMIN(HttpStatus.FORBIDDEN, "SANCTION_TARGET_ADMIN", "관리자는 제재할 수 없습니다."),
    SANCTION_NOT_SUSPENDED(HttpStatus.CONFLICT, "SANCTION_NOT_SUSPENDED", "정지 중인 계정이 아닙니다."),
    SANCTION_ALREADY_BANNED(HttpStatus.CONFLICT, "SANCTION_ALREADY_BANNED", "이미 영구 정지된 계정입니다."),
    // 남의 경고를 확인하려는 요청도 여기로 떨어진다 — 조회 조건에 userId가 들어가 '없음'과 구분되지 않는다.
    // 존재 여부를 알려 주지 않는 쪽이 안전하다.
    SANCTION_WARNING_NOT_FOUND(HttpStatus.NOT_FOUND, "SANCTION_WARNING_NOT_FOUND", "존재하지 않는 경고입니다."),
    SANCTION_NOT_BANNED(HttpStatus.CONFLICT, "SANCTION_NOT_BANNED", "영구 정지된 계정이 아닙니다."),

    // room
    ROOM_NOT_FOUND(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND", "존재하지 않는 방입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "ROOM_FULL", "방 정원이 가득 찼습니다."),
    NOT_ROOM_HOST(HttpStatus.FORBIDDEN, "ROOM_NOT_HOST", "방장만 가능한 동작입니다."),
    ROOM_PASSWORD_REQUIRED(HttpStatus.BAD_REQUEST, "ROOM_PASSWORD_REQUIRED", "비밀번호가 필요합니다."),
    ROOM_INVALID_PASSWORD(HttpStatus.FORBIDDEN, "ROOM_INVALID_PASSWORD", "비밀번호가 올바르지 않습니다."),
    INVITE_CODE_NOT_FOUND(HttpStatus.NOT_FOUND, "INVITE_CODE_NOT_FOUND", "초대코드가 유효하지 않습니다."),
    ROOM_MEMBER_NOT_FOUND(HttpStatus.NOT_FOUND, "ROOM_MEMBER_NOT_FOUND", "방에 존재하지 않는 참가자입니다."),
    ROOM_CANNOT_KICK_SELF(HttpStatus.BAD_REQUEST, "ROOM_CANNOT_KICK_SELF", "자기 자신은 강퇴할 수 없습니다."),
    ROOM_KICKED(HttpStatus.FORBIDDEN, "ROOM_KICKED", "강퇴된 방에는 재입장할 수 없습니다."),
    ROOM_GAME_IN_PROGRESS(HttpStatus.CONFLICT, "ROOM_GAME_IN_PROGRESS", "게임이 진행 중인 방에는 입장할 수 없습니다."),
    ROOM_MAX_PLAYERS_BELOW_CURRENT(HttpStatus.CONFLICT, "ROOM_MAX_PLAYERS_BELOW_CURRENT", "최대 인원은 현재 참가자 수보다 작게 설정할 수 없습니다."),
    QUICK_START_NO_ROOM(HttpStatus.NOT_FOUND, "QUICK_START_NO_ROOM", "입장 가능한 방이 없습니다."),
    ROOM_INVITE_FORBIDDEN(HttpStatus.FORBIDDEN, "ROOM_INVITE_FORBIDDEN", "방 참가자만 친구를 초대할 수 있습니다."),

    // game / session
    GAME_NOT_FOUND(HttpStatus.NOT_FOUND, "GAME_NOT_FOUND", "존재하지 않는 게임입니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "존재하지 않는 세션입니다."),
    GAME_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "GAME_NOT_IN_ROOM", "방 참가자만 게임에 참여할 수 있습니다."),
    GAME_SESSION_ALREADY_ACTIVE(HttpStatus.CONFLICT, "GAME_SESSION_ALREADY_ACTIVE", "이미 게임이 진행 중입니다."),
    GAME_NOT_SETTER(HttpStatus.FORBIDDEN, "GAME_NOT_SETTER", "출제자만 포즈를 제출할 수 있습니다."),
    GAME_NEED_MORE_PLAYERS(HttpStatus.CONFLICT, "GAME_NEED_MORE_PLAYERS", "이 게임은 2명 이상부터 시작할 수 있습니다."),
    GAME_POSE_INVALID(HttpStatus.BAD_REQUEST, "GAME_POSE_INVALID", "포즈 데이터가 올바르지 않습니다."),
    GAME_JUDGE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "GAME_JUDGE_UNAVAILABLE", "AI 채점을 사용할 수 없습니다."),
    GAME_JUDGE_FAILED(HttpStatus.BAD_GATEWAY, "GAME_JUDGE_FAILED", "AI 채점에 실패했습니다."),
    GAME_IMAGE_INVALID(HttpStatus.BAD_REQUEST, "GAME_IMAGE_INVALID", "그림 데이터가 올바르지 않습니다."),

    // signal
    SIGNAL_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "SIGNAL_NOT_IN_ROOM", "방 참가자만 시그널을 보낼 수 있습니다."),
    SIGNAL_TARGET_NOT_FOUND(HttpStatus.NOT_FOUND, "SIGNAL_TARGET_NOT_FOUND", "시그널 수신 대상이 방에 없습니다."),

    // sfu
    SFU_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "SFU_NOT_IN_ROOM", "방 참가자만 화상 접속 토큰을 발급받을 수 있습니다."),

    // shop
    ITEM_NOT_FOUND(HttpStatus.NOT_FOUND, "ITEM_NOT_FOUND", "존재하지 않는 아이템입니다."),
    ITEM_ALREADY_OWNED(HttpStatus.CONFLICT, "ITEM_ALREADY_OWNED", "이미 보유한 아이템입니다."),
    INSUFFICIENT_POINT(HttpStatus.CONFLICT, "INSUFFICIENT_POINT", "포인트가 부족합니다."),

    // shop - AI 아이템 생성 큐 (-102)
    AI_ITEM_SKETCH_TOO_LARGE(HttpStatus.BAD_REQUEST, "AI_ITEM_SKETCH_TOO_LARGE", "스케치 이미지 용량이 너무 큽니다."),
    AI_JOB_NOT_FOUND(HttpStatus.NOT_FOUND, "AI_JOB_NOT_FOUND", "존재하지 않는 AI 아이템 생성 작업입니다."),
    AI_JOB_FORBIDDEN(HttpStatus.FORBIDDEN, "AI_JOB_FORBIDDEN", "본인의 작업만 조회할 수 있습니다."),
    AI_JOB_INVALID_STATE(HttpStatus.CONFLICT, "AI_JOB_INVALID_STATE", "처리 중인 작업이 아닙니다."),
    AI_ITEM_INSUFFICIENT_POINT(HttpStatus.BAD_REQUEST, "AI_ITEM_INSUFFICIENT_POINT", "포인트가 부족합니다."),
    AI_ITEM_RETRY_LIMIT_EXCEEDED(HttpStatus.BAD_REQUEST, "AI_ITEM_RETRY_LIMIT_EXCEEDED", "재생성 가능 횟수를 초과했습니다."),
    INTERNAL_UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "INTERNAL_UNAUTHORIZED", "내부 API 인증에 실패했습니다."),

    // chat
    CHAT_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "CHAT_NOT_IN_ROOM", "방 참가자만 채팅을 보낼 수 있습니다."),
    CHAT_RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "CHAT_RATE_LIMITED", "채팅을 너무 자주 보냈습니다. 잠시 후 다시 시도해 주세요."),

    // chat report
    CHAT_MESSAGE_NOT_FOUND(HttpStatus.NOT_FOUND, "CHAT_MESSAGE_NOT_FOUND", "존재하지 않거나 만료된 채팅입니다."),
    CHAT_REPORT_NOT_IN_ROOM(HttpStatus.FORBIDDEN, "CHAT_REPORT_NOT_IN_ROOM", "방 참가자만 신고할 수 있습니다."),
    CHAT_REPORT_SELF(HttpStatus.BAD_REQUEST, "CHAT_REPORT_SELF", "자신의 채팅은 신고할 수 없습니다."),
    CHAT_REPORT_DUPLICATE(HttpStatus.CONFLICT, "CHAT_REPORT_DUPLICATE", "이미 신고한 채팅입니다."),
    CHAT_REPORT_NOT_FOUND(HttpStatus.NOT_FOUND, "CHAT_REPORT_NOT_FOUND", "존재하지 않는 신고입니다."),

    // user report (-112) — 대상이 없거나 탈퇴·정지된 경우는 USER_NOT_FOUND를 재사용한다(-96과 같은 선)
    USER_REPORT_SELF(HttpStatus.BAD_REQUEST, "USER_REPORT_SELF", "자신은 신고할 수 없습니다."),
    USER_REPORT_DUPLICATE(HttpStatus.CONFLICT, "USER_REPORT_DUPLICATE", "이미 접수된 신고가 처리 중입니다."),
    USER_REPORT_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_REPORT_NOT_FOUND", "존재하지 않는 신고입니다."),

    // decor — 화면 꾸미기 장착 한도(스티커 5개, 가면·효과·배경 각 1개)
    DECOR_EQUIP_LIMIT(HttpStatus.CONFLICT, "DECOR_EQUIP_LIMIT", "더 장착할 수 없습니다. 다른 아이템을 먼저 해제해 주세요."),

    // friend (-57) — 닉네임으로 상대를 못 찾는 경우는 USER_NOT_FOUND를 재사용한다
    FRIEND_SELF_REQUEST(HttpStatus.BAD_REQUEST, "FRIEND_SELF_REQUEST", "자신에게는 친구 요청을 보낼 수 없습니다."),
    FRIEND_ALREADY(HttpStatus.CONFLICT, "FRIEND_ALREADY", "이미 친구입니다."),
    FRIEND_REQUEST_DUPLICATE(HttpStatus.CONFLICT, "FRIEND_REQUEST_DUPLICATE", "이미 보낸 친구 요청이 있습니다."),
    FRIEND_REQUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "FRIEND_REQUEST_NOT_FOUND", "존재하지 않는 친구 요청입니다."),
    FRIEND_REQUEST_FORBIDDEN(HttpStatus.FORBIDDEN, "FRIEND_REQUEST_FORBIDDEN", "이 친구 요청을 처리할 권한이 없습니다."),
    FRIEND_NOT_FOUND(HttpStatus.NOT_FOUND, "FRIEND_NOT_FOUND", "친구가 아닙니다."),

    // 친구 귓속말 (-150) — 전역 STOMP 개인큐 기반 1:1 대화
    // WHISPER_TARGET_OFFLINE은 오프라인 수신함(-160) 도입으로 제거 — 오프라인은 더 이상 실패가 아니다.
    WHISPER_NOT_FRIEND(HttpStatus.FORBIDDEN, "WHISPER_NOT_FRIEND", "친구에게만 귓속말을 보낼 수 있습니다."),

    // 방 초대 (-100)
    INVITATION_DUPLICATE(HttpStatus.CONFLICT, "INVITATION_DUPLICATE", "이미 보낸 초대가 있습니다."),
    INVITATION_NOT_FOUND(HttpStatus.NOT_FOUND, "INVITATION_NOT_FOUND", "존재하지 않거나 만료된 초대입니다."),

    // storage (업로드) — presigned 방식이라 서버가 막을 지점이 정해져 있다(StorageService 주석 참고)
    UPLOAD_UNSUPPORTED_TYPE(HttpStatus.BAD_REQUEST, "UPLOAD_UNSUPPORTED_TYPE", "지원하지 않는 파일 형식입니다."),
    UPLOAD_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "UPLOAD_TOO_LARGE", "파일 용량이 제한을 초과했습니다."),
    UPLOAD_PURPOSE_NOT_PRESIGNABLE(HttpStatus.BAD_REQUEST, "UPLOAD_PURPOSE_NOT_PRESIGNABLE", "직접 업로드할 수 없는 용도입니다."),
    UPLOAD_KEY_FORBIDDEN(HttpStatus.FORBIDDEN, "UPLOAD_KEY_FORBIDDEN", "이 파일에 대한 권한이 없습니다."),
    UPLOAD_OBJECT_NOT_FOUND(HttpStatus.NOT_FOUND, "UPLOAD_OBJECT_NOT_FOUND", "업로드된 파일을 찾을 수 없습니다."),
    STORAGE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_UNAVAILABLE", "파일 저장소에 접근할 수 없습니다.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorCode(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }
}
