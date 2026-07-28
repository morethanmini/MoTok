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
 *       하위호환 필드로, 게임①일 때만 challenge와 같은 값이 실린다.
 *       그림으로 말해요(게임 10)는 topicWord·turnOrder·turnDurationSec·handoverSec가 함께 실린다.</li>
 *   <li>POSE_SET — 게임④ 출제자 포즈 수리(-86). challenge(랜드마크 JSON)·userId(출제자) 유효.
 *       각 클라이언트가 이 랜드마크로 같은 벽을 렌더한다.</li>
 *   <li>PROGRESS — 참가자 진행 상황 중계(비영속). userId·starsLit·holdProgress만 유효.</li>
 *   <li>PLAYER_FINISHED — 참가자 최초 제출 수리. score·starsHit 유효.</li>
 *   <li>GAME_END — 서버 정산. results(순위 내림차순) 유효. 이후 방 상태는 WAITING 복귀.</li>
 *   <li>DRAW — 그리기 릴레이(게임 10, 비영속). userId(화가)·seq·ops 유효. 발신자는 자기 에코 무시.</li>
 *   <li>TURN_SKIPPED — 조기 차례 넘기기(게임 10). userId·turnIndex·remainingMs 유효 —
 *       전 클라이언트(발신자 포함, 에코 기준)가 remainingMs만큼 턴 스케줄을 앞당긴다.</li>
 *   <li>DRAW_RESULT — AI 채점 수리(게임 10). userId(채점 발신자)·guesses·answerRank·score 유효.
 *       직후 협동 정산 GAME_END(전원 rank 1·동일 score)가 따라온다. (명세 v0.2.20)</li>
 * </ul>
 *
 * <p><b>필드 추가 시 주의</b> — 위치 인자 29개짜리 record라 팩토리가 전부 null로 자리를 맞춘다.
 * 순서가 어긋나도 전부 null이면 컴파일이 통과해버리므로, 필드를 추가할 때는 <b>맨 뒤에만</b>
 * 붙이고 아래 팩토리 9개의 인자 개수를 함께 늘릴 것. 각 팩토리에 위치 주석을 달아두었다.
 * (게임④ -48과 게임⑩ 명세 v0.2.20/21이 같은 record에 동시에 필드를 추가하며 충돌했던 지점)</p>
 */
