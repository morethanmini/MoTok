package ssafy.a706.backend.report.dto;

import java.util.List;

/**
 * 신고 유저 목록 한 줄 (-105) — 누적 신고 횟수순.
 *
 * @param userId        피신고자
 * @param nickname      <b>현재</b> 닉네임. 신고 시점 스냅샷이 아니다 — 관리자는 지금 그 사람을
 *                      찾아 제재해야 하므로 과거 이름을 보여 주면 대상을 못 찾는다
 *                      (이력 화면은 반대로 시점 스냅샷을 쓴다)
 * @param reportCount   사용자 신고 + 채팅 신고 합계. 한쪽만 세면 채팅으로만 문제를 일으키는
 *                      계정이 목록에서 사라진다
 * @param recentReasons 최근 신고 사유(최신순, 최대 3개). 무엇 때문에 신고가 몰렸는지 보는 참고 값이다
 */
public record ReportedUserResponse(
        Long userId,
        String nickname,
        long reportCount,
        List<String> recentReasons
) {
}
