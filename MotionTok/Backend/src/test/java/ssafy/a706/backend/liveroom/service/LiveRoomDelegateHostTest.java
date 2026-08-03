package ssafy.a706.backend.liveroom.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomHostChangedEvent;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 방장 수동 위임(S15P11A706-180).
 *
 * <p>고정하려는 것은 <b>권한 검증</b>이다 — 이 엔드포인트는 부르는 것만으로 방의 통제권이
 * 통째로 넘어간다. 방장 확인이 빠지면 아무나 방을 접수할 수 있고, WAITING 확인이 빠지면
 * 진행 중인 라운드의 시작·정산·중단 발신 주체가 판 도중에 갈린다.
 */
class LiveRoomDelegateHostTest {

    private static final long HOST_ID = 7L;
    private static final String ROOM = "AAAAAA";

    private final LiveRoomRepository repository = mock(LiveRoomRepository.class);
    private final SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);

    private final LiveRoomService service = new LiveRoomService(
            repository, messagingTemplate, mock(LobbyBroadcaster.class),
            mock(ApplicationEventPublisher.class), mock(TaskScheduler.class));

    private final MemberPrincipal host = new MemberPrincipal(HOST_ID, "방장");

    private void roomExists(String hostUserId, String status, List<LiveRoomMemberValue> members) {
        given(repository.findRoomFields(ROOM)).willReturn(Optional.of(Map.of(
                "title", "방", "visibility", "PUBLIC", "maxPlayers", "4",
                "status", status, "hostUserId", hostUserId, "hostDisplayName", "방장",
                "createdAt", "1", "inviteCode", "INVITE")));
        given(repository.findMembers(ROOM)).willReturn(members);
    }

    private LiveRoomMemberValue member(String userId, String name) {
        return new LiveRoomMemberValue(userId, name, false, 1L);
    }

    @Test
    @DisplayName("방장이 참가자를 지목하면 방장이 넘어가고 DELEGATED 사유로 방송된다")
    void delegatesToTheChosenMember() {
        roomExists("7", "WAITING", List.of(member("7", "방장"), member("9", "새방장")));

        service.delegateHost(host, ROOM, "9");

        verify(repository).updateHost(ROOM, "9", "새방장");
        var event = forClass(LiveRoomHostChangedEvent.class);
        verify(messagingTemplate).convertAndSend(anyString(), event.capture());
        assertThat(event.getValue().hostUserId()).isEqualTo("9");
        assertThat(event.getValue().hostReason())
                .isEqualTo(LiveRoomHostChangedEvent.HostChangeReason.DELEGATED);
    }

    @Test
    @DisplayName("방장이 아니면 거절한다 — 아무나 방을 접수할 수 있으면 안 된다")
    void rejectsNonHost() {
        roomExists("99", "WAITING", List.of(member("99", "진짜방장"), member("7", "방장")));

        assertThatThrownBy(() -> service.delegateHost(host, ROOM, "99"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.NOT_ROOM_HOST);

        verify(repository, never()).updateHost(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("게임 중에는 거절한다 — 진행 중인 판의 주인이 도중에 바뀌면 안 된다")
    void rejectsWhilePlaying() {
        roomExists("7", "PLAYING", List.of(member("7", "방장"), member("9", "새방장")));

        assertThatThrownBy(() -> service.delegateHost(host, ROOM, "9"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_GAME_IN_PROGRESS);

        verify(repository, never()).updateHost(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("자기 자신에게는 위임할 수 없다")
    void rejectsSelf() {
        roomExists("7", "WAITING", List.of(member("7", "방장"), member("9", "새방장")));

        assertThatThrownBy(() -> service.delegateHost(host, ROOM, "7"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_CANNOT_DELEGATE_SELF);
    }

    @Test
    @DisplayName("방에 없는 사람에게는 위임할 수 없다 — 아무도 방장이 아닌 방이 된다")
    void rejectsNonMember() {
        roomExists("7", "WAITING", List.of(member("7", "방장")));

        assertThatThrownBy(() -> service.delegateHost(host, ROOM, "9"))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.ROOM_MEMBER_NOT_FOUND);

        verify(repository, never()).updateHost(anyString(), anyString(), anyString());
    }
}
