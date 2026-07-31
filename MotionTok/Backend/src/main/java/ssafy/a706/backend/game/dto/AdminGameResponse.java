package ssafy.a706.backend.game.dto;

import ssafy.a706.backend.game.entity.Game;

/**
 * 관리자 게임 관리 목록 항목 (-106).
 *
 * <p>{@link GameSummaryResponse}(공개 카탈로그)와 나누는 이유는 <b>같은 이름의 필드가 다른 질문에
 * 답하기 때문</b>이다. 공개 목록의 playable은 "지금 이 게임을 시작할 수 있나"라 인원 조건이 섞여
 * 있는데, 관리자 화면이 그 값으로 토글을 그리면 인원 때문에 false인 게임이 "숨김"으로 보인다.
 * 여기서는 관리자가 실제로 쥐고 있는 스위치 하나({@code active})만 내려보낸다.</p>
 *
 * <p>플레이 가능 인원(min/max)과 모드를 함께 주는 이유 — 어떤 게임을 닫을지 고르는 판단에
 * "이건 3인부터 되는 협동 게임"이라는 사실이 필요하다.</p>
 */
public record AdminGameResponse(
        long id,
        String name,
        /** SOLO | VERSUS | COOP (games.mode) */
        String mode,
        String category,
        int minPlayers,
        int maxPlayers,
        int roundDurationSec,
        boolean supportsBot,
        /** 혼자서도 시작할 수 있는 게임인가 — 싱글/멀티 분류의 기준(games.min_players<=1). */
        boolean soloCapable,
        /** 관리자 스위치. false면 카탈로그에 잠긴 카드로 남고 시작이 거부된다. */
        boolean active
) {

    public static AdminGameResponse from(Game game) {
        return new AdminGameResponse(
                game.getId(), game.getName(), game.getMode(), game.getCategory(),
                game.getMinPlayers(), game.getMaxPlayers(), game.getRoundDurationSec(),
                game.isSupportsBot(), game.getMinPlayers() <= 1, game.isActive());
    }
}
