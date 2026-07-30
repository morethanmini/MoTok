package ssafy.a706.backend.user.sanction;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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
import ssafy.a706.backend.user.sanction.dto.SanctionHistoryListResponse;
import ssafy.a706.backend.user.sanction.dto.SuspendUserRequest;
import ssafy.a706.backend.user.sanction.dto.WarnUserRequest;
import ssafy.a706.backend.user.sanction.dto.WarningNoticeResponse;
import ssafy.a706.backend.user.sanction.dto.SanctionStatusResponse;

import java.time.Duration;
import java.util.List;
import java.util.Set;

/**
 * 관리자 계정 제재 — 기간 정지 부과·해제와 그 이력.
 *
 * <p>상태와 이력을 다른 저장소가 나눠 갖는다:</p>
 * <ul>
 *   <li><b>Redis TTL</b>({@link AccountBlockStore}) — "지금 정지 중인가, 얼마 남았나".
 *       만료가 곧 해제라 되돌릴 배치가 필요 없다.</li>
 *   <li><b>RDB</b>({@link SanctionHistory}) — "누가 누구를 언제 왜 몇 일". TTL이 사라져도 남는다.</li>
 * </ul>
 *
 * <p>제재는 되돌리기 어려운 관리 행위라 대상 검증을 좁게 잡는다 — 자기 자신, 다른 관리자,
 * 이미 탈퇴한 계정은 제재하지 않는다. 특히 관리자 상호 제재를 열어 두면 계정 하나가 털렸을 때
 * 운영진 전체가 잠길 수 있다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserSanctionService {

    /**
     * 제재로 끊을 때 클라이언트에 실어 보내는 종료 코드 — 1008(정책 위반)에 사유를 붙인다.
     * 두 사유를 나누는 이유는 프론트 안내가 달라야 하기 때문이다("기간이 끝나면 다시 로그인"은 밴에 거짓말).
     */
    private static final CloseStatus SUSPENDED_CLOSE =
            CloseStatus.POLICY_VIOLATION.withReason("ACCOUNT_SUSPENDED");
    private static final CloseStatus BANNED_CLOSE =
            CloseStatus.POLICY_VIOLATION.withReason("ACCOUNT_BANNED");

    private final SanctionHistoryRepository sanctionHistoryRepository;
    private final UserRepository userRepository;
    private final AccountBlockStore accountBlockStore;
    private final RefreshTokenStore refreshTokenStore;
    private final PresenceService presenceService;
    private final RoomPresenceTracker roomPresenceTracker;
    private final StompSessionRegistry stompSessionRegistry;
    private final UserNotifier userNotifier;

    /**
     * 경고 부과 — 접근을 막지 않는 유일한 제재다.
     *
     * <p>그래서 <b>당사자에게 전달되는 것이 곧 제재의 실행</b>이다. 정지·밴은 읽든 말든 접근이
     * 막히지만, 경고는 읽히지 않으면 아무 일도 일어나지 않은 것과 같다. 접속 중이면 개인 큐로
     * 즉시 밀고, 아니면 다음 접속 때 미확인 경고 조회가 메운다 — 푸시가 저장을 대체하지 않는다
     * ({@code UserNotifier} 주석과 같은 계약).</p>
     *
     * <p>세션을 건드리지 않는다 — 토큰·프레즌스·방·소켓 어느 것도 끊지 않는다. 경고를 받았다고
     * 게임에서 튕겨 나가면 그건 경고가 아니라 정지다.</p>
     */
    @Transactional
    public SanctionStatusResponse warn(Long adminId, Long targetId, WarnUserRequest request) {
        if (targetId.equals(adminId)) {
            throw new BusinessException(ErrorCode.SANCTION_SELF_FORBIDDEN);
        }
        User admin = admin(adminId);
        User target = sanctionTarget(targetId);
        String reason = request.reason().trim();

        SanctionHistory saved = sanctionHistoryRepository.save(SanctionHistory.warn(
                target.getId(), target.getNickname(), admin.getId(), admin.getNickname(),
                reason, request.reportId(), request.reportType()));

        userNotifier.notify(target.getId(),
                UserNotification.sanctionWarning(WarningNoticeResponse.from(saved)));

        return status(target.getId());
    }

    /**
     * 아직 확인하지 않은 내 경고. 로그인·재연결마다 부르는 스냅샷 경로다.
     * 확인된 것은 돌려주지 않는다 — 같은 경고를 매번 다시 띄우면 안내가 아니라 방해가 된다.
     */
    public List<WarningNoticeResponse> unacknowledgedWarnings(Long userId) {
        return sanctionHistoryRepository
                .findByUserIdAndTypeAndAcknowledgedAtIsNullOrderByIdAsc(userId, SanctionType.WARN)
                .stream()
                .map(WarningNoticeResponse::from)
                .toList();
    }

    /**
     * 경고 확인 처리. 남의 경고를 확인할 수 없도록 조회 조건에 userId를 넣는다 —
     * id만으로 찾으면 임의의 id를 보내 다른 사람의 경고를 읽음으로 만들 수 있다.
     */
    @Transactional
    public void acknowledgeWarning(Long userId, Long warningId) {
        sanctionHistoryRepository.findByIdAndUserIdAndType(warningId, userId, SanctionType.WARN)
                .orElseThrow(() -> new BusinessException(ErrorCode.SANCTION_WARNING_NOT_FOUND))
                .acknowledge();
    }

    /** 정지 부과. 이미 정지 중이면 새 기간으로 덮어쓰고, 그 사실도 이력에 한 줄로 남는다. */
    @Transactional
    public SanctionStatusResponse suspend(Long adminId, Long targetId, SuspendUserRequest request) {
        // 자기 제재는 조회 전에 끊는다 — 대상을 읽어 볼 것도 없이 성립하지 않는 요청이다.
        if (targetId.equals(adminId)) {
            throw new BusinessException(ErrorCode.SANCTION_SELF_FORBIDDEN);
        }
        User admin = admin(adminId);
        User target = sanctionTarget(targetId);
        String reason = request.reason().trim();

        sanctionHistoryRepository.save(SanctionHistory.suspend(
                target.getId(), target.getNickname(), admin.getId(), admin.getNickname(),
                request.days(), reason, request.reportId(), request.reportType()));

        // Redis 쓰기를 이력 저장 뒤에 두는 이유 — 순서를 뒤집으면 이력 저장이 실패했을 때
        // '기록 없는 정지'가 남는다. 이 순서면 Redis가 실패해도 트랜잭션이 롤백돼 둘 다 없던 일이 된다.
        accountBlockStore.suspend(target.getId(), reason, Duration.ofDays(request.days()));

        revokeLiveAccess(target.getId(), SUSPENDED_CLOSE);
        return status(target.getId());
    }

    /**
     * 이미 열려 있는 접근을 전부 끊는다 — 기간 정지와 영구 정지가 공유하는 처리다.
     *
     * <p>제재를 걸었다는 사실만으로는 <b>지금 접속 중인 사용자에게 아무 일도 일어나지 않는다.</b>
     * Access 토큰은 서명만으로 유효하고(기본 1시간), Refresh가 남아 있으면 갱신으로 세션이 되살아나며,
     * WebSocket은 CONNECT 때 한 번만 인증한다. 네 가지를 함께 해야 실제로 끊긴다.</p>
     *
     * <p>순서가 있다 — 방을 먼저 비우고 소켓을 끊는다. 반대로 하면 UNSUBSCRIBE 없이 DISCONNECT만
     * 나서 유예 시간 동안 방에 유령 멤버로 남는다(RoomPresenceTracker 주석 참고).</p>
     */
    private void revokeLiveAccess(Long userId, CloseStatus closeStatus) {
        // 이미 발급된 Refresh를 지우지 않으면 제재 중에도 토큰 갱신으로 세션이 되살아난다(로그아웃과 같은 처리).
        refreshTokenStore.delete(userId);
        // 접속 상태도 지운다 — 안 그러면 제재된 사용자가 TTL(60s) 동안 친구 목록에 온라인으로 남는다.
        presenceService.clear(userId);
        roomPresenceTracker.evictFromRooms(userId);
        stompSessionRegistry.closeAllOf(userId, closeStatus);
    }

    /**
     * 기간 만료 전 수동 해제(오판 정정 등).
     * 정지 중이 아니면 409다 — 아무 일도 일어나지 않은 해제를 성공으로 돌려주면
     * 관리자는 자기가 방금 무엇을 했는지 알 수 없다.
     */
    @Transactional
    public void release(Long adminId, Long targetId, ReleaseSuspensionRequest request) {
        User admin = admin(adminId);
        User target = userRepository.findById(targetId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if (!accountBlockStore.isSuspended(targetId)) {
            throw new BusinessException(ErrorCode.SANCTION_NOT_SUSPENDED);
        }

        // 부과와 같은 이유로 이력이 먼저다 — Redis를 먼저 지우면 이력 저장 실패 시 '기록 없는 해제'가 된다.
        sanctionHistoryRepository.save(SanctionHistory.release(
                target.getId(), target.getNickname(), admin.getId(), admin.getNickname(),
                request.reason().trim()));

        accountBlockStore.releaseSuspension(targetId);
    }

    /**
     * 영구 정지 부과.
     *
     * <p>기간 정지와 다른 점은 <b>상태 원천이 RDB</b>라는 것이다 — 스스로 풀려서는 안 되므로 TTL을
     * 쓸 수 없고, {@code users.status=BANNED}가 진실이며 Redis 키는 요청마다 도는 인증 경로용 캐시다.</p>
     *
     * <p>기간 정지 중이었다면 그 키를 지운다 — 영구가 기간을 흡수한다. 남겨 두면 TTL이 만료될 때
     * "정지가 풀렸다"는 상태 변화가 생기는데 실제로는 여전히 밴이라, 두 원천이 서로 다른 말을 한다.</p>
     */
    @Transactional
    public SanctionStatusResponse ban(Long adminId, Long targetId, BanUserRequest request) {
        if (targetId.equals(adminId)) {
            throw new BusinessException(ErrorCode.SANCTION_SELF_FORBIDDEN);
        }
        User admin = admin(adminId);
        User target = sanctionTarget(targetId);
        if (target.getStatus() == UserStatus.BANNED) {
            // 재부과를 허용하면 이력에 같은 제재가 쌓이고 누적 횟수가 부풀려진다(기간 정지의 '갱신'과 다르다).
            throw new BusinessException(ErrorCode.SANCTION_ALREADY_BANNED);
        }
        String reason = request.reason().trim();

        sanctionHistoryRepository.save(SanctionHistory.ban(
                target.getId(), target.getNickname(), admin.getId(), admin.getNickname(),
                reason, request.reportId(), request.reportType()));
        target.ban();

        // 기간 정지 부과와 같은 이유로 Redis 쓰기는 이력·상태 뒤에 둔다(실패 시 트랜잭션이 되돌린다).
        accountBlockStore.ban(target.getId(), reason);
        accountBlockStore.releaseSuspension(target.getId());

        revokeLiveAccess(target.getId(), BANNED_CLOSE);
        return status(target.getId());
    }

    /**
     * 영구 정지 해제(오판 정정). 밴이 아니면 409 — 기간 정지 해제와 같은 이유로,
     * 아무 일도 없었던 해제를 성공으로 돌려주면 관리자는 자기가 무엇을 했는지 알 수 없다.
     */
    @Transactional
    public void unban(Long adminId, Long targetId, ReleaseSuspensionRequest request) {
        User admin = admin(adminId);
        User target = userRepository.findById(targetId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if (target.getStatus() != UserStatus.BANNED) {
            throw new BusinessException(ErrorCode.SANCTION_NOT_BANNED);
        }

        sanctionHistoryRepository.save(SanctionHistory.unban(
                target.getId(), target.getNickname(), admin.getId(), admin.getNickname(),
                request.reason().trim()));
        target.unban();
        accountBlockStore.releaseBan(targetId);
    }

    /** 현재 제재 상태 + 누적 횟수. 남은 기간은 Redis TTL을 그대로 읽은 값이다. */
    public SanctionStatusResponse status(Long targetId) {
        long suspendCount = sanctionHistoryRepository.countByUserIdAndType(targetId, SanctionType.SUSPEND);
        long banCount = sanctionHistoryRepository.countByUserIdAndType(targetId, SanctionType.BAN);
        long warnCount = sanctionHistoryRepository.countByUserIdAndType(targetId, SanctionType.WARN);
        boolean banned = accountBlockStore.isBanned(targetId);
        String banReason = banned ? accountBlockStore.banReason(targetId) : null;

        Duration remaining = accountBlockStore.remaining(targetId);
        String reason = remaining == null ? null : accountBlockStore.suspendReason(targetId);
        // reason이 null이면 TTL을 읽은 직후 키가 만료된 것 — 정지 아님으로 접는다.
        if (remaining == null || reason == null) {
            return SanctionStatusResponse.of(banned, banReason, suspendCount, banCount, warnCount);
        }
        return SanctionStatusResponse.suspended(reason, remaining.toSeconds(),
                banned, banReason, suspendCount, banCount, warnCount);
    }

    /**
     * 주어진 신고들 중 제재로 이어진 것.
     *
     * <p>신고 목록에 "제재됨" 배지를 붙이기 위한 조회다. 신고 응답에 필드를 더하지 않고 별도
     * 엔드포인트로 두는 이유 — "이 신고가 제재로 이어졌나"는 제재 도메인이 아는 사실이고,
     * 신고(-112·-133)는 제재의 존재를 몰라도 성립한다. 두 신고 리소스의 DTO를 건드리지 않는다.</p>
     *
     * @return 제재된 신고 id 집합. 입력이 비면 빈 집합(IN () 은 문법 오류라 쿼리 자체를 걸지 않는다)
     */
    public Set<Long> sanctionedReportIds(SanctionRefType type, List<Long> reportIds) {
        if (reportIds == null || reportIds.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(sanctionHistoryRepository.findSanctionedReportIds(type, reportIds));
    }

    /** 제재 이력(최신순). 대상 계정이 탈퇴했어도 이력은 그대로 조회된다. */
    public SanctionHistoryListResponse history(Long targetId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        return SanctionHistoryListResponse.from(sanctionHistoryRepository.findByUserId(targetId, pageable));
    }

    /** 집행자 — 토큰의 role은 ADMIN이지만 그 사이 계정이 사라졌을 수 있어 실제 행을 확인한다. */
    private User admin(Long adminId) {
        return userRepository.findById(adminId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    private User sanctionTarget(Long targetId) {
        User target = userRepository.findById(targetId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        if (target.getRole() == UserRole.ADMIN) {
            throw new BusinessException(ErrorCode.SANCTION_TARGET_ADMIN);
        }
        // 탈퇴 계정은 프로필 조회부터 404라(-96) 제재 대상으로도 잡히지 않는 게 일관적이다.
        if (target.getStatus() == UserStatus.DELETED) {
            throw new BusinessException(ErrorCode.USER_NOT_FOUND);
        }
        return target;
    }
}
