package ssafy.a706.backend.auth.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.*;

/**
 * 비밀번호 규칙: 12~64자, 영문 소문자·대문자·숫자·특수문자 중 3종 이상 조합.
 * (요구사항 S15P11A706-21 "비밀번호 규칙(길이·조합)"의 구체값 — 프론트 화면 규칙에 맞춰 최소 12자로 통일)
 */
@Documented
@Constraint(validatedBy = PasswordValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface Password {

    String message() default "비밀번호는 12~64자이며, 영문 소문자·대문자·숫자·특수문자 중 3종 이상을 조합해야 합니다.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
