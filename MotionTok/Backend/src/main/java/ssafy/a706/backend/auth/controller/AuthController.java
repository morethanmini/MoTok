package ssafy.a706.backend.auth.controller;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ssafy.a706.backend.auth.service.AuthService;
import ssafy.a706.backend.auth.controller.dto.*;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.password.PasswordResetService;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/**
 * API 명세서 v0.2.1 인증 도메인.
 * 이번 작업 범위: 이메일 회원가입(중복확인 → 인증번호 → 검증 → 가입)과 JWT Access/Refresh 인증.
 * 소셜 로그인·계정 찾기·비밀번호 재설정은 후속 작업.
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Validated
public class AuthController {

    private final AuthService authService;
    private final EmailVerificationService emailVerificationService;
    private final PasswordResetService passwordResetService;

    /** GET /auth/availability/email — 이메일 중복 확인 */
    @GetMapping("/availability/email")
    public AvailabilityResponse availabilityEmail(@RequestParam @NotBlank String email) {
        return authService.checkEmail(email);
    }

    /** GET /auth/availability/nickname — 닉네임 중복 확인 */
    @GetMapping("/availability/nickname")
    public AvailabilityResponse availabilityNickname(@RequestParam @NotBlank String nickname) {
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

    /** POST /auth/login — 일반 로그인 */
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest req) {
        return authService.login(req);
    }

    /** POST /auth/find-id — 닉네임으로 마스킹된 이메일 찾기 */
    @PostMapping("/find-id")
    public FindIdResponse findId(@Valid @RequestBody FindIdRequest req) {
        return authService.findId(req.nickname());
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

    /** POST /auth/token/refresh — Access 토큰 재발급 */
    @PostMapping("/token/refresh")
    public TokenResponse refresh(@Valid @RequestBody RefreshRequest req) {
        return authService.refresh(req);
    }

    /** POST /auth/logout — 서버측 Refresh 토큰 무효화 */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal MemberPrincipal principal) {
        authService.logout(principal.id());
        return ResponseEntity.noContent().build();
    }

    /** POST /auth/guest — 게스트 시작 (명세의 GuestResponse·자동 방 생성은 후속 작업) */
    @PostMapping("/guest")
    public TokenResponse guest(@Valid @RequestBody GuestLoginRequest req) {
        return authService.guestLogin(req);
    }
}
