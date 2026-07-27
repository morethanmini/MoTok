package ssafy.a706.backend.friend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.friend.controller.dto.CreateFriendRequest;
import ssafy.a706.backend.friend.controller.dto.FriendRequestItemResponse;
import ssafy.a706.backend.friend.controller.dto.FriendResponse;
import ssafy.a706.backend.friend.controller.dto.FriendRoomResponse;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.model.RequestAction;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.model.PresenceState;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 친구 요청·목록(-57).
 *
 * <p>이 서비스가 지키는 두 가지 불변식:</p>
 * <ol>
 *   <li><b>같은 방향 중복 요청은 DB가 막는다.</b> UNIQUE(requester_id, addressee_id) 위반을 409로 바꾼다 —
 *       미리 조회해서 판단하면 동시 요청에서 둘 다 통과하는 창이 생긴다.</li>
 *   <li><b>수락하면 반대 방향 PENDING도 사라진다.</b> A→B와 B→A가 동시에 떠 있을 수 있으므로,
 *       한쪽을 ACCEPTED로 만들 때 나머지를 지우지 않으면 상대 화면에 처리 불가능한 요청이 남는다.</li>
 * </ol>
 *
 * <p>탈퇴·정지 계정은 조회 결과에서 걸러낸다(-96과 같은 정책). 관계 행은 그대로 두는데, 계정이
 * 복구되면 친구 관계도 함께 살아나는 게 자연스럽고 행을 지우면 되돌릴 수 없기 때문이다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FriendService {

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final PresenceService presenceService;

    /**
     * GET /friends — 방향과 무관하게 ACCEPTED인 상대들.
     * 닉네임(RDB)과 접속 상태(Redis)를 각각 한 번에 조회해 N+1을 피한다.
     * 접속 중인 친구를 위로 올린다 — 함께 놀 수 있는 사람을 찾는 화면이라 오프라인은 아래가 자연스럽다.
     */
    public List<FriendResponse> listFriends(Long userId) {
        List<Friendship> accepted =
                friendshipRepository.findAllByUserIdAndStatus(userId, FriendshipStatus.ACCEPTED);

        Set<Long> counterpartIds = accepted.stream()
                .map(f -> f.counterpartOf(userId))
                .collect(Collectors.toSet());

        Map<Long, User> users = visibleUsersById(counterpartIds);
        Map<Long, PresenceSnapshot> presences = presenceService.findAll(users.keySet());

        // 정렬은 매핑 전 스냅샷(enum)으로 판단한다 — 응답 문자열("OFFLINE")과 비교하면
        // PresenceState 이름이 바뀔 때 컴파일은 통과하고 정렬만 조용히 망가진다.
        return users.values().stream()
                .sorted(Comparator
                        .comparing((User u) -> presenceOf(presences, u) == PresenceState.OFFLINE)
                        .thenComparing(User::getNickname))
                .map(u -> FriendResponse.of(
                        u.getId(),
                        u.getNickname(),
                        u.getAvatarUrl(),
                        presences.getOrDefault(u.getId(), PresenceSnapshot.OFFLINE)))
                .toList();
    }

    private static PresenceState presenceOf(Map<Long, PresenceSnapshot> presences, User user) {
        return presences.getOrDefault(user.getId(), PresenceSnapshot.OFFLINE).state();
    }

    /**
     * GET /friends/requests — direction에 따라 받은 요청(내가 addressee) 또는 보낸 요청(내가 requester).
     * PENDING만 돌려준다. ACCEPTED는 이미 친구 목록에 있고, 요청 목록에 남으면 처리할 수 없는 항목이 된다.
     */
    public List<FriendRequestItemResponse> listRequests(Long userId, boolean sent) {
        List<Friendship> pending = sent
                ? friendshipRepository.findAllByRequesterIdAndStatus(userId, FriendshipStatus.PENDING)
                : friendshipRepository.findAllByAddresseeIdAndStatus(userId, FriendshipStatus.PENDING);

        Set<Long> involvedIds = pending.stream()
                .flatMap(f -> Stream.of(f.getRequesterId(), f.getAddresseeId()))
                .collect(Collectors.toSet());
        Map<Long, User> users = visibleUsersById(involvedIds);

        // 상대가 탈퇴·정지된 요청은 목록에서 감춘다 — 수락해도 친구 목록에 나타나지 않으므로 보여줄 이유가 없다.
        return pending.stream()
                .filter(f -> users.containsKey(f.getRequesterId()) && users.containsKey(f.getAddresseeId()))
                .map(f -> FriendRequestItemResponse.of(
                        f,
                        users.get(f.getRequesterId()).getNickname(),
                        users.get(f.getAddresseeId()).getNickname()))
                .sorted(Comparator.comparing(FriendRequestItemResponse::createdAt,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    /** POST /friends/requests — 닉네임으로 상대를 찾아 요청한다. */
    @Transactional
    public FriendRequestItemResponse request(Long requesterId, CreateFriendRequest req) {
        User requester = activeUser(requesterId);
        User target = userRepository.findByNickname(req.targetNickname())
                .filter(FriendService::isVisible)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if (target.getId().equals(requesterId)) {
            throw new BusinessException(ErrorCode.FRIEND_SELF_REQUEST);
        }
        if (friendshipRepository.findAllBetween(requesterId, target.getId()).stream()
                .anyMatch(f -> f.getStatus() == FriendshipStatus.ACCEPTED)) {
            throw new BusinessException(ErrorCode.FRIEND_ALREADY);
        }

        try {
            Friendship saved = friendshipRepository.saveAndFlush(
                    Friendship.request(requesterId, target.getId()));
            return FriendRequestItemResponse.of(saved, requester.getNickname(), target.getNickname());
        } catch (DataIntegrityViolationException e) {
            // UNIQUE(requester_id, addressee_id) — 같은 방향으로 이미 보낸 요청이 있다.
            throw new BusinessException(ErrorCode.FRIEND_REQUEST_DUPLICATE);
        }
    }

    /**
     * PATCH /friends/requests/{requestId} — 받은 요청 처리.
     * ACCEPT: 이 행을 ACCEPTED로 바꾸고 반대 방향 PENDING을 삭제한다.
     * REJECT: 행을 삭제한다(ERD status에 REJECTED가 없고, 지워야 나중에 다시 요청할 수 있다).
     */
    @Transactional
    public void respond(Long userId, Long requestId, RequestAction action) {
        Friendship request = pendingRequest(requestId);
        // 받은 사람만 처리할 수 있다. 보낸 사람의 철회는 cancel()이 담당한다.
        if (!request.getAddresseeId().equals(userId)) {
            throw new BusinessException(ErrorCode.FRIEND_REQUEST_FORBIDDEN);
        }

        if (action == RequestAction.REJECT) {
            friendshipRepository.delete(request);
            return;
        }

        request.accept();
        friendshipRepository.findByRequesterIdAndAddresseeId(userId, request.getRequesterId())
                .filter(Friendship::isPending)
                .ifPresent(friendshipRepository::delete);
    }

    /**
     * DELETE /friends/requests/{requestId} — 보낸 요청 철회(명세 §6 확장).
     * 수락·거절과 행위자가 반대라 엔드포인트를 나눴다.
     */
    @Transactional
    public void cancel(Long userId, Long requestId) {
        Friendship request = pendingRequest(requestId);
        if (!request.getRequesterId().equals(userId)) {
            throw new BusinessException(ErrorCode.FRIEND_REQUEST_FORBIDDEN);
        }
        friendshipRepository.delete(request);
    }

    /**
     * GET /friends/{friendId}/room — 친구가 지금 있는 방(-98).
     *
     * <p>친구 목록에도 currentRoomId가 실려 오지만 그 목록은 폴링이라 최대 20초 낡을 수 있다.
     * 입장을 누르는 순간 다시 확인해야 "방금 나간 방"에 들어가려는 시도를 막을 수 있다.</p>
     *
     * <p>실제 입장은 이 응답의 roomId로 기존 {@code POST /v1/live-rooms/{roomId}/join}을 호출한다 —
     * 비밀방 비밀번호·정원 초과·게임 진행 중 판정이 모두 거기 이미 있어서 새로 만들 필요가 없다.
     * 초대받아 들어가는 경로(-100)와 달리 <b>친구를 따라가는 건 상대 동의가 없으므로 비밀번호를 요구한다.</b></p>
     */
    public FriendRoomResponse findFriendRoom(Long userId, Long friendId) {
        boolean areFriends = friendshipRepository.findAllBetween(userId, friendId).stream()
                .anyMatch(f -> f.getStatus() == FriendshipStatus.ACCEPTED);
        if (!areFriends) {
            throw new BusinessException(ErrorCode.FRIEND_NOT_FOUND);
        }
        // 방에 없으면 roomId가 null인 200 — 친구는 존재하므로 404가 아니다.
        return new FriendRoomResponse(presenceService.find(friendId).roomId());
    }

    /** DELETE /friends/{friendId} — 친구 관계 해제. 방향 무관하게 ACCEPTED 행을 지운다. */
    @Transactional
    public void remove(Long userId, Long friendId) {
        Friendship accepted = friendshipRepository.findAllBetween(userId, friendId).stream()
                .filter(f -> f.getStatus() == FriendshipStatus.ACCEPTED)
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.FRIEND_NOT_FOUND));
        friendshipRepository.delete(accepted);
    }

    private Friendship pendingRequest(Long requestId) {
        Friendship request = friendshipRepository.findById(requestId)
                .orElseThrow(() -> new BusinessException(ErrorCode.FRIEND_REQUEST_NOT_FOUND));
        // 이미 수락된 관계는 '요청'이 아니다 — 여기로 오면 요청 목록이 낡은 것이므로 404로 되돌린다.
        if (!request.isPending()) {
            throw new BusinessException(ErrorCode.FRIEND_REQUEST_NOT_FOUND);
        }
        return request;
    }

    private User activeUser(Long userId) {
        return userRepository.findById(userId)
                .filter(FriendService::isVisible)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
    }

    /** 탈퇴·정지 계정을 뺀 사용자 맵. UserRepository에 손대지 않고 여기서 걸러 낸다. */
    private Map<Long, User> visibleUsersById(Set<Long> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return userRepository.findAllById(ids).stream()
                .filter(FriendService::isVisible)
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private static boolean isVisible(User user) {
        return user.getDeletedAt() == null && user.getStatus() == UserStatus.ACTIVE;
    }
}
