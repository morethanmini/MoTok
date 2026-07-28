package ssafy.a706.backend.game.dto;

import java.util.List;

/**
 * 게임 이벤트 브로드캐스트 페이로드 (S15P11A706-115, SUBSCRIBE /topic/rooms/{roomId}/game).
 * type으로 구분하는 단일 토픽 유니온 — 채팅(ChatMessageResponse) 패턴과 동일.
 *
 * <ul>
 *   <li>GAME_START — 방장 시작 수리. startAt(카운트다운 종료·라운드 시작)·endAt은 epoch millis.
 *       클라이언트는 serverNow와 자기 시계 차이로 오프셋을 보정한다(서버 권위 타이머).
 *       그림으로 말해요(게임 10)는 topicWord·turnOrder·turnDurationSec·handoverSec가 함께 실린다.</li>
 *   <li>PROGRESS — 참가자 진행 상황 중계(비영속). userId·starsLit·holdProgress만 유효.</li>
 *   <li>PLAYER_FINISHED — 참가자 최초 제출 수리. score·starsHit 유효.</li>
 *   <li>GAME_END — 서버 정산. results(순위 내림차순) 유효. 이후 방 상태는 WAITING 복귀.</li>
 *   <li>DRAW — 그리기 릴레이(게임 10, 비영속). userId(화가)·seq·ops 유효. 발신자는 자기 에코 무시.</li>
 *   <li>TURN_SKIPPED — 조기 차례 넘기기(게임 10). userId·turnIndex·remainingMs 유효 —
 *       전 클라이언트(발신자 포함, 에코 기준)가 remainingMs만큼 턴 스케줄을 앞당긴다.</li>
 *   <li>DRAW_RESULT — AI 채점 수리(게임 10). userId(채점 발신자)·guesses·answerRank·score 유효.
 *       직후 협동 정산 GAME_END(전원 rank 1·동일 score)가 따라온다. (명세 v0.2.20)</li>
 * </ul>
 */
public record GameEventResponse(
        EventType type,
        String sessionId,
        Long gameId,
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
        List<GameResultEntry> results,
        String topicWord,
        List<String> turnOrder,
        Integer turnDurationSec,
        Integer handoverSec,
        Long seq,
        List<DrawOp> ops,
        List<String> guesses,
        Integer answerRank,
        Integer turnIndex,
        Long remainingMs
) {

    public enum EventType { GAME_START, PROGRESS, PLAYER_FINISHED, GAME_END, DRAW, DRAW_RESULT, TURN_SKIPPED }

    public static GameEventResponse gameStart(String sessionId, long gameId, String constellationKey,
                                              long serverNow, long startAt, long endAt) {
        return new GameEventResponse(EventType.GAME_START, sessionId, gameId, constellationKey,
                serverNow, startAt, endAt, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null);
    }

    /** 그림으로 말해요 시작 — 주제어·화가 순서·턴 스케줄 파라미터를 함께 배포한다. */
    public static GameEventResponse gameStartDraw(String sessionId, long gameId, long serverNow,
                                                  long startAt, long endAt, String topicWord,
                                                  List<String> turnOrder, int turnDurationSec,
                                                  int handoverSec) {
        return new GameEventResponse(EventType.GAME_START, sessionId, gameId, null,
                serverNow, startAt, endAt, null, null, null, null, null, null, null,
                topicWord, turnOrder, turnDurationSec, handoverSec, null, null, null, null, null, null);
    }

    public static GameEventResponse progress(String sessionId, String userId, String nickname,
                                             int starsLit, double holdProgress) {
        return new GameEventResponse(EventType.PROGRESS, sessionId, null, null,
                null, null, null, userId, nickname, starsLit, holdProgress, null, null, null,
                null, null, null, null, null, null, null, null, null, null);
    }

    public static GameEventResponse playerFinished(String sessionId, String userId, String nickname,
                                                   int score, int starsHit) {
        return new GameEventResponse(EventType.PLAYER_FINISHED, sessionId, null, null,
                null, null, null, userId, nickname, null, null, score, starsHit, null,
                null, null, null, null, null, null, null, null, null, null);
    }

    public static GameEventResponse gameEnd(String sessionId, List<GameResultEntry> results) {
        return new GameEventResponse(EventType.GAME_END, sessionId, null, null,
                null, null, null, null, null, null, null, null, null, results,
                null, null, null, null, null, null, null, null, null, null);
    }

    /** 그리기 릴레이 재방송 — 발신 페이로드 + 화가 userId. */
    public static GameEventResponse draw(String sessionId, String userId, Long seq, List<DrawOp> ops) {
        return new GameEventResponse(EventType.DRAW, sessionId, null, null,
                null, null, null, userId, null, null, null, null, null, null,
                null, null, null, null, seq, ops, null, null, null, null);
    }

    /** 조기 차례 넘기기 재방송 — 전 클라이언트가 remainingMs만큼 턴 스케줄을 앞당긴다. */
    public static GameEventResponse turnSkipped(String sessionId, String userId, int turnIndex,
                                                long remainingMs) {
        return new GameEventResponse(EventType.TURN_SKIPPED, sessionId, null, null,
                null, null, null, userId, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, turnIndex, remainingMs);
    }

    /** AI 채점 결과 방송 — score 필드에 순위 점수(1위 100 … 5위 20)를 싣는다. */
    public static GameEventResponse drawResult(String sessionId, String userId, List<String> guesses,
                                               int answerRank, int score) {
        return new GameEventResponse(EventType.DRAW_RESULT, sessionId, null, null,
                null, null, null, userId, null, null, null, score, null, null,
                null, null, null, null, null, null, guesses, answerRank, null, null);
    }
}
