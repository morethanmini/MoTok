package ssafy.a706.backend.liveroom.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomRequest;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 한 계정은 한 방에만 — 방을 옮기면 있던 방에서 자동으로 나온다.
 *
 * <p>깨지면 나는 사고 — 멤버십은 방마다 관리돼서 같은 방 중복 입장만 막히고, 서로 다른 방
 * 여러 개를 동시에 점유하는 것은 아무도 막지 않았다. 계정 하나로 공개방을 쓸어 담으면
 * 빠른시작·매칭이 실제 사용자에게 돌아가지 않고, 방마다 SFU 퍼블리셔가 붙어 비용이 방 수에
 * 비례해 늘어난다.</p>
 *
 * <p>반대 방향도 같이 고정한다 — <b>입장이 거절됐는데 있던 방에서 쫓겨나면</b> 그게 더 큰 사고다.
 * 정원이 찬 방을 눌러 본 것만으로 게임 중이던 방에서 빠지게 된다.</p>
 */
class LiveRoomSingleRoomTest {

    private static final long USER_ID = 7L;
    private static final String PLAYER_KEY = "u:7";
    private static final String CURRENT_ROOM = "AAAAAA";
    private static final String TARGET_ROOM = "BBBBBB";

    private final LiveRoomRepository repository = mock(LiveRoomRepository.class);

    private final LiveRoomService service = new LiveRoomService(
            repository, mock(SimpMessagingTemplate.class), mock(LobbyBroadcaster.class),
            mock(ApplicationEventPublisher.class), mock(TaskScheduler.class));

    private final MemberPrincipal principal = new MemberPrincipal(USER_ID, "모톡러");

    /** 방 해시 한 벌. 정원·상태만 바꿔 가며 쓴다. */
    private void roomExists(String roomId, String status, int maxPlayers, List<LiveRoomMemberValue> members) {
        given(repository.findRoomFields(roomId)).willReturn(Optional.of(Map.of(
                "title", "방", "visibility", "PUBLIC", "maxPlayers", String.valueOf(maxPlayers),
                "status", status, "hostUserId", "99", "hostDisplayName", "방장",
                "createdAt", "1", "inviteCode", "INVITE")));
        given(repository.findMembers(roomId)).willReturn(members);
    }

    private LiveRoomMemberValue other(String userId) {
        return new LiveRoomMemberValue(userId, "남", false, 1L);
    }

    /** 이 사람이 지금 CURRENT_ROOM에 있다고 색인이 말한다. */
    private void currentlyIn(String roomId) {
        given(repository.findRoomIdOfPlayer(PLAYER_KEY)).willReturn(Optional.of(roomId));
        roomExists(roomId, "WAITING", 4, List.of(
                new LiveRoomMemberValue(String.valueOf(USER_ID), "모톡러", false, 1L), other("99")));
        given(repository.hasMember(roomId, PLAYER_KEY)).willReturn(true);
    }

    @Test
    @DisplayName("다른 방에 있었으면 새 방에 넣기 전에 그 방에서 먼저 뺀다")
    void leavesTheCurrentRoomBeforeJoiningAnother() {
        currentlyIn(CURRENT_ROOM);
        roomExists(TARGET_ROOM, "WAITING", 4, List.of(other("99")));
        given(repository.hasMember(TARGET_ROOM, PLAYER_KEY)).willReturn(false);

        service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null));

        // 순서가 곧 동작이다 — 넣고 나서 빼면 방금 쓴 색인이 옛 방 정리에 지워진다.
        InOrder order = inOrder(repository);
        order.verify(repository).removeMember(CURRENT_ROOM, PLAYER_KEY);
        order.verify(repository).addMember(eq(TARGET_ROOM), eq(PLAYER_KEY), anyString(), anyString(),
                anyBoolean(), anyLong());
    }

    @Test
    @DisplayName("지금 들어가려는 그 방이면 나오지 않는다 — 새로고침 복귀가 자기를 쫓아내면 안 된다")
    void doesNotLeaveWhenRejoiningTheSameRoom() {
        currentlyIn(TARGET_ROOM); // 이미 그 방에 있다

        service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null));

        verify(repository, never()).removeMember(anyString(), anyString());
    }

    @Test
    @DisplayName("정원이 차 입장이 거절되면 있던 방을 뺏지 않는다")
    void keepsTheCurrentRoomWhenTheJoinIsRejected() {
        currentlyIn(CURRENT_ROOM);
        // 정원 2에 이미 2명 — ROOM_FULL로 거절된다.
        roomExists(TARGET_ROOM, "WAITING", 2, List.of(other("98"), other("99")));
        given(repository.hasMember(TARGET_ROOM, PLAYER_KEY)).willReturn(false);

        assertThatThrownBy(() -> service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_FULL);

        verify(repository, never()).removeMember(anyString(), anyString());
    }

    @Test
    @DisplayName("게임이 진행 중이라 거절돼도 있던 방을 뺏지 않는다")
    void keepsTheCurrentRoomWhenTheTargetIsPlaying() {
        currentlyIn(CURRENT_ROOM);
        roomExists(TARGET_ROOM, "PLAYING", 4, List.of(other("99")));
        given(repository.hasMember(TARGET_ROOM, PLAYER_KEY)).willReturn(false);

        assertThatThrownBy(() -> service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_GAME_IN_PROGRESS);

        verify(repository, never()).removeMember(anyString(), anyString());
    }

    @Test
    @DisplayName("색인이 이미 사라진 방을 가리켜도 입장은 그대로 된다 — 옛 흔적이 입장을 막으면 안 된다")
    void joinsAnywayWhenThePreviousRoomIsAlreadyGone() {
        // 색인만 남고 방은 TTL로 사라진 상태 — findRoomFields가 비어 ROOM_NOT_FOUND가 난다.
        given(repository.findRoomIdOfPlayer(PLAYER_KEY)).willReturn(Optional.of("GONE00"));
        given(repository.findRoomFields("GONE00")).willReturn(Optional.empty());
        roomExists(TARGET_ROOM, "WAITING", 4, List.of(other("99")));
        given(repository.hasMember(TARGET_ROOM, PLAYER_KEY)).willReturn(false);

        service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null));

        verify(repository).addMember(eq(TARGET_ROOM), eq(PLAYER_KEY), anyString(), anyString(),
                anyBoolean(), anyLong());
    }

    @Test
    @DisplayName("아무 방에도 없었으면 아무도 내보내지 않는다")
    void leavesNobodyWhenNotInAnyRoom() {
        given(repository.findRoomIdOfPlayer(PLAYER_KEY)).willReturn(Optional.empty());
        roomExists(TARGET_ROOM, "WAITING", 4, List.of(other("99")));
        given(repository.hasMember(TARGET_ROOM, PLAYER_KEY)).willReturn(false);

        service.join(principal, TARGET_ROOM, new JoinLiveRoomRequest(null));

        verify(repository, never()).removeMember(anyString(), anyString());
    }
}
