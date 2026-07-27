package ssafy.a706.backend.report;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.report.dto.UserReportCreateRequest;
import ssafy.a706.backend.report.dto.UserReportCreateResponse;
import ssafy.a706.backend.report.enums.ReportStatus;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;

/**
 * 사용자 신고 접수(-112) — 프로필 화면에서 특정 회원을 신고한다.
 *
 * <p>여기서 지키는 것은 세 가지다:</p>
 * <ol>
 *   <li><b>대상은 서버가 조회한다</b> — 요청에는 userId만 있고 닉네임은 없다.
 *       클라이언트가 준 이름을 기록하면 존재하지 않는 사람을 신고한 기록을 만들 수 있다.</li>
 *   <li><b>자기 신고 차단</b> — 통계만 오염시킬 뿐 아무 의미가 없다.</li>
 *   <li><b>처리 안 된 신고가 있으면 중복 접수 차단</b> — 같은 사람이 같은 대상을 연타하면
 *       관리자 목록이 한 사람으로 뒤덮인다. 다만 처리가 끝난 뒤에는 다시 신고할 수 있어야 한다
 *       (반복 가해는 실제로 일어난다). {@link UserReportRepository} 주석 참고.</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class UserReportService {

    /** 아직 관리자가 결론 내지 않은 상태들 — 이 상태의 신고가 있으면 같은 대상을 다시 신고할 수 없다. */
    private static final List<ReportStatus> OPEN_STATUSES =
            List.of(ReportStatus.RECEIVED, ReportStatus.REVIEWING);

    private final UserReportRepository userReportRepository;
    private final UserRepository userRepository;

    @Transactional
    public UserReportCreateResponse create(Long reporterId, UserReportCreateRequest request) {
        if (reporterId.equals(request.reportedUserId())) {
            throw new BusinessException(ErrorCode.USER_REPORT_SELF);
        }

        User reporter = activeUser(reporterId);
        // 탈퇴·정지 계정은 프로필 조회 자체가 404이므로(-96) 신고 대상으로도 잡히지 않는 게 일관적이다.
        User reported = activeUser(request.reportedUserId());

        if (userReportRepository.existsByReporterUserIdAndReportedUserIdAndStatusIn(
                reporterId, reported.getId(), OPEN_STATUSES)) {
            throw new BusinessException(ErrorCode.USER_REPORT_DUPLICATE);
        }

        UserReport saved = userReportRepository.save(UserReport.builder()
                .reporterUserId(reporter.getId())
                .reporterNickname(reporter.getNickname())
                .reportedUserId(reported.getId())
                .reportedNickname(reported.getNickname())
                .reason(request.reasonType())
                .reasonDetail(blankToNull(request.reasonText()))
                .build());

        return new UserReportCreateResponse(saved.getId());
    }

    private User activeUser(Long userId) {
        return userRepository.findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    /** 빈 문자열을 그대로 저장하면 "직접 입력 사유가 있다"와 구분되지 않는다. */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
