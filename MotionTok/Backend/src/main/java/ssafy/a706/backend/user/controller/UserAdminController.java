package ssafy.a706.backend.user.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.user.controller.dto.AdminUserSearchResponse;
import ssafy.a706.backend.user.service.UserAdminService;

/**
 * 관리자 회원 검색. 인가는 SecurityConfig가 {@code /api/v1/admin/**}로 일괄 처리한다.
 *
 * <p>제재 부과·해제({@code UserSanctionAdminController})와 경로 계열은 같지만 그쪽은 대상이
 * 경로에 박혀 있고({@code /admin/users/{userId}/...}) 이쪽은 <b>그 id를 찾는</b> 자리다.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
public class UserAdminController {

    private final UserAdminService userAdminService;

    /**
     * GET /v1/admin/users?nickname= — 닉네임으로 회원 찾기(부분 일치, 최대 10명).
     *
     * <p>관리자가 화면에서 보는 값은 신고자·피신고자의 닉네임인데 제재 내역·포인트 내역 조회는
     * userId로 걸린다. 그 사이를 이어 준다 — 없으면 관리자가 회원 id를 어딘가에서 따로 알아내야 한다.</p>
     */
    @GetMapping
    public ApiResponse<AdminUserSearchResponse> search(@RequestParam String nickname) {
        return ApiResponse.ok(userAdminService.searchByNickname(nickname));
    }
}
