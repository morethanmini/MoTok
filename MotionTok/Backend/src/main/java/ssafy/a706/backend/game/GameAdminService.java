package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.game.dto.AdminGameResponse;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.List;

/**
 * 관리자 게임 관리(-106) — 카탈로그 전체 조회와 플레이 허용 토글.
 *
 * <p>공개 조회({@link GameQueryService})와 서비스를 나눈 이유는 <b>보는 범위가 다르기 때문</b>이다.
 * 공개 목록은 사용자가 고를 수 있는 것들을 주고, 이쪽은 닫아 둔 것까지 전부 준다 — 닫힌 게임이
 * 안 보이면 다시 열 방법이 없다.</p>
 *
 * <p>토글은 <b>진행 중인 세션을 끊지 않는다.</b> 닫는다는 건 "더 이상 시작하지 못하게" 한다는
 * 뜻이고, 하던 판을 중간에 날리는 건 다른 결정이다(그건 방장 강제 종료·-164의 몫). 새 시작만
 * {@code GameSessionService}·{@code RhythmSessionService}가 거부한다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GameAdminService {

    private final GameRepository gameRepository;

    /**
     * 전체 카탈로그(id 순). 페이지를 두지 않는 이유 — 게임 수는 열 몇 개로 고정된 카탈로그다.
     * 싱글/멀티 구분은 {@code soloCapable}로 내려보내고 화면이 나눈다(서버가 "싱글"의 정의를
     * 계약에 못 박으면 인원 규칙이 바뀔 때 API가 함께 흔들린다).
     */
    @Transactional(readOnly = true)
    public List<AdminGameResponse> list() {
        return gameRepository.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(AdminGameResponse::from)
                .toList();
    }

    /**
     * 플레이 허용 토글. 같은 값으로 다시 눌러도 그대로 성공을 돌려준다 —
     * 결과 상태가 요청과 같으므로 관리자가 대응할 실패가 아니다(멱등).
     */
    @Transactional
    public AdminGameResponse changeActive(Long adminId, long gameId, boolean active) {
        Game game = gameRepository.findById(gameId)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
        if (game.isActive() != active) {
            game.changeActive(active);
            // 감사 로그 테이블(-107)이 아직 없어 최소한 흔적은 남긴다 — 게임을 닫는 건
            // 전체 사용자에게 보이는 변경이라 "누가 언제 닫았나"가 사후에 필요하다.
            log.info("game active changed: gameId={} active={} admin={}", gameId, active, adminId);
        }
        return AdminGameResponse.from(game);
    }
}
