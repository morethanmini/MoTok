package ssafy.a706.backend.rhythm.dto;

import java.util.List;

/**
 * {@code /topic/rooms/{roomId}/rhythm} 로 나가는 이벤트 유니온.
 * 기존 게임 채널(GameEventResponse)과 완전히 분리돼 있어 서로의 필드를 늘리지 않는다.
 *
 * <table>
 *   <tr><td>RHYTHM_START</td><td>sessionId·seed·difficulty·serverNow·startAt·endAt</td></tr>
 *   <tr><td>PROGRESS</td><td>sessionId·userId·nickname·score·combo (비영속 중계)</td></tr>
 *   <tr><td>PLAYER_FINISHED</td><td>sessionId·userId·nickname·score·maxCombo</td></tr>
 *   <tr><td>RHYTHM_END</td><td>sessionId·results</td></tr>
 * </table>
 *
 * <p>seed를 <b>문자열</b>로 내리는 이유: Java long이 JS number 정밀도(2^53)를 넘을 수 있어
 * 숫자로 보내면 클라이언트마다 다른 값으로 반올림돼 채보가 갈린다.</p>
 */
public record RhythmEventResponse(
        String type,
        String sessionId,
        String seed,
        String difficulty,
        String mode,
        Long serverNow,
        Long startAt,
        Long endAt,
        String userId,
        String nickname,
        Integer score,
        Integer combo,
        Integer maxCombo,
        List<RhythmResultEntry> results
) {

    public static RhythmEventResponse start(String sessionId, long seed, String difficulty,
                                            String mode, long serverNow, long startAt, long endAt) {
        return new RhythmEventResponse("RHYTHM_START", sessionId, Long.toString(seed), difficulty,
                mode, serverNow, startAt, endAt, null, null, null, null, null, null);
    }

    public static RhythmEventResponse progress(String sessionId, String userId, String nickname,
                                               int score, int combo) {
        return new RhythmEventResponse("PROGRESS", sessionId, null, null, null,
                null, null, null, userId, nickname, score, combo, null, null);
    }

    public static RhythmEventResponse playerFinished(String sessionId, String userId, String nickname,
                                                     int score, int maxCombo) {
        return new RhythmEventResponse("PLAYER_FINISHED", sessionId, null, null, null,
                null, null, null, userId, nickname, score, null, maxCombo, null);
    }

    public static RhythmEventResponse end(String sessionId, List<RhythmResultEntry> results) {
        return new RhythmEventResponse("RHYTHM_END", sessionId, null, null, null,
                null, null, null, null, null, null, null, null, results);
    }
}
