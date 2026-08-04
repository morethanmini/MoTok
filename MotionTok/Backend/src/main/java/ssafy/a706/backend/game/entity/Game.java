package ssafy.a706.backend.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.game.model.LeaderboardMode;
import ssafy.a706.backend.game.model.LeaderboardPeriod;

/**
 * 게임 카탈로그(ERD GAME). 팀장 as-built의 하드코딩(PLAYABLE_GAME_IDS·라운드 시간)을
 * 데이터로 옮긴 것 — 게임 2~6은 이 테이블에 행을 추가하면 세션 서버가 그대로 수용한다(S15P11A706-115 일반화).
 *
 * <p>id는 고정 카탈로그 키라 자동생성하지 않는다(1=핑거 스타). round_duration_sec/countdown_sec은
 * 게임별 라운드 길이를 서버 권위로 확정하는 값(클라이언트 타이머는 표시용).</p>
 */
@Entity
@Table(name = "games")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Game {

    @Id
    private Long id;

    @Column(nullable = false, length = 50)
    private String name;

    /** SOLO | VERSUS | COOP (ERD GAME.mode). */
    @Column(length = 16)
    private String mode;

    @Column(name = "min_players", nullable = false)
    private int minPlayers;

    @Column(name = "max_players", nullable = false)
    private int maxPlayers;

    /** 라운드 길이(초) — 서버 권위 타이머의 endAt 산정에 쓰인다. */
    @Column(name = "round_duration_sec", nullable = false)
    private int roundDurationSec;

    /** 시작 카운트다운(초). */
    @Column(name = "countdown_sec", nullable = false)
    private int countdownSec;

    @Column(name = "supports_bot", nullable = false)
    private boolean supportsBot;

    /** 관리자 노출 제어. false면 시작을 거부한다. */
    @Column(name = "is_active", nullable = false)
    private boolean active;

    @Column(length = 32)
    private String category;

    @Column(name = "thumbnail_url")
    private String thumbnailUrl;

    /** 게임 상세 안내 — 규칙 설명(-75, GET /games/{gameId}). */
    @Column(columnDefinition = "TEXT")
    private String rules;

    /** 게임 상세 안내 — 모션 조작 방법(-75). */
    @Column(columnDefinition = "TEXT")
    private String controls;

    @Builder
    public Game(Long id, String name, String mode, int minPlayers, int maxPlayers,
                int roundDurationSec, int countdownSec, boolean supportsBot, boolean active,
                String category, String thumbnailUrl, String rules, String controls) {
        this.id = id;
        this.name = name;
        this.mode = mode;
        this.minPlayers = minPlayers;
        this.maxPlayers = maxPlayers;
        this.roundDurationSec = roundDurationSec;
        this.countdownSec = countdownSec;
        this.supportsBot = supportsBot;
        this.active = active;
        this.category = category;
        this.thumbnailUrl = thumbnailUrl;
        this.rules = rules;
        this.controls = controls;
    }

    /** 상세 안내(규칙·조작법) 갱신 — 시더 백필용. */
    public void updateGuide(String rules, String controls) {
        this.rules = rules;
        this.controls = controls;
    }

    /**
     * 노출·플레이 허용 토글 (관리자, PATCH /v1/admin/games/{gameId}).
     *
     * <p>끄면 카탈로그에서 사라지는 대신 <b>목록에 남고 선택만 막힌다</b> —
     * 조용히 사라지면 "어제 하던 게임이 왜 없지"에 답할 수 없다. 시작 거부는
     * {@code GameSessionService}·{@code RhythmSessionService}가 서버에서 한 번 더 한다.</p>
     */
    public void changeActive(boolean active) {
        this.active = active;
    }

    /** 협동 게임 — 전원이 같은 점수를 받는다(그림으로 말해요). */
    public boolean isCoop() {
        return "COOP".equals(mode);
    }

    /**
     * 이 모드·기간의 순위표를 가지는 게임인가. 없는 조합은 읽기 경로에서 빈 순위표로 막는다.
     *
     * <p><b>혼자 시작할 수 없는 게임(minPlayers ≥ 2)에 솔로 기록은 없다.</b> 정산이 참가 인원으로
     * 모드를 정하므로({@link LeaderboardMode#ofPlayerCount}) 이런 행은 더는 쌓이지 않는다. 그런데
     * 개발 중 최소 인원을 잠깐 풀고 테스트한 기록이 남아 있어, 규칙 안내는 "3명부터"라면서 솔로
     * 순위가 보이는 앞뒤 안 맞는 화면이 된다. 지우는 대신 막는 쪽이라 최소 인원이 다시 바뀌어도
     * 규칙이 따라온다.</p>
     *
     * <p><b>협동 게임에 역대 최고점 순위는 없다.</b> 협동은 전원이 같은 점수를 받으므로
     * (GameSessionService.coopResults) 개인의 최고점이 곧 "그날 팀이 낸 결과"다. 게다가 그림으로
     * 말해요의 점수는 AI 추측 순위에 따른 {100, 80, 60, 40, 20, 0} <b>여섯 값뿐</b>이라
     * (DrawJudge.scoreForRank), 사람이 조금만 늘어도 전부 100점에 몰리고 1위는 "100점을 제일 먼저
     * 겪은 사람"으로 영구히 굳는다 — 순위표라고 부를 수 없는 표가 된다.</p>
     *
     * <p>반면 <b>주간 누적은 협동에서도 성립한다.</b> 합계는 판마다 쌓여 값이 흩어지고 매주
     * 초기화되므로 "이번 주에 많이·잘 맞춘 사람"이라는 답이 나온다. 그래서 기간 전체가 아니라
     * ALLTIME만 막는다.</p>
     */
    public boolean hasLeaderboard(LeaderboardMode mode, LeaderboardPeriod period) {
        return hasLeaderboard(mode) && (period != LeaderboardPeriod.ALLTIME || !isCoop());
    }

    /** 모드 규칙만 — 기간과 무관하게 이 모드의 기록을 노출할 게임인가(전적 화면 등). */
    public boolean hasLeaderboard(LeaderboardMode mode) {
        return mode != LeaderboardMode.SOLO || minPlayers <= 1;
    }

    /** 라운드 길이·최소 인원 갱신 — 이미 시딩된 행의 규칙 조정 백필용(시더는 멱등이라 insert만으로는 못 바꾼다). */
    public void updateSessionRules(int roundDurationSec, int minPlayers) {
        this.roundDurationSec = roundDurationSec;
        this.minPlayers = minPlayers;
    }
}
