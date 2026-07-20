package ssafy.a706.backend.global.response;

import java.time.OffsetDateTime;

/**
 * API 명세서 v0.2.1 Error 스키마. 모든 오류 응답 본문은 이 형식이다.
 */
public record ErrorResponse(String code, String message, String path, OffsetDateTime timestamp) {

    public static ErrorResponse of(String code, String message, String path) {
        return new ErrorResponse(code, message, path, OffsetDateTime.now());
    }
}
