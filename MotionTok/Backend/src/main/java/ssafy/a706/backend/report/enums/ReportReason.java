package ssafy.a706.backend.report.enums;

/** 채팅 신고 사유(-132). 세분화가 필요해지면 값 추가로 확장한다. */
public enum ReportReason {
    ABUSE,      // 욕설·비방
    HATE,       // 혐오·차별
    SEXUAL,     // 음란·성희롱
    SPAM,       // 도배·광고
    ETC         // 기타(상세는 reasonDetail)
}
