package ssafy.a706.backend.report.dto;

/** 신고 접수 결과(-112). 채팅 신고와 같이 접수된 신고 ID만 돌려준다. */
public record UserReportCreateResponse(Long reportId) {
}
