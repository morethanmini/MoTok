package ssafy.a706.backend.friend;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.conntime.service.ConnectTimeService;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.friend.service.FriendService;
import ssafy.a706.backend.global.notification.UserNotifier;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 친구 목록의 마지막 접속 시각 (-179).
 *
 * <p>고정하는 건 <b>오프라인인 친구에게만 조회한다</b>는 것이다. 값 자체는
 * {@code user_connect_times.updated_at}인데, 그 행은 오프라인 정산 시점에만 갱신되므로
 * 온라인 친구의 값은 <b>직전</b> 접속의 종료 시각이다 — 지금과 무관한 숫자라 내려보내면 안 된다.</p>
 *
 * <p>그리고 전원이 접속 중이면 조회 자체를 하지 않는다. 친구 목록은 로비 진입과 프레즌스 변동마다
 * 다시 그려지는 화면이라, 쓰지도 않을 SELECT를 매번 붙이면 그게 그대로 부하가 된다.</p>
 */
class FriendLastSeenTest {

    private static final long ME = 1L;
    private static final long OFFLINE_FRIEND = 2L;
    private static final long ONLINE_FRIEND = 3L;
    private static final LocalDateTime LAST_SEEN = LocalDateTime.of(2026, 8, 3, 9, 30);

    private final FriendshipRepository friendshipRepository = mock(FriendshipRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final PresenceService presenceService = mock(PresenceService.class);
    private final ConnectTimeService connectTimeService = mock(ConnectTimeService.class);
    private final UserNotifier userNotifier = mock(UserNotifier.class);
    private final FriendService service = new FriendService(
            friendshipRepository, userRepository, presenceService, connectTimeService, userNotifier);

    private static User user(long id, String nickname) {
        User u = User.builder().email(nickname + "@t.dev").nickname(nickname).build();
        ReflectionTestUtils.setField(u, "id", id);
        return u;
    }

    private static Friendship accepted(long id, long requesterId, long addresseeId) {
        Friendship f = Friendship.request(requesterId, addresseeId);
        f.accept();
        ReflectionTestUtils.setField(f, "id", id);
        return f;
    }

    /** 친구 두 명(오프라인 1 · 온라인 1)이 있는 목록을 세운다. */
    private void givenOneOfflineOneOnline() {
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(10L, ME, OFFLINE_FRIEND), accepted(11L, ME, ONLINE_FRIEND)));
        given(userRepository.findAllById(anyIterable()))
                .willReturn(List.of(user(OFFLINE_FRIEND, "떠난친구"), user(ONLINE_FRIEND, "접속친구")));
        given(presenceService.findAll(anyCollection()))
                .willReturn(Map.of(ONLINE_FRIEND, PresenceSnapshot.online(null)));
    }

    @Test
    @DisplayName("오프라인 친구에게만 마지막 접속 시각이 붙는다 — 온라인 친구 값은 지금과 무관하다")
    void onlyOfflineFriendCarriesLastSeen() {
        givenOneOfflineOneOnline();
        given(connectTimeService.lastSeenOf(Set.of(OFFLINE_FRIEND)))
                .willReturn(Map.of(OFFLINE_FRIEND, LAST_SEEN));

        assertThat(service.listFriends(ME))
                .filteredOn(f -> f.userId().equals(OFFLINE_FRIEND))
                .singleElement()
                .satisfies(f -> assertThat(f.lastSeenAt()).isEqualTo(LAST_SEEN));

        assertThat(service.listFriends(ME))
                .filteredOn(f -> f.userId().equals(ONLINE_FRIEND))
                .singleElement()
                .satisfies(f -> assertThat(f.lastSeenAt()).isNull());
    }

    @Test
    @DisplayName("오프라인 친구만 조회한다 — 온라인 친구 id는 조회에 섞이지 않는다")
    void queriesOfflineIdsOnly() {
        givenOneOfflineOneOnline();
        given(connectTimeService.lastSeenOf(anyCollection())).willReturn(Map.of());

        service.listFriends(ME);

        verify(connectTimeService).lastSeenOf(Set.of(OFFLINE_FRIEND));
    }

    @Test
    @DisplayName("기록이 없는 친구는 null — 배포 이후 한 번도 정산되지 않은 계정")
    void unknownLastSeenIsNull() {
        givenOneOfflineOneOnline();
        given(connectTimeService.lastSeenOf(anyCollection())).willReturn(Map.of());

        assertThat(service.listFriends(ME))
                .filteredOn(f -> f.userId().equals(OFFLINE_FRIEND))
                .singleElement()
                .satisfies(f -> assertThat(f.lastSeenAt()).isNull());
    }

    @Test
    @DisplayName("친구가 전원 접속 중이면 빈 집합으로 넘긴다 — SELECT를 막는 건 ConnectTimeService 쪽 가드다")
    void passesEmptySetWhenNobodyIsOffline() {
        given(friendshipRepository.findAllByUserIdAndStatus(ME, FriendshipStatus.ACCEPTED))
                .willReturn(List.of(accepted(11L, ME, ONLINE_FRIEND)));
        given(userRepository.findAllById(anyIterable())).willReturn(List.of(user(ONLINE_FRIEND, "접속친구")));
        given(presenceService.findAll(anyCollection()))
                .willReturn(Map.of(ONLINE_FRIEND, PresenceSnapshot.online(null)));
        given(connectTimeService.lastSeenOf(anyCollection())).willReturn(Map.of());

        service.listFriends(ME);

        verify(connectTimeService).lastSeenOf(Set.of());
    }
}
