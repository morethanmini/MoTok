package ssafy.a706.backend.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

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

    /** 라운드 길이·최소 인원 갱신 — 이미 시딩된 행의 규칙 조정 백필용(시더는 멱등이라 insert만으로는 못 바꾼다). */
    public void updateSessionRules(int roundDurationSec, int minPlayers) {
        this.roundDurationSec = roundDurationSec;
        this.minPlayers = minPlayers;
    }
}
