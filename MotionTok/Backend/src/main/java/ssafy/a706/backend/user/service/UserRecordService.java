package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.entity.Leaderboard;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.game.repository.LeaderboardRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.user.controller.dto.GameRecordResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 회원 한 명의 게임별 전적(-97 내 전적, -141 친구 상세) — leaderboards의 역방향(유저 기준) 조회.
 *
 * <p>원천은 정산(-117)이 적재한 leaderboards 그대로다(개별 판 기록은 애초에 영속하지 않는 최소 RDB
 * 원칙). 순위는 리더보드(-96)와 <b>같은 쿼리</b>({@code countAhead})를 쓴다 — 화면마다 순위 산식이
 * 다르면 같은 사람의 순위가 화면마다 달라진다.</p>
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
            // 협동 게임은 역대 순위표 자체가 없다(Game.hasLeaderboard) — 전원이 같은 점수를 받아
            // 순위가 성립하지 않는다. 여기서만 숫자를 매기면 랭킹 화면은 "순위 없음"인데 전적엔
            // "3위"가 떠서 같은 앱이 두 말을 하게 된다. 0 = 순위 없음.
            int rankNo = game.isCoop() ? 0 : rankNoOf(row);
            records.add(new GameRecordResponse(
                    game.getId(), game.getName(), row.getMode().name(),
                    row.getPlayCount(), row.getBestScore(), rankNo));
        }
        return records;
    }

    /** 1-기반 순위 — 리더보드 화면(-96)과 같은 전순서 규칙으로 "나보다 앞선 사람 수 + 1"을 센다. */
    private int rankNoOf(Leaderboard row) {
        return (int) (leaderboardRepository.countAhead(
                row.getGameId(), row.getMode(),
                row.getBestScore(), row.getBestAchievedAt(), row.getUserId()) + 1);
    }
}
