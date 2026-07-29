package ssafy.a706.backend.report;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.report.dto.ReportedUserResponse;
import ssafy.a706.backend.report.enums.ReportReason;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * 신고 유저 목록 (-105).
 *
 * <p>여기서 고정하는 것: 두 신고 테이블을 <b>합산</b>할 것(한쪽만 세면 채팅으로만 문제를 일으키는
 * 계정이 사라진다), 닉네임은 <b>현재</b> 값일 것(관리자가 지금 그 사람을 찾아야 한다),
 * 탈퇴 계정은 목록에 없을 것.</p>
 */
class ReportedUserQueryServiceTest {

    private final UserReportRepository userReportRepository = mock(UserReportRepository.class);
    private final ChatReportRepository chatReportRepository = mock(ChatReportRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);

    private final ReportedUserQueryService service =
            new ReportedUserQueryService(userReportRepository, chatReportRepository, userRepository);

    private static User user(long id, String nickname, UserStatus status) {
        User u = User.builder().email(nickname + "@motok.com").passwordHash("x").nickname(nickname).build();
        ReflectionTestUtils.setField(u, "id", id);
        ReflectionTestUtils.setField(u, "status", status);
        return u;
    }

    private void noReasons() {
        given(userReportRepository.findByReportedUserIdInOrderByIdDesc(anyCollection(), any()))
                .willReturn(List.of());
        given(chatReportRepository.findByReportedUserIdInOrderByIdDesc(anyCollection(), any()))
                .willReturn(List.of());
    }

    @Test
    @DisplayName("사용자 신고와 채팅 신고를 합산한다 — 한쪽만 세면 채팅으로만 문제를 일으키는 계정이 사라진다")
    void sumsBothReportTables() {
        given(userReportRepository.countGroupedByReportedUser(any(Pageable.class)))
                .willReturn(List.of(new ReportCount(7L, 2L)));
        given(chatReportRepository.countGroupedByReportedUser(any(Pageable.class)))
                .willReturn(List.of(new ReportCount(7L, 3L), new ReportCount(8L, 4L)));
        given(userRepository.findAllById(any()))
                .willReturn(List.of(user(7L, "문제회원", UserStatus.ACTIVE), user(8L, "채팅만", UserStatus.ACTIVE)));
        noReasons();

        List<ReportedUserResponse> top = service.topReportedUsers(20);

        // 7번은 2+3=5, 8번은 0+4=4 → 합산 기준으로 정렬돼야 한다
        assertThat(top).extracting(ReportedUserResponse::userId).containsExactly(7L, 8L);
        assertThat(top.get(0).reportCount()).isEqualTo(5L);
        assertThat(top.get(1).reportCount()).isEqualTo(4L);
    }

    @Test
    @DisplayName("닉네임은 현재 값이다 — 신고 시점 스냅샷을 보여 주면 관리자가 대상을 못 찾는다")
    void usesCurrentNicknameNotSnapshot() {
        given(userReportRepository.countGroupedByReportedUser(any(Pageable.class)))
                .willReturn(List.of(new ReportCount(7L, 1L)));
        given(chatReportRepository.countGroupedByReportedUser(any(Pageable.class))).willReturn(List.of());
        given(userRepository.findAllById(any())).willReturn(List.of(user(7L, "바꾼닉네임", UserStatus.ACTIVE)));
        noReasons();

        assertThat(service.topReportedUsers(20)).singleElement()
                .extracting(ReportedUserResponse::nickname).isEqualTo("바꾼닉네임");
    }

    @Test
    @DisplayName("탈퇴 계정은 제외한다 — 제재 대상이 아니고 닉네임이 tombstone이라 누구인지 알 수 없다")
    void excludesWithdrawnAccounts() {
        given(userReportRepository.countGroupedByReportedUser(any(Pageable.class)))
                .willReturn(List.of(new ReportCount(7L, 9L)));
        given(chatReportRepository.countGroupedByReportedUser(any(Pageable.class))).willReturn(List.of());
        given(userRepository.findAllById(any()))
                .willReturn(List.of(user(7L, "deleted_0000000000000000007", UserStatus.DELETED)));
        noReasons();

        assertThat(service.topReportedUsers(20)).isEmpty();
    }

    @Test
    @DisplayName("최근 사유는 사용자별 3개까지 — 무엇 때문에 신고가 몰렸는지 보는 참고 값이다")
    void keepsAtMostThreeRecentReasonsPerUser() {
        given(userReportRepository.countGroupedByReportedUser(any(Pageable.class)))
                .willReturn(List.of(new ReportCount(7L, 5L)));
        given(chatReportRepository.countGroupedByReportedUser(any(Pageable.class))).willReturn(List.of());
        given(userRepository.findAllById(any())).willReturn(List.of(user(7L, "문제회원", UserStatus.ACTIVE)));
        given(userReportRepository.findByReportedUserIdInOrderByIdDesc(anyCollection(), any()))
                .willReturn(List.of(
                        report(7L, 40L, ReportReason.ABUSE),
                        report(7L, 30L, ReportReason.SPAM),
                        report(7L, 20L, ReportReason.HATE),
                        report(7L, 10L, ReportReason.ETC)));
        given(chatReportRepository.findByReportedUserIdInOrderByIdDesc(anyCollection(), any()))
                .willReturn(List.of());

        assertThat(service.topReportedUsers(20)).singleElement()
                .extracting(ReportedUserResponse::recentReasons)
                .isEqualTo(List.of("ABUSE", "SPAM", "HATE"));
    }

    @Test
    @DisplayName("신고가 없으면 빈 목록 — 조회를 더 진행하지 않는다")
    void emptyWhenNoReports() {
        given(userReportRepository.countGroupedByReportedUser(any(Pageable.class))).willReturn(List.of());
        given(chatReportRepository.countGroupedByReportedUser(any(Pageable.class))).willReturn(List.of());

        assertThat(service.topReportedUsers(20)).isEmpty();
    }

    private static UserReport report(long reportedUserId, long id, ReportReason reason) {
        UserReport r = UserReport.builder()
                .reporterUserId(1L).reporterNickname("신고자")
                .reportedUserId(reportedUserId).reportedNickname("문제회원")
                .reason(reason).reasonDetail(null)
                .build();
        ReflectionTestUtils.setField(r, "id", id);
        return r;
    }
}
