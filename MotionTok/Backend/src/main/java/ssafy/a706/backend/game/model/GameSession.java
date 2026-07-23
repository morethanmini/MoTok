package ssafy.a706.backend.game.model;

/**
 * Redis game:session:{roomId} 해시에서 복원한 게임 세션 상태.
 * startAt/endAt은 epoch millis(서버 권위 시각) — 클라이언트는 GAME_START의
 * serverNow와 자기 시계의 차이로 오프셋을 계산해 타이머를 맞춘다.
 */
public record GameSession(
        String sessionId,
        long gameId,
        String constellationKey,
        long startAt,
        long endAt,
        String status
) {
    public static final String STATUS_PLAYING = "PLAYING";
    public static final String STATUS_ENDED = "ENDED";

    public boolean isPlaying(long nowMillis, long graceMillis) {
        return STATUS_PLAYING.equals(status) && nowMillis < endAt + graceMillis;
    }
}
