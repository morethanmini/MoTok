package ssafy.a706.backend.game.model;

/**
 * Redis game:session:{roomId} 해시에서 복원한 게임 세션 상태.
 * startAt/endAt은 epoch millis(서버 권위 시각) — 클라이언트는 GAME_START의
 * serverNow와 자기 시계의 차이로 오프셋을 계산해 타이머를 맞춘다.
 *
 * <p>challenge는 게임별 과제 payload(S15P11A706-137에서 일반화) —
 * 게임①(핑거 스타): 별자리 키, 게임④(몸 끼워 맞추기): 출제 포즈 랜드마크 JSON.
 * 시작 시점에 과제가 없는 게임(출제 페이즈가 따로 있는 게임④)은 null로 시작해
 * 세션 도중 갱신된다.</p>
 */
public record GameSession(
        String sessionId,
        long gameId,
        String challenge,
        /** 출제자 userId — 출제 페이즈가 있는 게임(게임④, S15P11A706-86)만. 게임①은 null */
        String setterUserId,
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
