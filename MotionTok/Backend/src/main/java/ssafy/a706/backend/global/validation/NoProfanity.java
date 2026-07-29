package ssafy.a706.backend.global.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 비속어 포함 금지(S15P11A706-152) — 닉네임·방 제목처럼 마스킹이 부적합한 "거절" 정책 필드에 붙인다.
 * (채팅류는 거절이 아니라 서비스 계층에서 마스킹한다 — ProfanityFilter.mask 참고.)
 *
 * 위반 시 GlobalExceptionHandler가 PROFANITY_DETECTED 코드로 응답한다(FE 안내 분기용).
 */
@Documented
@Constraint(validatedBy = NoProfanityValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface NoProfanity {

    String message() default "비속어가 포함되어 있습니다. 표현을 바꿔 주세요.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
