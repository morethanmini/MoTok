package ssafy.a706.backend.storage.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.storage.controller.dto.PresignUploadRequest;
import ssafy.a706.backend.storage.controller.dto.PresignUploadResponse;

/**
 * 업로드용 presigned URL 발급 (명세 확장).
 *
 * <p>게스트 차단은 SecurityConfig({@code /api/uploads/** hasRole("USER")})가 필터 단에서 처리한다 —
 * 게스트 토큰이 오면 {@code @AuthenticationPrincipal MemberPrincipal}이 null이 되어 NPE(500)가 난다.</p>
 *
 * <p>응답은 raw DTO다. {@code ApiResponse} 래핑은 {@code /v1/live-rooms}·SFU 계열만의 규약이고,
 * 프론트가 이 경로를 비래핑 클라이언트({@code http})로 호출한다.</p>
 */
@RestController
@RequestMapping("/api/uploads")
@RequiredArgsConstructor
public class UploadController {

    private static final String ROLE_ADMIN = "ROLE_ADMIN";

    private final StorageService storageService;

    /**
     * POST /uploads/presign — 업로드 URL 발급.
     *
     * <p>용도별 권한(ADMIN 전용 등)은 한 엔드포인트 안에서 갈리므로 SecurityConfig의 경로 규칙으로는
     * 표현할 수 없다. 그래서 여기서 확인한다 — 경로 단위 인가는 "회원이어야 한다"까지만 담당한다.</p>
     */
    @PostMapping("/presign")
    public PresignUploadResponse presign(@AuthenticationPrincipal MemberPrincipal principal,
                                         Authentication authentication,
                                         @Valid @RequestBody PresignUploadRequest request) {
        if (request.purpose().isAdminOnly() && !isAdmin(authentication)) {
            throw new BusinessException(ErrorCode.FORBIDDEN);
        }
        return PresignUploadResponse.from(storageService.presignPut(
                request.purpose(), principal.id(), request.contentType(), request.contentLength()));
    }

    private boolean isAdmin(Authentication authentication) {
        return authentication != null && authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(ROLE_ADMIN::equals);
    }
}
