package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
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
import ssafy.a706.backend.game.model.LeaderboardMode;
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
     * GET /games/{gameId}/leaderboard — 모드(솔로/멀티)별 상위 N + 내 순위.
     *
     * <p>그 게임에 없는 모드면 빈 순위표다({@link Game#hasLeaderboard}) — 혼자 시작할 수 없는
     * 게임의 솔로 순위 같은 것. 404가 아니라 200+빈 목록인 이유는 게임도 모드도 실재하는
     * 값이라서다. 없는 건 기록뿐이고, 화면은 "아직 기록이 없어요"를 이미 그릴 줄 안다.</p>
     */
    @Transactional(readOnly = true)
    public LeaderboardResponse leaderboard(long gameId, LeaderboardMode mode, int limit, AuthPrincipal principal) {
        Game game = gameRepository.findById(gameId)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
        if (!game.hasLeaderboard(mode)) {
            return new LeaderboardResponse(gameId, List.of(), null);
        }
        int capped = Math.max(1, Math.min(MAX_LIMIT, limit));
        warmUpIfEmpty(gameId, mode);

        Map<Long, Integer> top = rankRepository.topBestScores(gameId, mode, capped + FETCH_BUFFER);
        Map<Long, User> users = userRepository.findAllById(top.keySet()).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, Leaderboard> rows = leaderboardRepository
                .findAllByGameIdAndModeAndUserIdIn(gameId, mode, top.keySet()).stream()
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
                    scored.getValue(), row == null ? 0 : row.getPlayCount(), user.getAvatarUrl()));
        }
        return new LeaderboardResponse(gameId, entries, myRank(gameId, mode, principal, entries));
    }

    /**
     * 내 순위 — 회원만. 노출 목록 안에 있으면 그 항목(재순번과 일치), 밖이면 ZREVRANK 원시 순위.
     * 게스트·비로그인·기록 없음이면 null.
     */
    private LeaderboardEntryResponse myRank(long gameId, LeaderboardMode mode, AuthPrincipal principal,
                                            List<LeaderboardEntryResponse> entries) {
        if (!(principal instanceof MemberPrincipal member)) {
            return null;
        }
        for (LeaderboardEntryResponse entry : entries) {
            if (entry.userId() == member.id()) {
                return entry;
            }
        }
        Long zeroBased = rankRepository.reverseRankOf(gameId, mode, member.id()).orElse(null);
        if (zeroBased == null) {
            return null;
        }
        Leaderboard row = leaderboardRepository
                .findByGameIdAndUserIdAndMode(gameId, member.id(), mode).orElse(null);
        if (row == null) {
            return null;
        }
        // 노출 목록 밖이라 위에서 읽은 User 맵에 내가 없다. avatarUrl을 null로 두면 같은 필드가
        // "목록 안이면 있고 밖이면 없는" 값이 되어 쓰는 쪽이 신뢰할 수 없으므로 한 건 더 읽는다.
        String avatarUrl = userRepository.findById(member.id()).map(User::getAvatarUrl).orElse(null);
        return new LeaderboardEntryResponse(
                (int) (zeroBased + 1), member.id(), member.displayName(),
                row.getBestScore(), row.getPlayCount(), avatarUrl);
    }

    /** Redis 유실 복구(-96 비기능): ZSET이 비었는데 DB 기록이 있으면 leaderboards에서 재적재. */
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
