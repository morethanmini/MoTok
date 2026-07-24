package ssafy.a706.backend.game;

import ssafy.a706.backend.game.dto.GameResultEntry;

import java.util.List;

/**
 * 라운드 정산 완료(GAME_END 방송 후) 이벤트 — write-behind 정산의 트리거.
 * {@link GameSessionService#endRound}가 발행하고 {@link GameSettlementListener}가 비동기로 받아
 * leaderboards 적재 + rank ZSET 반영을 수행한다. 실시간 경로와 분리해 정산 실패가 게임 진행을 막지 않게 한다.
 */
public record GameSettledEvent(long gameId, List<GameResultEntry> results) {
}
