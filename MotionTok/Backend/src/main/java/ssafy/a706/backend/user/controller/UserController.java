package ssafy.a706.backend.user.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.user.service.UserService;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;

/**
 * API 명세서 회원 도메인. 이번 작업 범위(회원가입·JWT 인증)에 필요한 최소 엔드포인트만 구현한다.
 * 프로필 수정·포인트·인벤토리 등 나머지는 후속 작업.
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

    /** DELETE /users/me — 회원 탈퇴(soft delete) */
    @DeleteMapping("/me")
    public ResponseEntity<Void> withdraw(@AuthenticationPrincipal MemberPrincipal principal) {
        userService.withdraw(principal.id());
        return ResponseEntity.noContent().build();
    }
}
