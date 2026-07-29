package ssafy.a706.backend.user.controller.dto;

/**
 * 게임별 전적 한 줄 (명세서 Record 스키마 + mode 가산, -97 내 전적·-141 친구 상세).
 * 같은 게임이라도 솔로/멀티 기록은 별개 행이다 — 리더보드 집계(-96)와 같은 구분.
 */
public record GameRecordResponse(
        long gameId,
        String gameName,
        /** SOLO | MULTI. 명세 Record엔 없던 필드라 가산 — 구 소비처는 무시해도 된다. */
        String mode,
        int playCount,
        int bestScore,
        /**
         * 1-기반 세계순위(ZREVRANK 원시 순위). 탈퇴·정지 계정이 ZSET에 남아 노출 목록과
         * 미세하게 어긋날 수 있다 — 리더보드 myRank(-96)와 동일한 기지 한계.
         */
        int rankNo
) {
}
