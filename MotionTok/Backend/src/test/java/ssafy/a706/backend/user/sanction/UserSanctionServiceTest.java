package ssafy.a706.backend.user.sanction;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.CloseStatus;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.global.notification.UserNotification;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.service.RoomPresenceTracker;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserRole;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.sanction.dto.BanUserRequest;
import ssafy.a706.backend.user.sanction.dto.ReleaseSuspensionRequest;
import ssafy.a706.backend.user.sanction.dto.SuspendUserRequest;
import ssafy.a706.backend.user.sanction.dto.WarnUserRequest;
import ssafy.a706.backend.user.sanction.dto.SanctionStatusResponse;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 계정 제재 규칙.
 *
 * <p>여기서 고정하는 것: 정지 상태는 <b>Redis TTL</b>에만 두고 users는 건드리지 말 것,
 * 이력은 <b>TTL과 무관하게</b> 남을 것, 그리고 제재 대상 검증(자기 자신·관리자·탈퇴 계정)이
 * 저장보다 먼저 일어날 것.</p>
 */
class UserSanctionServiceTest {

    private static final long ADMIN_ID = 1L;
    private static final long TARGET_ID = 9L;

    private final SanctionHistoryRepository sanctionHistoryRepository = mock(SanctionHistoryRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);
    private final RefreshTokenStore refreshTokenStore = mock(RefreshTokenStore.class);
    private final PresenceService presenceService = mock(PresenceService.class);
    private final RoomPresenceTracker roomPresenceTracker = mock(RoomPresenceTracker.class);
    private final StompSessionRegistry stompSessionRegistry = mock(StompSessionRegistry.class);
    private final UserNotifier userNotifier = mock(UserNotifier.class);

    private final UserSanctionService service = new UserSanctionService(
            sanctionHistoryRepository, userRepository, accountBlockStore, refreshTokenStore,
            presenceService, roomPresenceTracker, stompSessionRegistry, userNotifier);

    private User user(long id, String nickname, UserRole role) {
        User u = User.builder().email(nickname + "@motok.com").passwordHash("x").nickname(nickname).build();
        ReflectionTestUtils.setField(u, "id", id);
        ReflectionTestUtils.setField(u, "role", role);
        given(userRepository.findById(id)).willReturn(Optional.of(u));
        return u;
    }

    private static SuspendUserRequest request() {
        return new SuspendUserRequest(3, "욕설 반복", 55L, SanctionRefType.USER_REPORT);
    }

    private SanctionHistory captureSaved() {
        ArgumentCaptor<SanctionHistory> captor = ArgumentCaptor.forClass(SanctionHistory.class);
        verify(sanctionHistoryRepository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("정지는 Redis TTL로 걸고 users.status는 건드리지 않는다 — 만료를 되돌릴 주체가 필요 없어야 한다")
    void suspendWritesTtlAndLeavesUserStatusUntouched() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User target = user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, request());

        verify(accountBlockStore).suspend(TARGET_ID, "욕설 반복", Duration.ofDays(3));
        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    @DisplayName("이력에는 집행자·대상 닉네임과 기간·사유가 시점 스냅샷으로 남는다")
    void suspendRecordsHistorySnapshot() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, request());

