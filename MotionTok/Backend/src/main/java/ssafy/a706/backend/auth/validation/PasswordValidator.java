package ssafy.a706.backend.auth.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class PasswordValidator implements ConstraintValidator<Password, String> {

    private static final int MIN_LENGTH = 8;
    private static final int MAX_LENGTH = 64;
    private static final int REQUIRED_KINDS = 3;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return false;
        }
        if (value.length() < MIN_LENGTH || value.length() > MAX_LENGTH) {
            return false;
        }
        return countCharacterKinds(value) >= REQUIRED_KINDS;
    }

    /** 소문자·대문자·숫자·특수문자 중 몇 종류가 쓰였는지 센다. */
    private int countCharacterKinds(String value) {
        boolean lower = false, upper = false, digit = false, special = false;
        for (char c : value.toCharArray()) {
            if (Character.isLowerCase(c)) {
                lower = true;
            } else if (Character.isUpperCase(c)) {
                upper = true;
            } else if (Character.isDigit(c)) {
                digit = true;
            } else {
                special = true;
            }
        }
        int kinds = 0;
        if (lower) kinds++;
        if (upper) kinds++;
        if (digit) kinds++;
        if (special) kinds++;
        return kinds;
    }
}
