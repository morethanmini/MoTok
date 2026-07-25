package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.LeaderboardRepository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 게임 결과 정산(S15P11A706-117) — 회원 결과만 leaderboards에 영속(write-behind).
 *
 * <p>최소 RDB 원칙: 개별 판 기록(game_sessions/results)은 두지 않고, 집계 리더보드만 남긴다
 * (전적·세계순위엔 이걸로 충분 — ERD §03-1). 게스트는 적재하지 않는다(결정 D5).</p>
 *
 * <p>참가자 식별: 회원 participantId는 users.id의 숫자 문자열(MemberPrincipal), 게스트는 guest-xxxx.
 * 숫자로 파싱되면 회원, 아니면 게스트로 보고 건너뛴다.</p>
 */
@Service
@RequiredArgsConstructor
public class GameSettlementService {

    private final LeaderboardRepository leaderboardRepository;

    /**
     * 회원 결과를 leaderboards에 upsert하고 (userId → 최고점) 맵을 돌려준다(Redis 랭킹 반영용).
     * 솔로/멀티 기록은 mode로 분리 적재하며(-96 확장), (game_id, user_id, mode) 유니크라
     * 이 조합으로 기존 기록을 찾아 best_score(GREATEST)·play_count를 갱신한다.
     */
    @Transactional
    public Map<Long, Integer> settleToDb(long gameId, LeaderboardMode mode, List<GameResultEntry> results) {
        Map<Long, Integer> bestByUser = new HashMap<>();
        for (GameResultEntry result : results) {
            Long userId = memberId(result.userId());
            if (userId == null) {
                continue; // 게스트 — 영속 제외(D5)
            }
            Leaderboard leaderboard = leaderboardRepository.findByGameIdAndUserIdAndMode(gameId, userId, mode)
                    .orElseGet(() -> new Leaderboard(gameId, userId, mode));
            leaderboard.record(result.score());
            leaderboardRepository.save(leaderboard);
            bestByUser.put(userId, leaderboard.getBestScore());
        }
        return bestByUser;
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
