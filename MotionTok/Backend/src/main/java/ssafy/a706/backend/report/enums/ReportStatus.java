package ssafy.a706.backend.report.enums;

/** 신고 처리 상태 — 접수(RECEIVED)로 시작해 관리자(-133)가 전이시킨다. */
public enum ReportStatus {
    RECEIVED,   // 접수(기본값)
    REVIEWING,  // 검토 중
    RESOLVED,   // 조치 완료
    REJECTED    // 기각
}
