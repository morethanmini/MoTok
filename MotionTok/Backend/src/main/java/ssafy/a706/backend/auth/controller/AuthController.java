package ssafy.a706.backend.auth.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ssafy.a706.backend.auth.cookie.RefreshCookies;
import ssafy.a706.backend.auth.service.AuthService;
import ssafy.a706.backend.auth.controller.dto.*;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.password.PasswordResetService;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.auth.ratelimit.GuestStartLimiter;
import ssafy.a706.backend.global.validation.NicknameFormat;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/**
 * API 명세서 v0.2.1 인증 도메인.
 * 이번 작업 범위: 이메일 회원가입(중복확인 → 인증번호 → 검증 → 가입)과 JWT Access/Refresh 인증.
 * 소셜 로그인·계정 찾기·비밀번호 재설정은 후속 작업.
 *
 * <p>Refresh 토큰은 응답 본문에 담지 않고 HttpOnly 쿠키로만 오간다({@link RefreshCookies}).
 * 클라이언트가 값을 읽을 일이 없으므로 토큰을 다루는 코드도 이 컨트롤러 밖으로 나가지 않는다.</p>
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Validated
public class AuthController {

    private final AuthService authService;
    private final EmailVerificationService emailVerificationService;
    private final PasswordResetService passwordResetService;
    private final GuestStartLimiter guestStartLimiter;

    /** GET /auth/availability/email — 이메일 중복 확인 */
    @GetMapping("/availability/email")
    public AvailabilityResponse availabilityEmail(@RequestParam @NotBlank String email) {
        return authService.checkEmail(email);
    }

    /**
     * GET /auth/availability/nickname — 닉네임 중복 확인.
     * 가입과 <b>같은</b> 길이·문자 규칙을 건다 — 여기서 "쓸 수 있다"고 답한 닉네임을
     * 가입에서 거절하면 사용자는 어디가 틀렸는지 모른 채 같은 값을 다시 넣는다.
     */
    @GetMapping("/availability/nickname")
    public AvailabilityResponse availabilityNickname(
            @RequestParam @NotBlank @Size(min = 2, max = 16) @NicknameFormat String nickname) {
        return authService.checkNickname(nickname);
    }

    /** POST /auth/email/verify-request — 6자리 인증번호 발송 */
    @PostMapping("/email/verify-request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void sendVerificationCode(@Valid @RequestBody EmailVerifyRequest req) {
        emailVerificationService.sendCode(req.email());
    }

    /** POST /auth/email/verify — 인증번호 확인, verificationToken 발급 */
    @PostMapping("/email/verify")
    public EmailVerifyResult verifyCode(@Valid @RequestBody EmailVerifyConfirm req) {
        return emailVerificationService.verifyCode(req.email(), req.code());
    }

    /** POST /auth/signup — 회원가입 */
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public UserProfileResponse signup(@Valid @RequestBody SignupRequest req) {
        return authService.signup(req);
    }

    /**
     * POST /auth/login — 일반 로그인. Refresh 토큰은 Set-Cookie로 나간다(rememberMe면 영구 쿠키).
     *
     * <p>옛 Refresh 쿠키를 함께 읽는 이유 — 쿠키 Path가 {@code /api/auth}라 이 요청에도 실려 온다.
     * 로그아웃 없이 탭을 닫았다 다시 로그인하면 서버측 세션이 남아 있어 자기 자신을 "다른 곳"으로
     * 오판하는데, 이 값이 그걸 가려낸다({@code SessionTerminator.displacePrevious}).</p>
     */
    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(
            @Valid @RequestBody LoginRequest req,
            @CookieValue(name = RefreshCookies.NAME, required = false) String staleRefreshToken,
            HttpServletRequest http) {
        return respond(authService.login(req, staleRefreshToken), http);
    }

    /** POST /auth/find-id — 닉네임으로 마스킹된 이메일 찾기 */
    @PostMapping("/find-id")
    public FindIdResponse findId(@Valid @RequestBody FindIdRequest req) {
        return authService.findId(req.nickname());
    }

    /** POST /auth/social/{provider} — 소셜 로그인(google·kakao). 최초 로그인 시 계정 자동 생성·연동 */
    @PostMapping("/social/{provider}")
    public ResponseEntity<TokenResponse> social(
            @PathVariable String provider,
            @Valid @RequestBody SocialLoginRequest req,
            @CookieValue(name = RefreshCookies.NAME, required = false) String staleRefreshToken,
            HttpServletRequest http) {
        return respond(authService.socialLogin(provider, req, staleRefreshToken), http);
    }

    /** POST /auth/password/reset-request — 재설정 링크 메일 발송(존재 여부 무관 202) */
    @PostMapping("/password/reset-request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void requestPasswordReset(@Valid @RequestBody PasswordResetRequest req) {
        passwordResetService.requestReset(req.email());
    }

    /** POST /auth/password/reset — 1회용 토큰으로 새 비밀번호 설정 */
    @PostMapping("/password/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@Valid @RequestBody PasswordResetConfirm req) {
        passwordResetService.resetPassword(req.token(), req.newPassword());
    }

    /**
     * POST /auth/token/refresh — Access 토큰 재발급. 요청 본문은 없고 Refresh 쿠키를 읽는다.
     * 회전이 일어나면 새 쿠키가 함께 나가고, 동시 요청(grace)이면 쿠키는 건드리지 않는다.
     */
    @PostMapping("/token/refresh")
    public ResponseEntity<TokenResponse> refresh(
            @CookieValue(name = RefreshCookies.NAME, required = false) String refreshToken,
            HttpServletRequest http) {
        return respond(authService.refresh(refreshToken), http);
    }

    /**
     * POST /auth/logout — 서버측 Refresh 토큰 무효화 + 쿠키 삭제.
     * 게스트 토큰(GuestPrincipal)은 서버측 상태가 없으므로 Redis는 no-op — MemberPrincipal로 좁혀 받으면
     * 타입 불일치로 principal이 null 주입돼 NPE(500)가 나므로 공통 인터페이스로 받는다.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AuthPrincipal principal, HttpServletRequest http) {
        if (principal instanceof MemberPrincipal member) {
            authService.logout(member.id());
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, RefreshCookies.clear(http))
                .build();
    }

    /**
     * POST /auth/guest — 게스트 시작. 임시 닉네임 부여 + 1인방 자동 생성(공개방 미노출)(-109).
     * 회원에서 게스트로 내려오는 경우가 있어 Refresh 쿠키를 지운다 — 안 지우면 게스트로 쓰는 동안
     * 옛 회원 세션이 쿠키에 남아 다음 갱신에서 되살아난다.
     */
    @PostMapping("/guest")
    public ResponseEntity<GuestResponse> guest(HttpServletRequest http) {
        // 호출마다 24시간짜리 1인방이 생기는 비인증 엔드포인트라 IP 기준으로 빈도를 막는다.
        guestStartLimiter.ensureAllowed(http);
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.SET_COOKIE, RefreshCookies.clear(http))
                .body(authService.guestLogin());
    }

    /** 발급 결과를 응답으로 옮긴다 — 회전된 Refresh 토큰이 있을 때만 쿠키를 새로 심는다. */
    private ResponseEntity<TokenResponse> respond(IssuedTokens issued, HttpServletRequest http) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.ok();
        if (issued.refreshToken() != null) {
            builder.header(HttpHeaders.SET_COOKIE, RefreshCookies.issue(
                    http, issued.refreshToken(), issued.refreshTtl(), issued.persistent()));
        }
        return builder.body(issued.body());
    }
}
