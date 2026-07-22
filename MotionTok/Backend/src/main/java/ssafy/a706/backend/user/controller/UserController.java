package ssafy.a706.backend.user.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.user.service.UserService;
import ssafy.a706.backend.user.controller.dto.ChangePasswordRequest;
import ssafy.a706.backend.user.controller.dto.UpdateProfileRequest;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/**
 * API 명세서 회원 도메인 — 프로필 조회·수정, 비밀번호 변경, 탈퇴(-23·-111).
 * 포인트·인벤토리·화면 꾸미기·전적은 후속 작업.
 */
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    /** GET /users/me — 내 프로필 조회 */
    @GetMapping("/me")
    public UserProfileResponse me(@AuthenticationPrincipal MemberPrincipal principal) {
        return userService.getProfile(principal.id());
    }

    /** PATCH /users/me — 프로필(닉네임) 수정 */
    @PatchMapping("/me")
    public UserProfileResponse update(@AuthenticationPrincipal MemberPrincipal principal,
                                      @Valid @RequestBody UpdateProfileRequest req) {
        return userService.updateNickname(principal.id(), req.nickname());
    }

    /** PATCH /users/me/password — 비밀번호 변경(현재 비밀번호 확인) */
    @PatchMapping("/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@AuthenticationPrincipal MemberPrincipal principal,
                               @Valid @RequestBody ChangePasswordRequest req) {
        userService.changePassword(principal.id(), req.currentPassword(), req.newPassword());
    }

    /** DELETE /users/me — 회원 탈퇴(soft delete) */
    @DeleteMapping("/me")
    public ResponseEntity<Void> withdraw(@AuthenticationPrincipal MemberPrincipal principal) {
        userService.withdraw(principal.id());
        return ResponseEntity.noContent().build();
    }
}