public record GameEventResponse(
        // 1~3 공통 식별자
        EventType type,
        String sessionId,
        Long gameId,
        // 4~7 게임①·④ 과제/출제 메타
        String challenge,
        String constellationKey,
        String setterUserId,
        String difficulty,
        // 8~10 서버 권위 타이머
        Long serverNow,
        Long startAt,
        Long endAt,
        // 11~17 참가자 진행·결과 공통
        String userId,
        String nickname,
        Integer starsLit,
        Double holdProgress,
        Integer score,
        Integer starsHit,
        List<GameResultEntry> results,
        // 18~19 게임④ 출제자 로테이션(-48)
        /** 1-based 현재 라운드. 로테이션 없는 게임은 null */
        Integer roundNo,
        /** 전체 라운드 수(참가자 수). 로테이션 없는 게임은 null */
        Integer totalRounds,
        // 20~27 그림으로 말해요(게임 10, 명세 v0.2.20)
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

    public enum EventType {
        GAME_START, POSE_SET, PROGRESS, PLAYER_FINISHED, GAME_END, DRAW, DRAW_RESULT, TURN_SKIPPED
    }

    public static GameEventResponse gameStart(String sessionId, long gameId, String challenge,
                                              String legacyConstellationKey, String setterUserId,
                                              String difficulty,
                                              long serverNow, long startAt, long endAt,
                                              Integer roundNo, Integer totalRounds) {
        return new GameEventResponse(
                EventType.GAME_START, sessionId, gameId,          // 1~3
                challenge, legacyConstellationKey, setterUserId, difficulty, // 4~7
                serverNow, startAt, endAt,                        // 8~10
                null, null, null, null, null, null, null,         // 11~17
                roundNo, totalRounds,                             // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                null, null);                                      // 28~29
    }

    /** 그림으로 말해요 시작 — 주제어·화가 순서·턴 스케줄 파라미터를 함께 배포한다. */
    public static GameEventResponse gameStartDraw(String sessionId, long gameId, long serverNow,
                                                  long startAt, long endAt, String topicWord,
                                                  List<String> turnOrder, int turnDurationSec,
                                                  int handoverSec) {
        return new GameEventResponse(
                EventType.GAME_START, sessionId, gameId,          // 1~3
                null, null, null, null,                           // 4~7
                serverNow, startAt, endAt,                        // 8~10
                null, null, null, null, null, null, null,         // 11~17
                null, null,                                       // 18~19
                topicWord, turnOrder, turnDurationSec, handoverSec, // 20~23
                null, null, null, null,                           // 24~27
                null, null);                                      // 28~29
    }

    public static GameEventResponse poseSet(String sessionId, String setterUserId, String challenge) {
        return new GameEventResponse(
                EventType.POSE_SET, sessionId, null,              // 1~3
                challenge, null, setterUserId, null,              // 4~7
                null, null, null,                                 // 8~10
                setterUserId, null, null, null, null, null, null, // 11~17
                null, null,                                       // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                null, null);                                      // 28~29
    }

    public static GameEventResponse progress(String sessionId, String userId, String nickname,
                                             int starsLit, double holdProgress) {
        return new GameEventResponse(
                EventType.PROGRESS, sessionId, null,              // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                userId, nickname, starsLit, holdProgress, null, null, null, // 11~17
                null, null,                                       // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                null, null);                                      // 28~29
    }

    public static GameEventResponse playerFinished(String sessionId, String userId, String nickname,
                                                   int score, int starsHit) {
        return new GameEventResponse(
                EventType.PLAYER_FINISHED, sessionId, null,       // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                userId, nickname, null, null, score, starsHit, null, // 11~17
                null, null,                                       // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                null, null);                                      // 28~29
    }

    public static GameEventResponse gameEnd(String sessionId, List<GameResultEntry> results) {
        return new GameEventResponse(
                EventType.GAME_END, sessionId, null,              // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                null, null, null, null, null, null, results,      // 11~17
                null, null,                                       // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                null, null);                                      // 28~29
    }

    /** 그리기 릴레이 재방송 — 발신 페이로드 + 화가 userId. */
    public static GameEventResponse draw(String sessionId, String userId, Long seq, List<DrawOp> ops) {
        return new GameEventResponse(
                EventType.DRAW, sessionId, null,                  // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                userId, null, null, null, null, null, null,       // 11~17
                null, null,                                       // 18~19
                null, null, null, null,                           // 20~23
                seq, ops, null, null,                             // 24~27
                null, null);                                      // 28~29
    }

    /** 조기 차례 넘기기 재방송 — 전 클라이언트가 remainingMs만큼 턴 스케줄을 앞당긴다. */
    public static GameEventResponse turnSkipped(String sessionId, String userId, int turnIndex,
                                                long remainingMs) {
        return new GameEventResponse(
                EventType.TURN_SKIPPED, sessionId, null,          // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                userId, null, null, null, null, null, null,       // 11~17
                null, null,                                       // 18~19
                null, null, null, null, null, null, null, null,   // 20~27
                turnIndex, remainingMs);                          // 28~29
    }

    /** AI 채점 결과 방송 — score 필드에 순위 점수(1위 100 … 5위 20)를 싣는다. */
    public static GameEventResponse drawResult(String sessionId, String userId, List<String> guesses,
                                               int answerRank, int score) {
        return new GameEventResponse(
                EventType.DRAW_RESULT, sessionId, null,           // 1~3
                null, null, null, null,                           // 4~7
                null, null, null,                                 // 8~10
                userId, null, null, null, score, null, null,      // 11~17
                null, null,                                       // 18~19
                null, null, null, null,                           // 20~23
                null, null, guesses, answerRank,                  // 24~27
                null, null);                                      // 28~29
    }
}
