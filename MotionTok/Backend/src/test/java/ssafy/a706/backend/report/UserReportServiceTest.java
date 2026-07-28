package ssafy.a706.backend.report;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.report.dto.UserReportCreateRequest;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.report.enums.ReportStatus;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 사용자 신고 접수 규칙(-112).
 *
 * <p>여기서 지키는 것: 피신고자 정보는 <b>서버가 조회한 값</b>만 기록할 것,
 * 자기 신고와 처리 중 중복 신고를 막을 것, 그리고 처리가 끝난 뒤에는 다시 신고할 수 있을 것.</p>
 */
class UserReportServiceTest {

    private static final long REPORTER_ID = 7L;
    private static final long REPORTED_ID = 9L;

    private final UserReportRepository userReportRepository = mock(UserReportRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);

    private final UserReportService service = new UserReportService(userReportRepository, userRepository);

    private User user(long id, String nickname) {
        User u = User.builder().email(nickname + "@motok.com").passwordHash("x").nickname(nickname).build();
        ReflectionTestUtils.setField(u, "id", id);
        given(userRepository.findById(id)).willReturn(Optional.of(u));
        return u;
    }

    private static UserReportCreateRequest request() {
        return new UserReportCreateRequest(REPORTED_ID, ReportReason.ABUSE, "욕설을 반복했어요");
    }

    private UserReport captureSaved() {
        ArgumentCaptor<UserReport> captor = ArgumentCaptor.forClass(UserReport.class);
        verify(userReportRepository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("피신고자 닉네임은 서버가 조회해 스냅샷한다 — 요청에는 userId만 있다")
    void snapshotsNicknamesFromDb() {
        user(REPORTER_ID, "신고한사람");
        user(REPORTED_ID, "신고당한사람");
        given(userReportRepository.save(any())).willAnswer(inv -> {
            UserReport r = inv.getArgument(0);
            ReflectionTestUtils.setField(r, "id", 100L);
            return r;
        });

        assertThat(service.create(REPORTER_ID, request()).reportId()).isEqualTo(100L);

        UserReport saved = captureSaved();
        assertThat(saved.getReporterNickname()).isEqualTo("신고한사람");
        assertThat(saved.getReportedNickname()).isEqualTo("신고당한사람");
        assertThat(saved.getReason()).isEqualTo(ReportReason.ABUSE);
        assertThat(saved.getStatus()).isEqualTo(ReportStatus.RECEIVED);
    }

    @Test
    @DisplayName("자기 자신은 신고할 수 없다 — 조회조차 하지 않는다")
    void rejectsSelfReport() {
        assertThatThrownBy(() -> service.create(REPORTED_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.USER_REPORT_SELF);

        verify(userRepository, never()).findById(anyLong());
        verify(userReportRepository, never()).save(any());
    }

    @Test
    @DisplayName("탈퇴·정지 계정은 신고 대상이 아니다 — 프로필 조회가 404인 것과 같은 선")
    void rejectsInactiveTarget() {
        user(REPORTER_ID, "신고한사람");
        User withdrawn = user(REPORTED_ID, "탈퇴한사람");
        ReflectionTestUtils.setField(withdrawn, "status", UserStatus.DELETED);

        assertThatThrownBy(() -> service.create(REPORTER_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.USER_NOT_FOUND);

        verify(userReportRepository, never()).save(any());
    }

    @Test
    @DisplayName("처리 중인 신고가 이미 있으면 중복 접수를 막는다")
    void rejectsDuplicateWhileOpen() {
        user(REPORTER_ID, "신고한사람");
        user(REPORTED_ID, "신고당한사람");
        given(userReportRepository.existsByReporterUserIdAndReportedUserIdAndStatusIn(
                REPORTER_ID, REPORTED_ID, java.util.List.of(ReportStatus.RECEIVED, ReportStatus.REVIEWING)))
                .willReturn(true);

        assertThatThrownBy(() -> service.create(REPORTER_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.USER_REPORT_DUPLICATE);

        verify(userReportRepository, never()).save(any());
    }

    @Test
    @DisplayName("처리가 끝난 신고만 있으면 같은 대상을 다시 신고할 수 있다 — 반복 가해를 막으려면 통로가 열려 있어야 한다")
    void allowsReportAgainAfterResolved() {
        user(REPORTER_ID, "신고한사람");
        user(REPORTED_ID, "신고당한사람");
        // RESOLVED·REJECTED만 남은 상태 = 열린 신고 없음
        given(userReportRepository.existsByReporterUserIdAndReportedUserIdAndStatusIn(any(), any(), any()))
                .willReturn(false);
        given(userReportRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.create(REPORTER_ID, request());

        verify(userReportRepository).save(any());
    }

    @Test
    @DisplayName("직접 입력 사유가 공백뿐이면 null로 저장한다 — '입력됨'과 구분되어야 한다")
    void blankReasonTextBecomesNull() {
        user(REPORTER_ID, "신고한사람");
        user(REPORTED_ID, "신고당한사람");
        given(userReportRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.create(REPORTER_ID, new UserReportCreateRequest(REPORTED_ID, ReportReason.SPAM, "   "));

        assertThat(captureSaved().getReasonDetail()).isNull();
    }
}
