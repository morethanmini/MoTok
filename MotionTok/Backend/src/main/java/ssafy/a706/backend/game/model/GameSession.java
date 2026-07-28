package ssafy.a706.backend.game.model;

import java.util.List;

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
        String status,
        /** 게임④ 출제자 로테이션 순서(S15P11A706-48) — 참가 순(joinedAt)으로 고정. 로테이션 없는 게임은 빈 리스트 */
        List<String> setterOrder,
        /** setterOrder 안의 0-based 현재 라운드 인덱스 — 로테이션 없는 게임은 항상 0 */
        int roundIndex,
        /** 게임④ 난이도(easy/normal/hard) — 다음 라운드도 같은 난이도를 쓰기 위해 세션에 고정해둔다 */
        String difficulty
) {
    public static final String STATUS_PLAYING = "PLAYING";
    public static final String STATUS_ENDED = "ENDED";

    public boolean isPlaying(long nowMillis, long graceMillis) {
        return STATUS_PLAYING.equals(status) && nowMillis < endAt + graceMillis;
    }
}
