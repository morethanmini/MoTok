package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameDetailResponse;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardEntryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.dto.LeaderboardRow;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.LeaderboardWeekly;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.model.LeaderboardPeriod;
import ssafy.a706.backend.game.repository.ChartLeaderboardRepository;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.game.repository.LeaderboardWeeklyRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 게임 카탈로그·리더보드 조회(-28·-96) — 쓰기 경로(정산)와 분리된 읽기 전용 서비스.
 *
 * <p>순위의 권위는 MySQL이다. 정렬은 {@code 점수 DESC, 달성 시각 ASC, userId ASC}로 동점을 남기지
 * 않는 전순서이고, 목록 순번과 내 순위(COUNT+1)가 같은 규칙·같은 모수를 쓴다. 탈퇴·정지 계정은
 * 조인 조건에서 빠지므로 상위 N이 정확히 N개로 오고, 내 순위도 이들을 세지 않는다(-111).</p>
 */
@Service
@RequiredArgsConstructor
public class GameQueryService {

    private static final int MAX_LIMIT = 100;

    private final GameRepository gameRepository;
    private final LeaderboardRepository leaderboardRepository;
    private final LeaderboardWeeklyRepository weeklyRepository;
    /** 이벤트용(-186). 접을 때 이 의존성과 CHART 분기만 지우면 된다. */
    private final ChartLeaderboardRepository chartRepository;

    /**
     * GET /games — 게임 목록. playerCount가 오면 인원 조건도 playable에 반영한다.
     *
     * <p>관리자가 닫은 게임(is_active=false)을 <b>걸러내지 않는다</b> — 목록에서 지워 버리면
     * 어제까지 있던 게임이 흔적 없이 사라져 사용자가 "왜 없어졌나"를 알 수 없다. 대신
     * playable=false·active=false로 내려보내 화면이 잠긴 카드로 그리게 한다(-106).</p>
     *
     * <p><b>id 순으로 정렬해 내려보낸다.</b> 정렬 없는 {@code findAll()}은 SQL이 순서를 보장하지
     * 않는다 — 지금은 대개 PK 순으로 오지만 실행 계획이 바뀌면 조회마다 달라질 수 있다. 화면은
     * 이 목록을 카드 그리드로 그리고 게임 id를 key로 쓰므로, 순서가 흔들리면 같은 목록인데도
     * 카드가 재정렬되며 화면이 튄다.</p>
     */
    @Transactional(readOnly = true)
    public List<GameSummaryResponse> list(Integer playerCount) {
        return gameRepository.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(game -> GameSummaryResponse.of(game, playerCount))
                .toList();
    }

    /**
     * GET /games/{gameId} — 게임 상세(규칙·조작 안내, -75). 없는 게임은 404.
     *
     * <p>닫힌 게임도 내려준다 — 목록에 남아 있어 눌릴 수 있는 카드라 상세가 404면 화면이
     * 앞뒤가 안 맞는다. 시작을 막는 건 세션 시작 경로의 일이다.</p>
     */
    @Transactional(readOnly = true)
    public GameDetailResponse detail(long gameId) {
        return gameRepository.findById(gameId)
                .map(GameDetailResponse::of)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
    }

    /**
     * GET /games/{gameId}/leaderboard — 모드(솔로/멀티)·기간(전체/주간)별 상위 N + 내 순위.
     *
     * <p>그 게임에 없는 조합이면 빈 순위표다({@link Game#hasLeaderboard}) — 혼자 시작할 수 없는
     * 게임의 솔로 순위, 협동 게임의 역대 최고점 순위 같은 것. 404가 아니라 200+빈 목록인 이유는
     * 게임도 모드도 기간도 실재하는 값이라서다. 없는 건 기록뿐이고, 화면은 "아직 기록이 없어요"를
     * 이미 그릴 줄 안다.</p>
     *
     * <p>{@code week}는 보고 싶은 주의 <b>아무 날짜나</b> 받아 그 주 월요일로 스냅한다. 화면이
     * 주 경계를 계산해 맞춰 보낼 필요가 없다 — 경계 규칙은 서버 한 곳에만 있어야 한다.</p>
     */
    @Transactional(readOnly = true)
    public LeaderboardResponse leaderboard(long gameId, LeaderboardMode mode, LeaderboardPeriod period,
                                           LocalDate week, String chart, int limit, AuthPrincipal principal) {
        Game game = gameRepository.findById(gameId)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
        LocalDate weekStart = period == LeaderboardPeriod.WEEKLY
                ? LeaderboardWeekly.weekStartOf(week == null ? LocalDate.now() : week)
                : null;
        // 채보 보드는 어느 채보인지 있어야 성립한다 — 없으면 빈 순위표(400을 던질 만큼 잘못된 요청은 아니다)
        boolean unusable = !game.hasLeaderboard(mode, period)
                || (period == LeaderboardPeriod.CHART && (chart == null || chart.isBlank()));
        if (unusable) {
            return new LeaderboardResponse(gameId, period, weekStart, List.of(), null);
        }
        int capped = Math.max(1, Math.min(MAX_LIMIT, limit));

        List<LeaderboardRow> top = switch (period) {
            case WEEKLY -> weeklyRepository.findTopRows(gameId, mode, weekStart, PageRequest.of(0, capped));
            case CHART -> chartRepository.findTopRows(gameId, chart, PageRequest.of(0, capped));
            case ALLTIME -> leaderboardRepository.findTopRows(gameId, mode, PageRequest.of(0, capped));
        };
        List<LeaderboardEntryResponse> entries = new ArrayList<>(top.size());
        for (LeaderboardRow row : top) {
            // 전순서로 정렬돼 오므로 순번이 곧 순위다 — 동점이라고 같은 번호를 주지 않는다
            entries.add(LeaderboardEntryResponse.of(entries.size() + 1, row));
        }
        return new LeaderboardResponse(gameId, period, weekStart, entries,
                myRank(gameId, mode, period, weekStart, chart, principal, entries));
    }

    /**
     * 내 순위 — 회원만. 노출 목록 안에 있으면 그 항목을 그대로 쓰고, 밖이면 COUNT로 센다.
     * 게스트·비로그인·기록 없음·탈퇴/정지면 null.
     */
    private LeaderboardEntryResponse myRank(long gameId, LeaderboardMode mode, LeaderboardPeriod period,
                                            LocalDate weekStart, String chart, AuthPrincipal principal,
                                            List<LeaderboardEntryResponse> entries) {
        if (!(principal instanceof MemberPrincipal member)) {
            return null;
        }
        for (LeaderboardEntryResponse entry : entries) {
            if (entry.userId() == member.id()) {
                return entry;
            }
        }
        LeaderboardRow mine = switch (period) {
            case WEEKLY -> weeklyRepository.findRow(gameId, mode, weekStart, member.id()).orElse(null);
            case CHART -> chartRepository.findRow(gameId, chart, member.id()).orElse(null);
            case ALLTIME -> leaderboardRepository.findRow(gameId, mode, member.id()).orElse(null);
        };
        if (mine == null) {
            return null;
        }
        long ahead = switch (period) {
            case WEEKLY -> weeklyRepository.countAhead(
                    gameId, mode, weekStart, mine.score(), mine.achievedAt(), mine.userId());
            case CHART -> chartRepository.countAhead(
                    gameId, chart, mine.score(), mine.achievedAt(), mine.userId());
            case ALLTIME -> leaderboardRepository.countAhead(
                    gameId, mode, mine.score(), mine.achievedAt(), mine.userId());
        };
        return LeaderboardEntryResponse.of((int) (ahead + 1), mine);
    }
}
