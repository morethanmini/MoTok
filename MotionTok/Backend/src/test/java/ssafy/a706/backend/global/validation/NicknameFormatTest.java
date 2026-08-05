package ssafy.a706.backend.global.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorFactory;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import ssafy.a706.backend.auth.controller.dto.SignupRequest;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.global.text.ProfanityWordlist;
import ssafy.a706.backend.user.controller.dto.UpdateProfileRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 닉네임 문자 규칙({@link NicknameFormat}) — 공백·특수문자 차단.
 *
 * <p>실제 DB의 기존 닉네임 90건을 이 규칙으로 훑어 4건이 걸렸고(공백 2건 · {@code ?} · {@code .}),
 * 그 4건은 DB에서 정리했다. 여기서는 <b>다시 들어오지 못하는지</b>를 고정한다.</p>
 *
 * <p>DTO를 통해 검증하는 이유 — 애너테이션이 실제로 필드에 붙어 있는지까지 함께 확인한다.
 * 정규식만 단독으로 시험하면 애너테이션을 빼먹어도 테스트가 통과한다.</p>
 */
class NicknameFormatTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    /**
     * {@code NoProfanityValidator} 는 {@link ProfanityFilter} 를 주입받으므로 기본 팩토리가
     * 생성하지 못한다(HV000064). Spring 컨텍스트를 띄우는 대신 그 하나만 손으로 넣는다 —
     * 이 테스트가 확인할 것은 문자 규칙이고, DB·웹 계층은 필요하지 않다.
     */
    @BeforeAll
    static void setUp() {
        ProfanityFilter profanityFilter = new ProfanityFilter(new ProfanityWordlist());
        factory = Validation.byDefaultProvider()
                .configure()
                .constraintValidatorFactory(new ConstraintValidatorFactory() {
                    @Override
                    public <T extends ConstraintValidator<?, ?>> T getInstance(Class<T> key) {
                        if (key == NoProfanityValidator.class) {
                            return key.cast(new NoProfanityValidator(profanityFilter));
                        }
                        try {
                            return key.getDeclaredConstructor().newInstance();
                        } catch (ReflectiveOperationException e) {
                            throw new IllegalStateException(key.getName(), e);
                        }
                    }

                    @Override
                    public void releaseInstance(ConstraintValidator<?, ?> instance) {
                        // 보관하지 않으므로 반납할 것이 없다
                    }
                })
                .buildValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    /** 닉네임 위반만 세도록 다른 필드는 전부 유효한 값으로 채운다. */
    private static long signupNicknameViolations(String nickname) {
        return validator.validate(new SignupRequest("a@b.com", "Passw0rd!", nickname, "token"))
                .stream()
                .filter(v -> "nickname".equals(v.getPropertyPath().toString()))
                .count();
    }

    private static long updateNicknameViolations(String nickname) {
        return validator.validate(new UpdateProfileRequest(nickname)).size();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "모션톡",              // 한글 음절
            "MoToK",              // 영문 대소문자
            "test1",              // 영문 + 숫자
            "IQ50",
            "테스트1",             // 한글 + 숫자
            "ㅇㅇ",                // 호환 자모 — \p{IsHangul}에 포함된다
            "ㅁㄴㅇㄹㄻㄴㅇ",
            "dong99u",
            "WInterI5Coming",
    })
    @DisplayName("한글·영문·숫자만으로 된 닉네임은 통과한다")
    void accepts_hangul_latin_digits(String nickname) {
        assertThat(signupNicknameViolations(nickname)).isZero();
        assertThat(updateNicknameViolations(nickname)).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "T1도란 나가라",        // 공백 — DB에 실제로 있던 형태
            "하피는 똥싸개 유튜버",
            " 모션톡",              // 앞 공백
            "모션톡 ",              // 뒤 공백
            "모션 톡",              // 가운데 공백
    })
    @DisplayName("공백이 들어가면 거절한다 — 위치와 무관하게")
    void rejects_whitespace(String nickname) {
        assertThat(signupNicknameViolations(nickname)).isPositive();
        assertThat(updateNicknameViolations(nickname)).isPositive();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "감사합니다.",          // DB에 실제로 있던 형태
            "3명이서회식이될까요?",
            "모션톡!",
            "mo_tok",              // 밑줄도 특수문자다
            "mo-tok",
            "mo@tok",
            "'OR'1'='1",           // 주입 시도 형태 — 애초에 저장되지 않는다
            "<script>",
            "모션톡😀",             // 이모지
    })
    @DisplayName("특수문자·이모지가 들어가면 거절한다")
    void rejects_special_characters(String nickname) {
        assertThat(signupNicknameViolations(nickname)).isPositive();
        assertThat(updateNicknameViolations(nickname)).isPositive();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "모션톡​",        // 제로폭 공백 — 눈에 같은 닉네임을 여럿 만든다
            "모션톡‮",        // RTL override — 표시 순서를 뒤집는다
            "모션톡﻿",        // BOM
            "모션	톡",        // 탭
            "모션\n톡",            // 개행 — trim()을 통과해 로그를 위조한다
    })
    @DisplayName("눈에 보이지 않는 문자를 거절한다 — 허용 목록에 없으므로 열거하지 않아도 걸린다")
    void rejects_invisible_characters(String nickname) {
        assertThat(signupNicknameViolations(nickname)).isPositive();
        assertThat(updateNicknameViolations(nickname)).isPositive();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "аdmin",               // 첫 글자가 키릴 а(U+0430) — 라틴 a가 아니다
            "𝗮 dmin",   // 수학 볼드 𝗮
            "ａｄｍｉｎ",             // 전각 라틴
    })
    @DisplayName("라틴·한글이 아닌 스크립트로 사칭하는 닉네임을 거절한다")
    void rejects_confusable_scripts(String nickname) {
        assertThat(signupNicknameViolations(nickname)).isPositive();
        assertThat(updateNicknameViolations(nickname)).isPositive();
    }

    @Test
    @DisplayName("서버가 만드는 닉네임은 이 규칙을 타지 않는다 — 규칙을 DB 제약으로 내리면 안 되는 이유")
    void server_generated_nicknames_would_fail_this_rule() {
        // 탈퇴 묘비. 길이 초과는 선점 공격을 막는 의도된 장치다(User.softDelete 주석).
        assertThat(signupNicknameViolations(String.format("deleted_%019d", 4))).isPositive();
        // 소셜 최초 로그인 자리표시자.
        assertThat(signupNicknameViolations("pending_0123456789abcdef0123")).isPositive();
        // 둘 다 요청 DTO를 지나지 않으므로 실제 동작에는 영향이 없다 —
        // 이 테스트는 "DB CHECK 제약으로 옮기면 탈퇴·소셜 가입이 깨진다"는 사실을 고정한다.
    }
}
