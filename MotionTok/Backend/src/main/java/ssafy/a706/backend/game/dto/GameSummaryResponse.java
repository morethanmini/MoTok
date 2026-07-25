package ssafy.a706.backend.game.dto;

import ssafy.a706.backend.game.entity.Game;

/**
 * GET /games 목록 항목(-28, 명세 Game).
 * playable은 인원 기반 큐레이션 결과 — playerCount 쿼리가 오면 min~max 범위 판정, 없으면 true.
 * description은 카탈로그 테이블에 아직 없는 컬럼이라 null로 내려간다(화면 문구는 FE 카탈로그가 보유).
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
        boolean playable
) {

    public static GameSummaryResponse of(Game game, Integer playerCount) {
        boolean playable = playerCount == null
                || (game.getMinPlayers() <= playerCount && playerCount <= game.getMaxPlayers());
        return new GameSummaryResponse(
                game.getId(), game.getName(), null, game.getMode(),
                game.getMinPlayers(), game.getMaxPlayers(), game.isSupportsBot(),
                game.getCategory(), game.getThumbnailUrl(), playable);
    }
}
