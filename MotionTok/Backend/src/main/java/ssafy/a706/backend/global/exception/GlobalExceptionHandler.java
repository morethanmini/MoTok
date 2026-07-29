package ssafy.a706.backend.global.exception;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import ssafy.a706.backend.global.response.ErrorResponse;

/**
 * 모든 오류 응답을 API 명세서 Error 스키마({code, message, path, timestamp})로 통일한다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e, HttpServletRequest req) {
        ErrorCode ec = e.getErrorCode();
        return ResponseEntity.status(ec.getStatus())
                .body(ErrorResponse.of(ec.getCode(), e.getMessage(), req.getRequestURI()));
    }

    /**
     * Bean Validation 실패 — 첫 번째 필드 오류 메시지를 노출한다.
     * 비속어 위반(@NoProfanity)만은 FE가 별도 안내를 띄울 수 있게 PROFANITY_DETECTED 코드로 구분한다(-152).
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException e, HttpServletRequest req) {
        boolean profanity = e.getBindingResult().getFieldErrors().stream()
                .anyMatch(fe -> "NoProfanity".equals(fe.getCode()));
        ErrorCode ec = profanity ? ErrorCode.PROFANITY_DETECTED : ErrorCode.INVALID_INPUT;
        String msg = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .orElse(ec.getMessage());
        return ResponseEntity.status(ec.getStatus())
                .body(ErrorResponse.of(ec.getCode(), msg, req.getRequestURI()));
    }

    /** 요청 본문을 읽을 수 없는 경우(잘못된 JSON·인코딩 등) — 클라이언트 오류이므로 400. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleNotReadable(HttpMessageNotReadableException e, HttpServletRequest req) {
        return badRequest("요청 본문을 읽을 수 없습니다.", req);
    }

    /** @RequestParam 등 메서드 파라미터 검증 실패 — 400. */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ErrorResponse> handleMethodValidation(HandlerMethodValidationException e,
                                                                HttpServletRequest req) {
        return badRequest(ErrorCode.INVALID_INPUT.getMessage(), req);
    }

    /** 필수 쿼리 파라미터 누락 — 400. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParam(MissingServletRequestParameterException e,
                                                            HttpServletRequest req) {
        return badRequest("필수 파라미터가 없습니다: " + e.getParameterName(), req);
    }

    /** @RequestParam 타입 불일치(예: int에 "abc") — 400. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e,
                                                             HttpServletRequest req) {
        return badRequest("파라미터 형식이 올바르지 않습니다: " + e.getName(), req);
    }

    private ResponseEntity<ErrorResponse> badRequest(String message, HttpServletRequest req) {
        ErrorCode ec = ErrorCode.INVALID_INPUT;
        return ResponseEntity.status(ec.getStatus())
                .body(ErrorResponse.of(ec.getCode(), message, req.getRequestURI()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleEtc(Exception e, HttpServletRequest req) {
        log.error("처리되지 않은 예외: {}", req.getRequestURI(), e);
        ErrorCode ec = ErrorCode.INTERNAL_ERROR;
        return ResponseEntity.status(ec.getStatus())
                .body(ErrorResponse.of(ec.getCode(), ec.getMessage(), req.getRequestURI()));
    }
}
