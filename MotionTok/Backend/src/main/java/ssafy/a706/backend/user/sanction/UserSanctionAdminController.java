package ssafy.a706.backend.user.sanction;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.user.sanction.dto.BanUserRequest;
import ssafy.a706.backend.user.sanction.dto.ReleaseSuspensionRequest;
import ssafy.a706.backend.user.sanction.dto.SanctionHistoryListResponse;
import ssafy.a706.backend.user.sanction.dto.SuspendUserRequest;
import ssafy.a706.backend.user.sanction.dto.WarnUserRequest;
import ssafy.a706.backend.user.sanction.dto.SanctionStatusResponse;

/**
 * 관리자 계정 제재 — 기간 정지 부과·해제·조회.
 * 일반 회원·게스트 차단은 SecurityConfig(/api/v1/admin/** hasRole ADMIN)가 필터 단에서 처리한다.
 *
 * <p>집행자(adminId)는 요청 본문이 아니라 토큰에서 꺼낸다 — 클라이언트가 준 값을 이력에 남기면
 * 누가 내린 제재인지를 클라이언트가 정할 수 있게 된다(UserReportService의 신고자 처리와 같은 원칙).</p>
 */
@RestController
@RequestMapping("/api/v1/admin/users/{userId}")
@RequiredArgsConstructor
public class UserSanctionAdminController {

    private final UserSanctionService userSanctionService;

    /** POST /v1/admin/users/{userId}/suspension — 정지 부과(이미 정지 중이면 새 기간으로 갱신) */
    @PostMapping("/suspension")
    public ApiResponse<SanctionStatusResponse> suspend(@AuthenticationPrincipal MemberPrincipal admin,
                                                         @PathVariable Long userId,
                                                         @Valid @RequestBody SuspendUserRequest request) {
        return ApiResponse.ok("정지 처리 완료", userSanctionService.suspend(admin.id(), userId, request));
    }

    /** DELETE /v1/admin/users/{userId}/suspension — 기간 만료 전 수동 해제 */
    @DeleteMapping("/suspension")
    public ApiResponse<Void> release(@AuthenticationPrincipal MemberPrincipal admin,
                                     @PathVariable Long userId,
                                     @Valid @RequestBody ReleaseSuspensionRequest request) {
        userSanctionService.release(admin.id(), userId, request);
        return ApiResponse.ok("정지 해제 완료");
    }

    /**
     * POST /v1/admin/users/{userId}/warn — 경고 부과.
     *
     * <p>접근을 막지 않는 유일한 제재라 해제 엔드포인트가 없다 — 되돌릴 상태가 없다.
     * 잘못 보낸 경고는 이력에 남고, 필요하면 다음 경고 사유에 정정을 적는다.</p>
     */
    @PostMapping("/warn")
    public ApiResponse<SanctionStatusResponse> warn(@AuthenticationPrincipal MemberPrincipal admin,
                                                    @PathVariable Long userId,
                                                    @Valid @RequestBody WarnUserRequest request) {
        return ApiResponse.ok("경고 처리 완료", userSanctionService.warn(admin.id(), userId, request));
    }

    /** POST /v1/admin/users/{userId}/ban — 영구 정지 부과(이미 밴이면 409) */
    @PostMapping("/ban")
    public ApiResponse<SanctionStatusResponse> ban(@AuthenticationPrincipal MemberPrincipal admin,
                                                   @PathVariable Long userId,
                                                   @Valid @RequestBody BanUserRequest request) {
        return ApiResponse.ok("영구 정지 처리 완료", userSanctionService.ban(admin.id(), userId, request));
    }

    /** DELETE /v1/admin/users/{userId}/ban — 영구 정지 해제(오판 정정). 밴이 아니면 409 */
    @DeleteMapping("/ban")
    public ApiResponse<Void> unban(@AuthenticationPrincipal MemberPrincipal admin,
                                   @PathVariable Long userId,
                                   @Valid @RequestBody ReleaseSuspensionRequest request) {
        userSanctionService.unban(admin.id(), userId, request);
        return ApiResponse.ok("영구 정지 해제 완료");
    }

    /**
     * GET /v1/admin/users/{userId}/sanction-status — 지금 걸려 있는 제재 전체(기간·영구)와 누적 횟수.
     *
     * <p>경로가 {@code /suspension}이 아닌 이유 — 응답이 영구 정지까지 담는다. 관리자 화면은
     * "이 사람 지금 어떤 상태인가"를 한 번에 알아야 하고, 둘을 따로 조회하면 그 사이에 상태가 바뀐다.</p>
     */
    @GetMapping("/sanction-status")
    public ApiResponse<SanctionStatusResponse> status(@PathVariable Long userId) {
        return ApiResponse.ok(userSanctionService.status(userId));
    }

    /** GET /v1/admin/users/{userId}/sanctions — 제재 이력(최신순) */
    @GetMapping("/sanctions")
    public ApiResponse<SanctionHistoryListResponse> history(@PathVariable Long userId,
                                                            @RequestParam(defaultValue = "0") int page,
                                                            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(userSanctionService.history(userId, page, size));
    }
}
