package ssafy.a706.backend.game.dto;

import ssafy.a706.backend.game.entity.Game;

/**
 * GET /games 목록 항목(-28, 명세 Game).
 *
 * <p>playable은 "지금 이 게임을 시작할 수 있나"에 답하는 합성 값이다 — 관리자가 닫았거나
 * (games.is_active=false) playerCount가 min~max 범위를 벗어나면 false. playerCount 쿼리가
 * 없으면 인원 조건은 보지 않는다.</p>
 *
 * <p>active를 따로 내리는 이유는 <b>화면이 이유를 구분해 안내해야</b> 하기 때문이다 —
 * "점검 중이라 닫혔다"와 "인원이 모자라다"는 사용자가 취할 행동이 다르다. playable만 주면
 * 둘이 같은 회색 카드가 된다.</p>
 *
 * <p>description은 카탈로그 테이블에 아직 없는 컬럼이라 null로 내려간다(화면 문구는 FE 카탈로그가 보유).</p>
 */
public record GameSummaryResponse(
        long id,
        String name,
        String description,
        String mode,
        int minPlayers,
        int maxPlayers,
        boolean supportsBot,
        String category,
        String thumbnailUrl,
        boolean playable,
        boolean active
) {

    public static GameSummaryResponse of(Game game, Integer playerCount) {
        boolean fitsPlayerCount = playerCount == null
                || (game.getMinPlayers() <= playerCount && playerCount <= game.getMaxPlayers());
        return new GameSummaryResponse(
                game.getId(), game.getName(), null, game.getMode(),
                game.getMinPlayers(), game.getMaxPlayers(), game.isSupportsBot(),
                game.getCategory(), game.getThumbnailUrl(),
                game.isActive() && fitsPlayerCount, game.isActive());
    }
}
