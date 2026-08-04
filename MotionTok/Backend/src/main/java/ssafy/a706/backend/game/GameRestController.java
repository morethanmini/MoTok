package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.DrawJudgeRequest;
import ssafy.a706.backend.game.dto.GameDetailResponse;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.model.LeaderboardPeriod;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.LocalDate;
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
    private final GameSessionService gameSessionService;

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

    /**
     * POST /games/draw/judge — 그림으로 말해요 완성 그림 AI 채점 (명세 v0.2.22).
     *
     * <p>GMS 키를 프론트에 둘 수 없어 채점 호출과 점수 계산을 서버가 한다. 클라이언트는 도화지
     * 이미지만 올리고, 결과는 응답이 아니라 방 토픽의 DRAW_RESULT·GAME_END로 전원에게 배포된다
     * (관전자도 같은 화면을 보므로 발신자만 결과를 받을 이유가 없다).</p>
     *
     * <p>조회 API와 달리 인증이 필요하다(SecurityConfig의 permitAll은 GET만) — 방 참가자 검증도
     * 서비스에서 한 번 더 한다. 이미 정산된 세션이면 조용히 무시된다(SETNX 가드).</p>
     */
    @PostMapping("/draw/judge")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void judgeDrawing(@RequestBody DrawJudgeRequest request,
                             @AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        gameSessionService.judgeDrawing(request.roomId(), request.image(), principal);
    }

    /**
     * GET /games/{gameId}/leaderboard — 게임·모드(솔로/멀티)·기간(전체/주간)별 랭킹 + 내 순위.
     *
     * <p>{@code period}는 기본 ALLTIME이라 기존 호출은 그대로 동작한다. {@code week}는 보고 싶은
     * 주의 아무 날짜나 주면 되고(서버가 그 주 월요일로 스냅한다), 생략하면 이번 주다.</p>
     */
    @GetMapping("/{gameId}/leaderboard")
    public LeaderboardResponse leaderboard(@PathVariable long gameId,
                                           @RequestParam(defaultValue = "MULTI") LeaderboardMode mode,
                                           @RequestParam(defaultValue = "ALLTIME") LeaderboardPeriod period,
                                           @RequestParam(required = false)
                                           @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate week,
                                           @RequestParam(defaultValue = "20") int limit,
                                           @AuthenticationPrincipal AuthPrincipal principal) {
        return gameQueryService.leaderboard(gameId, mode, period, week, limit, principal);
    }
}
