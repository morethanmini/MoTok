package ssafy.a706.backend.global.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import lombok.RequiredArgsConstructor;
import ssafy.a706.backend.global.text.ProfanityFilter;

/** null/빈 값은 통과시킨다 — 필수 여부는 @NotBlank 몫. */
@RequiredArgsConstructor
public class NoProfanityValidator implements ConstraintValidator<NoProfanity, String> {

    private final ProfanityFilter profanityFilter;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return !profanityFilter.contains(value);
    }
}
