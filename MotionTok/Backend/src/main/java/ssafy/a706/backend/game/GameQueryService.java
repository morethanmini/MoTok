package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.game.dto.GameDetailResponse;
import ssafy.a706.backend.game.dto.GameSummaryResponse;
import ssafy.a706.backend.game.dto.LeaderboardEntryResponse;
import ssafy.a706.backend.game.dto.LeaderboardResponse;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.repository.GameRankRedisRepository;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 게임 카탈로그·리더보드 조회(-28·-96) — 쓰기 경로(정산)와 분리된 읽기 전용 서비스.
 *
 * <p>리더보드 순위 권위는 Redis {@code rank:{gameId}}(ZSET). ZSET이 비어 있으면 영속 원천인
 * leaderboards에서 warm-up 재적재 후 조회한다(-96 비기능, Redis 유실 복구).</p>
 *
 * <p>탈퇴·정지 계정은 목록에서 제외하고 순위를 다시 매긴다(-111 랭킹 노출 제외). ZSET에는
 * 남아 있으므로 myRank(ZREVRANK)는 이들을 포함한 원시 순위다 — 오차는 제재·탈퇴 수만큼이며
 * ZSET 정리는 후속(탈퇴 훅) 과제.</p>
 */
@Service
@RequiredArgsConstructor
public class GameQueryService {

    /** 비활성 계정 필터로 잘려나갈 것을 감안해 상위 조회에 얹는 여유분. */
    private static final int FETCH_BUFFER = 20;
    private static final int MAX_LIMIT = 100;

    private final GameRepository gameRepository;
    private final LeaderboardRepository leaderboardRepository;
    private final GameRankRedisRepository rankRepository;
    private final UserRepository userRepository;

    /** GET /games — 활성 게임 목록. playerCount가 오면 인원 큐레이션 결과(playable)를 계산한다. */
    @Transactional(readOnly = true)
    public List<GameSummaryResponse> list(Integer playerCount) {
        return gameRepository.findAll().stream()
                .filter(Game::isActive)
                .map(game -> GameSummaryResponse.of(game, playerCount))
                .toList();
    }

    /** GET /games/{gameId} — 게임 상세(규칙·조작 안내, -75). 없는 게임·비활성 게임은 404. */
    @Transactional(readOnly = true)
    public GameDetailResponse detail(long gameId) {
        return gameRepository.findById(gameId)
                .filter(Game::isActive)
                .map(GameDetailResponse::of)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
    }

    /** GET /games/{gameId}/leaderboard — 상위 N + 내 순위. */
    @Transactional(readOnly = true)
    public LeaderboardResponse leaderboard(long gameId, int limit, AuthPrincipal principal) {
        if (!gameRepository.existsById(gameId)) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        int capped = Math.max(1, Math.min(MAX_LIMIT, limit));
        warmUpIfEmpty(gameId);

        Map<Long, Integer> top = rankRepository.topBestScores(gameId, capped + FETCH_BUFFER);
        Map<Long, User> users = userRepository.findAllById(top.keySet()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, Leaderboard> rows = leaderboardRepository
                .findAllByGameIdAndUserIdIn(gameId, top.keySet()).stream()
                .collect(Collectors.toMap(Leaderboard::getUserId, Function.identity()));

        List<LeaderboardEntryResponse> entries = new ArrayList<>();
        for (Map.Entry<Long, Integer> scored : top.entrySet()) {
            if (entries.size() >= capped) {
                break;
            }
            User user = users.get(scored.getKey());
            if (user == null || !user.isActive()) {
                continue; // 탈퇴·정지 — 랭킹 노출 제외(-111)
            }
            Leaderboard row = rows.get(scored.getKey());
            entries.add(new LeaderboardEntryResponse(
                    entries.size() + 1, scored.getKey(), user.getNickname(),
                    scored.getValue(), row == null ? 0 : row.getPlayCount()));
        }
        return new LeaderboardResponse(gameId, entries, myRank(gameId, principal, entries));
    }

    /**
     * 내 순위 — 회원만. 노출 목록 안에 있으면 그 항목(재순번과 일치), 밖이면 ZREVRANK 원시 순위.
     * 게스트·비로그인·기록 없음이면 null.
     */
    private LeaderboardEntryResponse myRank(long gameId, AuthPrincipal principal,
                                            List<LeaderboardEntryResponse> entries) {
        if (!(principal instanceof MemberPrincipal member)) {
            return null;
        }
        for (LeaderboardEntryResponse entry : entries) {
            if (entry.userId() == member.id()) {
                return entry;
            }
        }
        Long zeroBased = rankRepository.reverseRankOf(gameId, member.id()).orElse(null);
        if (zeroBased == null) {
            return null;
        }
        Leaderboard row = leaderboardRepository.findByGameIdAndUserId(gameId, member.id()).orElse(null);
        if (row == null) {
            return null;
        }
        return new LeaderboardEntryResponse(
                (int) (zeroBased + 1), member.id(), member.displayName(),
                row.getBestScore(), row.getPlayCount());
    }

    /** Redis 유실 복구(-96 비기능): ZSET이 비었는데 DB 기록이 있으면 leaderboards에서 재적재. */
    private void warmUpIfEmpty(long gameId) {
        if (rankRepository.size(gameId) > 0) {
            return;
        }
        List<Leaderboard> rows = leaderboardRepository.findAllByGameId(gameId);
        if (rows.isEmpty()) {
            return;
        }
        Map<Long, Integer> scores = new HashMap<>();
        rows.forEach(row -> scores.put(row.getUserId(), row.getBestScore()));
        rankRepository.updateRanks(gameId, scores);
    }
}
