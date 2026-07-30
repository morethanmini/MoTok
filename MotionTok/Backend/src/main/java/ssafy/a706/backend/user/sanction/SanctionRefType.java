package ssafy.a706.backend.user.sanction;

/**
 * 제재의 근거가 된 신고가 어느 테이블의 행인지.
 *
 * <p><b>왜 필요한가.</b> 사용자 신고({@code user_reports})와 채팅 신고({@code chat_reports})는
 * 별개 테이블이고 id가 각각 1부터 증가한다. 유형 없이 id만 남기면 {@code ref_report_id=7}이
 * 어느 쪽 7번인지 알 수 없다 — 관리자가 제재 근거를 되짚을 수 없고, 그게 이력을 남기는 이유의 절반이다.
 *
 * <p>두 테이블을 각각 FK로 묶지 않고 (유형, id) 쌍으로 두는 이유는 <b>직권 제재</b>가 있어서다.
 * 신고 없이 내리는 제재는 둘 다 null이 되므로 어느 쪽으로도 NOT NULL FK를 걸 수 없다.
 */
public enum SanctionRefType {
    USER_REPORT,   // user_reports.id — 불량 사용자 신고(-112)
    CHAT_REPORT    // chat_reports.id — 채팅 신고(-132·-133)
}
