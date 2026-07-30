package ssafy.a706.backend.report;

/**
 * 피신고자별 신고 건수 — 두 신고 테이블의 집계를 같은 모양으로 받기 위한 값이다.
 *
 * <p>사용자 신고와 채팅 신고를 <b>합산</b>해야 "이 사람이 얼마나 신고당했나"가 나온다.
 * 한쪽만 세면 채팅으로만 문제를 일으키는 계정이 목록에서 사라진다.</p>
 */
public record ReportCount(Long userId, long count) {
}
