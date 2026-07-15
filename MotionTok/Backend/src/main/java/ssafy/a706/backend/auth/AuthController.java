package ssafy.a706.backend.auth;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.dto.GuestLoginRequest;
import ssafy.a706.backend.auth.dto.LoginRequest;
import ssafy.a706.backend.auth.dto.TokenResponse;
import ssafy.a706.backend.global.response.ApiResponse;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ApiResponse<TokenResponse> login(@Valid @RequestBody LoginRequest req) {
        return ApiResponse.ok("로그인 성공", authService.login(req));
    }

    @PostMapping("/guest")
    public ApiResponse<TokenResponse> guest(@Valid @RequestBody GuestLoginRequest req) {
        return ApiResponse.ok("게스트 입장", authService.guestLogin(req));
    }
}
