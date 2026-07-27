package ssafy.a706.backend.game.dto;

import java.util.List;

/**
 * 게임 이벤트 브로드캐스트 페이로드 (S15P11A706-115, SUBSCRIBE /topic/rooms/{roomId}/game).
 * type으로 구분하는 단일 토픽 유니온 — 채팅(ChatMessageResponse) 패턴과 동일.
 *
 * <ul>
 *   <li>GAME_START — 방장 시작 수리. startAt(카운트다운 종료·라운드 시작)·endAt은 epoch millis.
 *       클라이언트는 serverNow와 자기 시계 차이로 오프셋을 보정한다(서버 권위 타이머).
 *       challenge는 게임별 과제 payload(-137) — constellationKey는 게임①(핑거 스타)
 *       하위호환 필드로, 게임①일 때만 challenge와 같은 값이 실린다.</li>
 *   <li>PROGRESS — 참가자 진행 상황 중계(비영속). userId·starsLit·holdProgress만 유효.</li>
 *   <li>PLAYER_FINISHED — 참가자 최초 제출 수리. score·starsHit 유효.</li>
 *   <li>GAME_END — 서버 정산. results(순위 내림차순) 유효. 이후 방 상태는 WAITING 복귀.</li>
 * </ul>
 */
public record GameEventResponse(
        EventType type,
        String sessionId,
        Long gameId,
        String challenge,
        String constellationKey,
        Long serverNow,
        Long startAt,
        Long endAt,
        String userId,
        String nickname,
        Integer starsLit,
        Double holdProgress,
        Integer score,
        Integer starsHit,
        List<GameResultEntry> results
) {

    public enum EventType { GAME_START, PROGRESS, PLAYER_FINISHED, GAME_END }

    public static GameEventResponse gameStart(String sessionId, long gameId, String challenge,
                                              String legacyConstellationKey,
                                              long serverNow, long startAt, long endAt) {
        return new GameEventResponse(EventType.GAME_START, sessionId, gameId, challenge,
                legacyConstellationKey, serverNow, startAt, endAt,
                null, null, null, null, null, null, null);
    }

    public static GameEventResponse progress(String sessionId, String userId, String nickname,
                                             int starsLit, double holdProgress) {
        return new GameEventResponse(EventType.PROGRESS, sessionId, null, null, null,
                null, null, null, userId, nickname, starsLit, holdProgress, null, null, null);
    }

    public static GameEventResponse playerFinished(String sessionId, String userId, String nickname,
                                                   int score, int starsHit) {
        return new GameEventResponse(EventType.PLAYER_FINISHED, sessionId, null, null, null,
                null, null, null, userId, nickname, null, null, score, starsHit, null);
    }

    public static GameEventResponse gameEnd(String sessionId, List<GameResultEntry> results) {
        return new GameEventResponse(EventType.GAME_END, sessionId, null, null, null,
                null, null, null, null, null, null, null, null, null, results);
    }
}
