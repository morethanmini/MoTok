package ssafy.a706.backend.game;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.AdminGameActiveRequest;
import ssafy.a706.backend.game.dto.AdminGameResponse;
import ssafy.a706.backend.global.response.ApiResponse;

import java.util.List;

/**
 * 관리자 게임 관리 (-106) — 카탈로그 전체 조회·플레이 허용 토글.
 *
 * <p>공개 카탈로그({@link GameRestController}, {@code /api/games})와 컨트롤러를 나눈다.
 * 경로 접두사가 다르면 인가 규칙도 갈라지는데, SecurityConfig가 {@code /api/v1/admin/**}를
 * 통째로 ADMIN에 묶고 있어 이 자리에 두는 것만으로 보호된다.</p>
 *
 * <p>응답을 {@code ApiResponse}로 감싸는 것도 그 계열의 규약이다 — 같은 화면이 부르는
 * 신고·제재 API가 모두 래핑돼 있어 프론트가 클라이언트를 하나만 쓴다(http.ts 상단 주석).</p>
 */
@RestController
@RequestMapping("/api/v1/admin/games")
@RequiredArgsConstructor
public class GameAdminController {

    private final GameAdminService gameAdminService;

    /** GET /v1/admin/games — 닫아 둔 게임까지 포함한 전체 카탈로그(id 순). */
    @GetMapping
    public ApiResponse<List<AdminGameResponse>> list() {
        return ApiResponse.ok(gameAdminService.list());
    }

    /**
     * PATCH /v1/admin/games/{gameId} — 플레이 허용 토글.
     *
     * <p>집행자를 본문이 아니라 토큰에서 꺼내는 건 제재 API와 같은 이유다
     * ({@code UserSanctionAdminController} 주석).</p>
     */
    @PatchMapping("/{gameId}")
    public ApiResponse<AdminGameResponse> changeActive(@AuthenticationPrincipal MemberPrincipal admin,
                                                      @PathVariable long gameId,
                                                      @Valid @RequestBody AdminGameActiveRequest request) {
        AdminGameResponse updated = gameAdminService.changeActive(admin.id(), gameId, request.isActive());
        return ApiResponse.ok(updated.active() ? "플레이 허용" : "플레이 차단", updated);
    }
}
