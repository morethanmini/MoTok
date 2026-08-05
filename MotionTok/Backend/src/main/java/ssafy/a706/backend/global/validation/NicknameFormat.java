package ssafy.a706.backend.global.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.ReportAsSingleViolation;
import jakarta.validation.constraints.Pattern;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 닉네임 문자 종류 제한 — 한글·영문·숫자만. 공백·밑줄·문장부호를 모두 거절한다.
 *
 * <p><b>SQL 주입 대비가 아니다.</b> 닉네임이 지나는 모든 조회는 Spring Data JPA 파생 쿼리라
 * 바인드 파라미터로 넘어가고(네이티브 쿼리·문자열 연결이 저장소에 하나도 없다), 화면도
 * {@code v-html} 을 쓰지 않아 XSS 경로가 없다. 막으려는 것은 <b>사람이 속는 닉네임</b>이다.</p>
 *
 * <ul>
 *   <li>동형이의어 사칭 — 키릴 {@code а}, 수학 볼드 {@code 𝗮} 로 남의 이름을 흉내 내면
 *       UNIQUE 제약은 코드포인트가 달라 통과시킨다. 신고·제재 화면에서 관리자가 대상을 잘못 짚는다.</li>
 *   <li>제로폭 문자({@code U+200B}) — 눈에 같은 닉네임을 여러 개 만든다. {@code trim()} 이 못 잡는다.</li>
 *   <li>RTL override({@code U+202E}) — 표시 순서를 뒤집어 채팅·랭킹에서 다른 글자로 읽히게 한다.</li>
 *   <li>제어문자·개행 — 문자열 <b>중간</b>의 {@code \n} 은 {@code trim()} 을 통과해 로그를 위조한다.</li>
 * </ul>
 *
 * <p>허용 목록 방식이라 위 문자들은 하나하나 열거하지 않아도 전부 걸린다 —
 * 새로 등장하는 유니코드 장난도 목록에 없으면 자동으로 막힌다.</p>
 *
 * <p>영문을 {@code \p{IsLatin}} 이 아니라 {@code a-zA-Z} 로 적은 이유 —
 * <b>전각 라틴({@code ａｄｍｉｎ}, U+FF41~)도 Script=Latin 이다.</b> 스크립트 속성으로 받으면
 * 전각으로 {@code admin} 을 사칭할 수 있어 이 규칙을 만든 이유가 무너진다(테스트로 확인했다).
 * 악센트 문자({@code é}·{@code ñ})도 함께 빠지지만 한국어 서비스라 잃는 것이 없다.</p>
 *
 * <p>숫자를 {@code 0-9} 로 따로 적은 이유 — 아라비아 숫자는 Script=Common 이라 어느 스크립트에도
 * 속하지 않는다. 한글은 {@code \p{IsHangul}} 로 받는다 — 완성형 음절과 호환 자모를 함께 덮으므로
 * {@code ㅇㅇ} 같은 자모 닉네임도 통과한다(전각 한글이라는 것은 없어 같은 함정이 없다).</p>
 *
 * <p><b>서버가 만드는 닉네임에는 붙지 않는다.</b> 탈퇴 묘비({@code deleted_%019d}, 27자)와
 * 소셜 최초 로그인 자리표시자({@code pending_} + UUID 20자)는 {@code _} 를 담고 길이도 16자를
 * 넘지만 요청 DTO를 타지 않는다. 특히 묘비의 길이 초과는 선점 공격을 막는 <b>의도된 장치</b>라
 * (User.softDelete 주석 참고) 이 규칙을 DB CHECK 제약으로 내리면 탈퇴·소셜 가입이 깨진다.</p>
 */
@Documented
@Pattern(regexp = "^[\\p{IsHangul}a-zA-Z0-9]+$")
@ReportAsSingleViolation
@Constraint(validatedBy = {})
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface NicknameFormat {

    String message() default "닉네임은 한글·영문·숫자만 쓸 수 있습니다(공백·특수문자 불가).";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
