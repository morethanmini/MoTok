package ssafy.a706.backend.game;

import ssafy.a706.backend.game.dto.GameResultEntry;

import java.util.List;

/**
 * 라운드 정산 완료(GAME_END 방송 후) 이벤트 — write-behind 정산의 트리거.
 * {@link GameSessionService#endRound}가 발행하고 {@link GameSettlementListener}가 비동기로 받아
 * leaderboards 적재 + rank ZSET 반영을 수행한다. 실시간 경로와 분리해 정산 실패가 게임 진행을 막지 않게 한다.
 *
 * <p>sessionId는 포인트 보상의 <b>중복 지급 판정 키</b>다({@link GameRewardListener}) —
 * 같은 세션이 어떤 이유로 두 번 정산되더라도 지갑은 한 번만 늘어야 한다.</p>
 *
 * <p>chartId는 캐치캐치리듬 곡 지정 라운드(-168)의 번들 채보 id다. 곡마다 노트 수가 달라 점수
 * 스케일이 다르므로, 곡별 랭킹을 나누려면 정산까지 따라와야 한다. 랜덤 채보 라운드와 다른
 * 게임들은 null이다.</p>
 */
public record GameSettledEvent(String sessionId, long gameId, String chartId, List<GameResultEntry> results) {

    /** 채보 개념이 없는 게임의 정산 — chartId 자리를 매번 null로 적지 않게. */
    public GameSettledEvent(String sessionId, long gameId, List<GameResultEntry> results) {
        this(sessionId, gameId, null, results);
    }
}
