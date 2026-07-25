package ssafy.a706.backend.game.dto;

import ssafy.a706.backend.game.entity.Game;

/** GET /games/{gameId} 상세(-75, 명세 GameDetail) — 규칙·조작 방법 안내. */
public record GameDetailResponse(long id, String name, String rules, String controls) {

    public static GameDetailResponse of(Game game) {
        return new GameDetailResponse(game.getId(), game.getName(), game.getRules(), game.getControls());
    }
}
