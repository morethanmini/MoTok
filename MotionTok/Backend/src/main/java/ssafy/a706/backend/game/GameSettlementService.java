package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.entity.LeaderboardWeekly;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.game.repository.LeaderboardWeeklyRepository;

import java.time.LocalDate;
import java.util.List;

/**
 * 게임 결과 정산(S15P11A706-117) — 회원 결과만 영속(write-behind).
 *
 * <p>최소 RDB 원칙: 개별 판 기록(game_sessions/results)은 두지 않고, 집계만 남긴다
 * (전적·세계순위엔 이걸로 충분 — ERD §03-1). 게스트는 적재하지 않는다(결정 D5).</p>
 *
 * <p>적재 대상은 둘이다 — 전체기간 최고점(leaderboards)과 주간 누적(leaderboard_weekly).
 * <b>한 트랜잭션</b>이라 최고점만 들어가고 주간이 빠지는 부분 실패가 없다.</p>
 *
 * <p>참가자 식별: 회원 participantId는 users.id의 숫자 문자열(MemberPrincipal), 게스트는 guest-xxxx.
 * 숫자로 파싱되면 회원, 아니면 게스트로 보고 건너뛴다.</p>
 */
@Service
@RequiredArgsConstructor
public class GameSettlementService {

    private final LeaderboardRepository leaderboardRepository;
    private final LeaderboardWeeklyRepository weeklyRepository;

    /**
     * 회원 결과를 최고점·주간 누적에 반영하고 적재한 회원 수를 돌려준다.
     *
     * <p><b>세션 중복 가드를 두 적재 앞에 한 번만 둔다.</b> 최고점(GREATEST)은 두 번 반영해도 값이
     * 같지만 주간 합계와 play_count는 그렇지 않다 — 세 값을 따로 지키는 대신 같은 세션이면 그 회원
     * 몫을 통째로 건너뛴다. 가드 상태는 주간 행의 last_session_id 하나로 관리해 leaderboards에는
     * 컬럼을 늘리지 않는다.</p>
     */
    @Transactional
    public int settleToDb(String sessionId, long gameId, LeaderboardMode mode, List<GameResultEntry> results) {
        LocalDate weekStart = LeaderboardWeekly.currentWeekStart();
        int members = 0;
        for (GameResultEntry result : results) {
            Long userId = memberId(result.userId());
            if (userId == null) {
                continue; // 게스트 — 영속 제외(D5)
            }
            LeaderboardWeekly weekly = weeklyRepository
                    .findByGameIdAndUserIdAndModeAndWeekStart(gameId, userId, mode, weekStart)
                    .orElseGet(() -> new LeaderboardWeekly(gameId, userId, mode, weekStart));
            if (weekly.alreadyCounted(sessionId)) {
                continue; // 같은 판 재처리 — 최고점·플레이수·합계 모두 건드리지 않는다
            }

            Leaderboard board = leaderboardRepository.findByGameIdAndUserIdAndMode(gameId, userId, mode)
                    .orElseGet(() -> new Leaderboard(gameId, userId, mode));
            board.record(result.score());
            leaderboardRepository.save(board);

            weekly.record(sessionId, result.score());
            weeklyRepository.save(weekly);
            members++;
        }
        return members;
    }

    /** 회원 participantId(=users.id 숫자 문자열)만 Long으로. 게스트(guest-xxxx 등)는 null. */
    private Long memberId(String participantId) {
        try {
            return Long.parseLong(participantId);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
