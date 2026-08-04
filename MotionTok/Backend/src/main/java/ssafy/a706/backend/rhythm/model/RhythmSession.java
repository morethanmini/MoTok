package ssafy.a706.backend.rhythm.model;

/**
 * 캐치캐치리듬 세션 (에픽 S15P11A706-7).
 *
 * <p>기존 {@code game.model.GameSession}과 별개다 — 게임마다 세션 필드가 달라지는데
 * 하나의 레코드를 여섯 게임이 나눠 쓰면 필드가 계속 늘고 MR이 충돌한다.
 * 이 게임은 자기 세션·자기 Redis 키·자기 토픽을 갖는다.</p>
 *
 * @param seed       방 전원이 같은 채보를 만들기 위한 시드. 클라이언트에 문자열로 내려간다
 *                   (Java long이 JS number 정밀도 2^53을 넘을 수 있다)
 * @param difficulty EASY | NORMAL | HARD (곡 지정 라운드는 MANUAL | EXTREME도 가능)
 * @param mode       catch | ring — 방 전원이 같은 모드로 플레이한다
 * @param songId     곡 지정 라운드(-168)의 번들 채보 id. 시드 기반 랜덤 채보면 null.
 *                   정산까지 실어 보내야 곡별 랭킹을 나눌 수 있다(S15P11A706-186 이벤트 보드).
 * @param startAt    라운드 시작(epoch millis) — 카운트다운이 끝나는 시각
 * @param endAt      라운드 종료(epoch millis)
 */
public record RhythmSession(
        String sessionId,
        long seed,
        String difficulty,
        String mode,
        String songId,
        long startAt,
        long endAt,
        String status
) {

    public static final String STATUS_PLAYING = "PLAYING";
    public static final String STATUS_ENDED = "ENDED";

    /** 아직 진행 중인가. graceMillis는 마지막 제출 프레임의 전송 지연 유예. */
    public boolean isPlaying(long nowMillis, long graceMillis) {
        return STATUS_PLAYING.equals(status) && nowMillis <= endAt + graceMillis;
    }
}
