package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.GameRankRedisRepository;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.controller.dto.GameRecordResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 회원 한 명의 게임별 전적(-97 내 전적, -141 친구 상세) — leaderboards의 역방향(유저 기준) 조회.
 *
 * <p>원천은 정산(-117)이 적재한 leaderboards 그대로다(개별 판 기록은 애초에 영속하지 않는 최소 RDB
 * 원칙). 순위는 리더보드(-96)와 같은 Redis {@code rank:{gameId}[:solo]} ZREVRANK를 쓴다 —
 * 화면마다 순위 산식이 다르면 같은 사람의 순위가 화면마다 달라진다.</p>
 *
 * <p>GameQueryService(게임 도메인 공용 조회)를 확장하지 않고 전용 서비스를 새로 판다 —
 * 리더보드 화면 로직과 전적 화면 로직이 한 클래스에 얽히지 않게(격리 우선).</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserRecordService {

    private final UserRepository userRepository;
    private final LeaderboardRepository leaderboardRepository;
    private final GameRepository gameRepository;
    private final GameRankRedisRepository rankRepository;

    /**
     * 게임별·모드별 전적 목록. 공개 범위는 공개 프로필과 동일(회원 전체 — 결정 Q3),
     * 탈퇴·정지 계정은 프로필과 같은 선에서 404.
     */
    public List<GameRecordResponse> records(Long userId) {
        User user = userRepository.findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        List<Leaderboard> rows = leaderboardRepository.findAllByUserId(user.getId());
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<Long, Game> games = gameRepository.findAllById(
                        rows.stream().map(Leaderboard::getGameId).distinct().toList()).stream()
                .collect(Collectors.toMap(Game::getId, Function.identity()));

        List<GameRecordResponse> records = new ArrayList<>();
        // 게임 순, 같은 게임은 멀티(주 모드) 먼저 — 화면이 게임 단위로 묶어 보여준다.
        rows.sort(Comparator.comparing(Leaderboard::getGameId)
                .thenComparing(row -> row.getMode() == LeaderboardMode.MULTI ? 0 : 1));
        for (Leaderboard row : rows) {
            Game game = games.get(row.getGameId());
            if (game == null) {
                continue; // 카탈로그에서 내려간 게임 — 이름을 붙일 수 없으니 노출하지 않는다
            }
            if (!game.hasLeaderboard(row.getMode())) {
                continue; // 혼자 시작할 수 없는 게임의 솔로 기록(개발 중 잔재) — 리더보드(-96)와 같은 선
            }
            records.add(new GameRecordResponse(
                    game.getId(), game.getName(), row.getMode().name(),
                    row.getPlayCount(), row.getBestScore(), rankNoOf(row)));
        }
        return records;
    }

    /**
     * 1-기반 순위. ZSET이 비어 있으면(-96과 동일한 유실 시나리오) leaderboards로 warm-up,
     * 비어 있지 않은데 이 회원만 빠져 있으면(부분 유실) 본인 기록만 재적재해 자가 복구한다.
     */
    private int rankNoOf(Leaderboard row) {
        warmUpIfEmpty(row.getGameId(), row.getMode());
        return rankRepository.reverseRankOf(row.getGameId(), row.getMode(), row.getUserId())
                .map(zeroBased -> (int) (zeroBased + 1))
                .orElseGet(() -> {
                    rankRepository.updateRanks(row.getGameId(), row.getMode(),
                            Map.of(row.getUserId(), row.getBestScore()));
                    return rankRepository.reverseRankOf(row.getGameId(), row.getMode(), row.getUserId())
                            .map(zeroBased -> (int) (zeroBased + 1))
                            .orElse(0);
                });
    }

    /** Redis 유실 복구 — GameQueryService(-96)와 같은 규칙. 공용화 대신 전용 경로에 중복해 둔다. */
    private void warmUpIfEmpty(long gameId, LeaderboardMode mode) {
        if (rankRepository.size(gameId, mode) > 0) {
            return;
        }
        List<Leaderboard> rows = leaderboardRepository.findAllByGameIdAndMode(gameId, mode);
        if (rows.isEmpty()) {
            return;
        }
        Map<Long, Integer> scores = new HashMap<>();
        rows.forEach(row -> scores.put(row.getUserId(), row.getBestScore()));
        rankRepository.updateRanks(gameId, mode, scores);
    }
}