        SanctionHistory saved = captureSaved();
        assertThat(saved.getType()).isEqualTo(SanctionType.SUSPEND);
        assertThat(saved.getUserId()).isEqualTo(TARGET_ID);
        assertThat(saved.getUserNickname()).isEqualTo("문제회원");
        assertThat(saved.getAdminUserId()).isEqualTo(ADMIN_ID);
        assertThat(saved.getAdminNickname()).isEqualTo("관리자");
        assertThat(saved.getDays()).isEqualTo(3);
        assertThat(saved.getReason()).isEqualTo("욕설 반복");
        assertThat(saved.getRefReportId()).isEqualTo(55L);
        assertThat(saved.getCreatedAt()).isNotNull();
    }

    @Test
    @DisplayName("근거 신고는 id와 유형을 함께 남긴다 — 사용자 신고와 채팅 신고는 id가 각각 1부터 증가한다")
    void suspendRecordsWhichReportTableTheIdBelongsTo() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID,
                new SuspendUserRequest(3, "채팅 욕설", 7L, SanctionRefType.CHAT_REPORT));

        SanctionHistory saved = captureSaved();
        assertThat(saved.getRefReportId()).isEqualTo(7L);
        // 유형이 없으면 chat_reports 7번인지 user_reports 7번인지 되짚을 수 없다
        assertThat(saved.getRefReportType()).isEqualTo(SanctionRefType.CHAT_REPORT);
    }

    @Test
    @DisplayName("직권 제재는 근거 신고 id·유형이 모두 비어 있다")
    void suspendByAdminDiscretionLeavesReportRefEmpty() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, new SuspendUserRequest(3, "운영 판단", null, null));

        SanctionHistory saved = captureSaved();
        assertThat(saved.getRefReportId()).isNull();
        assertThat(saved.getRefReportType()).isNull();
    }

    @Test
    @DisplayName("id와 유형은 짝이다 — 한쪽만 오면 검증에서 걸린다(되짚을 수 없는 참조 방지)")
    void reportRefMustBePaired() {
        assertThat(new SuspendUserRequest(3, "사유", 55L, SanctionRefType.USER_REPORT)
                .isReportRefPaired()).isTrue();
        assertThat(new SuspendUserRequest(3, "사유", null, null).isReportRefPaired()).isTrue();

        assertThat(new SuspendUserRequest(3, "사유", 55L, null).isReportRefPaired()).isFalse();
        assertThat(new SuspendUserRequest(3, "사유", null, SanctionRefType.CHAT_REPORT)
                .isReportRefPaired()).isFalse();
    }

    @Test
    @DisplayName("정지 시 Refresh 토큰과 접속 상태를 함께 지운다 — 안 지우면 갱신으로 세션이 되살아난다")
    void suspendRevokesSessionArtifacts() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, request());

        verify(refreshTokenStore).delete(TARGET_ID);
        verify(presenceService).clear(TARGET_ID);
    }

    @Test
    @DisplayName("방에서 뺀 뒤 웹소켓까지 끊는다 — 토큰 무효화는 '다음 요청'만 막는다")
    void suspendEvictsFromRoomThenClosesSockets() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, request());

        // 순서가 중요하다 — 소켓을 먼저 끊으면 UNSUBSCRIBE 없이 DISCONNECT만 나서
        // 유예 시간 동안 방에 유령 멤버로 남는다.
        InOrder order = inOrder(roomPresenceTracker, stompSessionRegistry);
        order.verify(roomPresenceTracker).evictFromRooms(TARGET_ID);
        order.verify(stompSessionRegistry).closeAllOf(eq(TARGET_ID), any(CloseStatus.class));
    }

    @Test
    @DisplayName("종료 프레임에 1008·ACCOUNT_SUSPENDED를 실어 보낸다 — 정상 종료면 재연결만 반복한다")
    void suspendClosesSocketsWithPolicyViolation() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.suspend(ADMIN_ID, TARGET_ID, request());

        ArgumentCaptor<CloseStatus> status = ArgumentCaptor.forClass(CloseStatus.class);
        verify(stompSessionRegistry).closeAllOf(eq(TARGET_ID), status.capture());
        assertThat(status.getValue().getCode()).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
        assertThat(status.getValue().getReason()).isEqualTo("ACCOUNT_SUSPENDED");
    }

    @Test
    @DisplayName("해제는 퇴장시키지 않는다 — 풀어 주는 처리가 사용자를 방에서 빼거나 연결을 끊으면 안 된다")
    void releaseDoesNotEvict() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(accountBlockStore.isSuspended(TARGET_ID)).willReturn(true);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.release(ADMIN_ID, TARGET_ID, new ReleaseSuspensionRequest("오판으로 확인"));

        verify(roomPresenceTracker, never()).evictFromRooms(anyLong());
        verify(stompSessionRegistry, never()).closeAllOf(anyLong(), any(CloseStatus.class));
    }

    @Test
    @DisplayName("자기 자신은 제재할 수 없다 — 조회조차 하지 않는다")
    void rejectsSelfSanction() {
        assertThatThrownBy(() -> service.suspend(ADMIN_ID, ADMIN_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_SELF_FORBIDDEN);

        verify(userRepository, never()).findById(anyLong());
        verify(accountBlockStore, never()).suspend(anyLong(), anyString(), any());
    }

    @Test
    @DisplayName("다른 관리자는 제재할 수 없다 — 계정 하나가 털리면 운영진 전체가 잠긴다")
    void rejectsSanctioningAnotherAdmin() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "다른관리자", UserRole.ADMIN);

        assertThatThrownBy(() -> service.suspend(ADMIN_ID, TARGET_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_TARGET_ADMIN);

        verify(sanctionHistoryRepository, never()).save(any());
        verify(accountBlockStore, never()).suspend(anyLong(), anyString(), any());
    }

    @Test
    @DisplayName("탈퇴 계정은 제재 대상이 아니다 — 프로필 조회가 404인 것과 같은 선")
    void rejectsDeletedTarget() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User deleted = user(TARGET_ID, "탈퇴회원", UserRole.USER);
        ReflectionTestUtils.setField(deleted, "status", UserStatus.DELETED);

        assertThatThrownBy(() -> service.suspend(ADMIN_ID, TARGET_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.USER_NOT_FOUND);

        verify(sanctionHistoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("정지 중이 아닌 계정의 해제는 409 — 아무 일도 없었던 해제를 성공으로 돌려주면 안 된다")
    void rejectsReleaseWhenNotSuspended() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "일반회원", UserRole.USER);
        given(accountBlockStore.isSuspended(TARGET_ID)).willReturn(false);

        assertThatThrownBy(() -> service.release(ADMIN_ID, TARGET_ID, new ReleaseSuspensionRequest("오판")))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_NOT_SUSPENDED);

        verify(sanctionHistoryRepository, never()).save(any());
        verify(accountBlockStore, never()).releaseSuspension(anyLong());
    }

    @Test
    @DisplayName("수동 해제도 이력에 RELEASE로 남는다 — 해제 역시 검증 대상인 결정이다")
    void releaseRecordsHistory() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(accountBlockStore.isSuspended(TARGET_ID)).willReturn(true);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.release(ADMIN_ID, TARGET_ID, new ReleaseSuspensionRequest("오판으로 확인"));

        SanctionHistory saved = captureSaved();
        assertThat(saved.getType()).isEqualTo(SanctionType.RELEASE);
        assertThat(saved.getDays()).isNull();
        assertThat(saved.getReason()).isEqualTo("오판으로 확인");
        verify(accountBlockStore).releaseSuspension(TARGET_ID);
    }

    @Test
    @DisplayName("경고는 세션을 건드리지 않는다 — 튕겨 나가면 그건 경고가 아니라 정지다")
    void warnLeavesSessionIntact() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User target = user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.warn(ADMIN_ID, TARGET_ID, new WarnUserRequest("도배", 55L, SanctionRefType.USER_REPORT));

        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
        verify(accountBlockStore, never()).suspend(anyLong(), anyString(), any());
        verify(accountBlockStore, never()).ban(anyLong(), anyString());
        verify(refreshTokenStore, never()).delete(anyLong());
        verify(presenceService, never()).clear(anyLong());
        verify(roomPresenceTracker, never()).evictFromRooms(anyLong());
        verify(stompSessionRegistry, never()).closeAllOf(anyLong(), any());
    }

    @Test
    @DisplayName("경고는 당사자에게 밀어 준다 — 읽히는 것이 곧 제재의 실행이다")
    void warnPushesNoticeToTarget() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "문제회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.warn(ADMIN_ID, TARGET_ID, new WarnUserRequest("도배", null, null));

        ArgumentCaptor<UserNotification> sent = ArgumentCaptor.forClass(UserNotification.class);
        verify(userNotifier).notify(eq(TARGET_ID), sent.capture());
        assertThat(sent.getValue().type()).isEqualTo("SANCTION_WARNING");
        // 이력 유형도 함께 고정 — days가 있으면 기간 정지로 읽힌다
        SanctionHistory saved = captureSaved();
        assertThat(saved.getType()).isEqualTo(SanctionType.WARN);
        assertThat(saved.getDays()).isNull();
        assertThat(saved.getAcknowledgedAt()).isNull();
    }

    @Test
    @DisplayName("확인 처리는 멱등 — 여러 탭에서 눌러도 처음 시각을 유지한다")
    void acknowledgeIsIdempotent() {
        SanctionHistory warning = SanctionHistory.warn(TARGET_ID, "문제회원", ADMIN_ID, "관리자", "도배", null, null);
        given(sanctionHistoryRepository.findByIdAndUserIdAndType(7L, TARGET_ID, SanctionType.WARN))
                .willReturn(Optional.of(warning));

        service.acknowledgeWarning(TARGET_ID, 7L);
        LocalDateTime first = warning.getAcknowledgedAt();
        service.acknowledgeWarning(TARGET_ID, 7L);

        assertThat(first).isNotNull();
        assertThat(warning.getAcknowledgedAt()).isEqualTo(first);
    }

    @Test
    @DisplayName("남의 경고는 확인할 수 없다 — 조회 조건에 userId가 들어가 404로 떨어진다")
    void cannotAcknowledgeSomeoneElsesWarning() {
        given(sanctionHistoryRepository.findByIdAndUserIdAndType(7L, TARGET_ID, SanctionType.WARN))
                .willReturn(Optional.empty());

        assertThatThrownBy(() -> service.acknowledgeWarning(TARGET_ID, 7L))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_WARNING_NOT_FOUND);
    }

    @Test
    @DisplayName("영구 정지는 users.status=BANNED로 남는다 — 스스로 풀리면 안 되는 상태라 TTL을 쓸 수 없다")
    void banWritesUserStatusBecauseItMustNotExpire() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User target = user(TARGET_ID, "악성회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.ban(ADMIN_ID, TARGET_ID, new BanUserRequest("반복 어그로", 55L, SanctionRefType.USER_REPORT));

        assertThat(target.getStatus()).isEqualTo(UserStatus.BANNED);
        verify(accountBlockStore).ban(TARGET_ID, "반복 어그로");
    }

    @Test
    @DisplayName("영구 정지가 기간 정지를 흡수한다 — TTL을 남기면 만료 때 '풀렸다'는 변화가 생긴다")
    void banClearsAnyExistingSuspension() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "악성회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.ban(ADMIN_ID, TARGET_ID, new BanUserRequest("반복 어그로", null, null));

        verify(accountBlockStore).releaseSuspension(TARGET_ID);
    }

    @Test
    @DisplayName("영구 정지도 세션을 전부 끊는다 — 1008에 ACCOUNT_BANNED를 실어 보낸다")
    void banRevokesLiveAccessWithItsOwnCloseReason() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "악성회원", UserRole.USER);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.ban(ADMIN_ID, TARGET_ID, new BanUserRequest("반복 어그로", null, null));

        verify(refreshTokenStore).delete(TARGET_ID);
        verify(presenceService).clear(TARGET_ID);
        verify(roomPresenceTracker).evictFromRooms(TARGET_ID);
        ArgumentCaptor<CloseStatus> status = ArgumentCaptor.forClass(CloseStatus.class);
        verify(stompSessionRegistry).closeAllOf(eq(TARGET_ID), status.capture());
        // 기간 정지와 사유가 달라야 한다 — 프론트가 "기간이 끝나면 다시 로그인"을 띄우면 거짓말이 된다
        assertThat(status.getValue().getReason()).isEqualTo("ACCOUNT_BANNED");
    }

    @Test
    @DisplayName("이미 영구 정지된 계정은 재부과하지 않는다 — 누적 횟수가 부풀려진다")
    void rejectsBanningAlreadyBannedAccount() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User target = user(TARGET_ID, "악성회원", UserRole.USER);
        ReflectionTestUtils.setField(target, "status", UserStatus.BANNED);

        assertThatThrownBy(() -> service.ban(ADMIN_ID, TARGET_ID, new BanUserRequest("또", null, null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_ALREADY_BANNED);

        verify(sanctionHistoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("영구 정지 해제는 ACTIVE로 되돌리고 이력에 UNBAN으로 남는다")
    void unbanRestoresActiveAndRecordsHistory() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        User target = user(TARGET_ID, "악성회원", UserRole.USER);
        ReflectionTestUtils.setField(target, "status", UserStatus.BANNED);
        given(sanctionHistoryRepository.save(any())).willAnswer(inv -> inv.getArgument(0));

        service.unban(ADMIN_ID, TARGET_ID, new ReleaseSuspensionRequest("오판으로 확인"));

        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(captureSaved().getType()).isEqualTo(SanctionType.UNBAN);
        verify(accountBlockStore).releaseBan(TARGET_ID);
    }

    @Test
    @DisplayName("밴이 아닌 계정의 해제는 409 — 아무 일도 없었던 해제를 성공으로 돌려주면 안 된다")
    void rejectsUnbanWhenNotBanned() {
        user(ADMIN_ID, "관리자", UserRole.ADMIN);
        user(TARGET_ID, "일반회원", UserRole.USER);

        assertThatThrownBy(() -> service.unban(ADMIN_ID, TARGET_ID, new ReleaseSuspensionRequest("해제")))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.SANCTION_NOT_BANNED);

        verify(sanctionHistoryRepository, never()).save(any());
        verify(accountBlockStore, never()).releaseBan(anyLong());
    }

    @Test
    @DisplayName("상태 조회는 기간·영구를 함께 싣는다 — 따로 물으면 그 사이에 상태가 바뀐다")
    void statusCarriesBothKindsOfBlock() {
        given(accountBlockStore.isBanned(TARGET_ID)).willReturn(true);
        given(accountBlockStore.banReason(TARGET_ID)).willReturn("반복 어그로");
        given(accountBlockStore.remaining(TARGET_ID)).willReturn(null);
        given(sanctionHistoryRepository.countByUserIdAndType(TARGET_ID, SanctionType.BAN)).willReturn(1L);

        SanctionStatusResponse status = service.status(TARGET_ID);

        assertThat(status.suspended()).isFalse();
        assertThat(status.banned()).isTrue();
        assertThat(status.banReason()).isEqualTo("반복 어그로");
        assertThat(status.banCount()).isEqualTo(1L);
    }

    @Test
    @DisplayName("빈 목록은 쿼리하지 않는다 — IN () 은 문법 오류다")
    void sanctionedReportIdsSkipsQueryWhenNothingAsked() {
        assertThat(service.sanctionedReportIds(SanctionRefType.USER_REPORT, List.of())).isEmpty();
        assertThat(service.sanctionedReportIds(SanctionRefType.USER_REPORT, null)).isEmpty();

        verify(sanctionHistoryRepository, never()).findSanctionedReportIds(any(), any());
    }

    @Test
    @DisplayName("신고 유형까지 넘긴다 — 유형을 빼면 다른 목록의 같은 번호가 제재된 것으로 뜬다")
    void sanctionedReportIdsQueriesWithinOneReportTable() {
        given(sanctionHistoryRepository.findSanctionedReportIds(SanctionRefType.CHAT_REPORT, List.of(7L, 8L)))
                .willReturn(List.of(7L));

        assertThat(service.sanctionedReportIds(SanctionRefType.CHAT_REPORT, List.of(7L, 8L)))
                .containsExactly(7L);
    }

    @Test
    @DisplayName("상태 조회는 TTL의 남은 시간을 그대로 돌려준다")
    void statusReadsRemainingTtl() {
        given(accountBlockStore.remaining(TARGET_ID)).willReturn(Duration.ofHours(30));
        given(accountBlockStore.suspendReason(TARGET_ID)).willReturn("욕설 반복");
        given(sanctionHistoryRepository.countByUserIdAndType(TARGET_ID, SanctionType.SUSPEND)).willReturn(2L);

        SanctionStatusResponse status = service.status(TARGET_ID);

        assertThat(status.suspended()).isTrue();
        assertThat(status.remainingSeconds()).isEqualTo(Duration.ofHours(30).toSeconds());
        assertThat(status.suspendReason()).isEqualTo("욕설 반복");
        assertThat(status.releaseAt()).isNotNull();
        assertThat(status.suspendCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("TTL이 만료됐으면 정지 아님 — 누적 횟수는 이력에 그대로 남는다")
    void statusAfterTtlExpiry() {
        given(accountBlockStore.remaining(TARGET_ID)).willReturn(null);
        given(sanctionHistoryRepository.countByUserIdAndType(TARGET_ID, SanctionType.SUSPEND)).willReturn(2L);

        SanctionStatusResponse status = service.status(TARGET_ID);

        assertThat(status.suspended()).isFalse();
        assertThat(status.remainingSeconds()).isNull();
        assertThat(status.releaseAt()).isNull();
        // TTL은 사라져도 "과거에 두 번 정지당했다"는 사실은 남아야 한다 — 이게 테이블을 따로 둔 이유다.
        assertThat(status.suspendCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("전체 내역 조회는 대상을 정하지 않는다 — 회원 id를 몰라도 최근 제재를 훑을 수 있어야 한다")
    void searchHistoryWithoutTarget() {
        given(sanctionHistoryRepository.search(eq(null), eq(null), any(Pageable.class)))
                .willReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));

        assertThat(service.searchHistory(null, null, 0, 20).sanctions()).isEmpty();

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.captor();
        verify(sanctionHistoryRepository).search(eq(null), eq(null), pageable.capture());
        // 최신순이어야 한다 — 운영 점검은 방금 나간 제재부터 본다.
        assertThat(pageable.getValue().getSort()).isEqualTo(Sort.by(Sort.Direction.DESC, "id"));
    }

    @Test
    @DisplayName("전체 내역에도 회원·유형 필터를 그대로 넘긴다")
    void searchHistoryPassesFilters() {
        given(sanctionHistoryRepository.search(eq(TARGET_ID), eq(SanctionType.BAN), any(Pageable.class)))
                .willReturn(new PageImpl<>(List.of(), PageRequest.of(1, 20), 0));

        service.searchHistory(TARGET_ID, SanctionType.BAN, 1, 20);

        verify(sanctionHistoryRepository).search(eq(TARGET_ID), eq(SanctionType.BAN), any(Pageable.class));
    }
}
