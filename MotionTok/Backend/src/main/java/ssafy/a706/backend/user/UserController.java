package ssafy.a706.backend.user;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.user.dto.UserRegisterRequest;
import ssafy.a706.backend.user.dto.UserResponse;
import ssafy.a706.backend.user.dto.UserUpdateRequest;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @PostMapping
    public ResponseEntity<ApiResponse<UserResponse>> register(@Valid @RequestBody UserRegisterRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok("회원가입 완료", userService.register(req)));
    }

    /** 아이디 중복 확인. true = 사용 가능. */
    @GetMapping("/check-id")
    public ApiResponse<Boolean> checkId(@RequestParam String userId) {
        return ApiResponse.ok("사용 가능 여부", userService.isUserIdAvailable(userId));
    }

    @GetMapping("/me")
    public ApiResponse<UserResponse> me(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(userService.getByUserId(principal.userId()));
    }

    @PatchMapping("/me")
    public ApiResponse<UserResponse> update(@AuthenticationPrincipal AuthPrincipal principal,
                                            @Valid @RequestBody UserUpdateRequest req) {
        return ApiResponse.ok("수정 완료", userService.update(principal.userId(), req));
    }

    @DeleteMapping("/me")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AuthPrincipal principal) {
        userService.delete(principal.userId());
        return ResponseEntity.noContent().build();
    }
}
