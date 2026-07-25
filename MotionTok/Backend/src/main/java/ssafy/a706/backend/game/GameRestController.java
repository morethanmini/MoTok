package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.GameDetailResponse;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.model.LeaderboardMode;

import java.util.List;

/**
 * 게임 카탈로그·리더보드 REST(-28·-96) — 둘 다 공개 조회(SecurityConfig permitAll).
 * STOMP 세션 엔드포인트(start/progress/finish)는 {@link GameController} 별도.
 * principal은 비로그인(anonymous)·게스트면 myRank 계산에서 제외될 뿐 접근은 허용된다.
 */
@RestController
@RequestMapping("/api/games")
@RequiredArgsConstructor
public class GameRestController {

    private final GameQueryService gameQueryService;

    /** GET /games — 활성 게임 목록(+인원 큐레이션). */
    @GetMapping
    public List<GameSummaryResponse> list(@RequestParam(required = false) Integer playerCount) {
        return gameQueryService.list(playerCount);
    }

    /** GET /games/{gameId} — 게임 상세(규칙·조작 안내, -75). */
    @GetMapping("/{gameId}")
    public GameDetailResponse detail(@PathVariable long gameId) {
        return gameQueryService.detail(gameId);
    }

    /** GET /games/{gameId}/leaderboard — 게임·모드(솔로/멀티)별 랭킹 + 내 순위. */
    @GetMapping("/{gameId}/leaderboard")
    public LeaderboardResponse leaderboard(@PathVariable long gameId,
                                           @RequestParam(defaultValue = "MULTI") LeaderboardMode mode,
                                           @RequestParam(defaultValue = "20") int limit,
                                           @AuthenticationPrincipal AuthPrincipal principal) {
        return gameQueryService.leaderboard(gameId, mode, limit, principal);
    }
}
