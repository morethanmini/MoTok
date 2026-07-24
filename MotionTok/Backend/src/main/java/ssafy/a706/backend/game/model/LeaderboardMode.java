package ssafy.a706.backend.game.model;

/**
 * 리더보드 구분(-96 확장) — 솔로 세션과 멀티 세션 기록을 나눠 집계·노출한다.
 * 판정 기준은 게임 종료 시점 세션 참가 인원(결과 목록 크기): 1명 이하면 SOLO.
 */
public enum LeaderboardMode {
    SOLO, MULTI;

    public static LeaderboardMode ofPlayerCount(int playerCount) {
        return playerCount <= 1 ? SOLO : MULTI;
    }
}
