package ssafy.a706.backend.liveroom.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 게스트 1인방(-109)은 비워져도 살아남는다.
 *
 * <p>깨지면 나는 사고 — 게스트 방은 게스트 로그인 때 딱 한 번 만들어지고 다시 받을 길이 없다.
 * 마지막(=유일한) 사람이 나갔다고 지워 버리면 그 게스트는 남은 세션 동안 어떤 게임도 시작할 수
 * 없다: 한 판 하고 나온 뒤 다른 게임을 고르면 두 번째 입장이 ROOM_NOT_FOUND로 막힌다.</p>
 *
 * <p>반대쪽도 같이 고정한다 — <b>회원 방은 그대로 지워져야 한다</b>. 안 지우면 아무도 없는 방이
 * 로비에 남아 계속 눌러 보게 된다.</p>
 */
class LiveRoomGuestSoloRoomTest {

    private static final String GUEST_ROOM = "GUEST1";
    private static final String MEMBER_ROOM = "MEMBR1";
    private static final String GUEST_KEY = "g:guest-abc";
    private static final String MEMBER_KEY = "u:7";

    private final LiveRoomRepository repository = mock(LiveRoomRepository.class);

    private final LiveRoomService service = new LiveRoomService(
            repository, mock(SimpMessagingTemplate.class), mock(LobbyBroadcaster.class),
            mock(ApplicationEventPublisher.class), mock(TaskScheduler.class));

    private final GuestPrincipal guest = new GuestPrincipal("guest-abc", "게스트1234");
    private final MemberPrincipal member = new MemberPrincipal(7L, "모톡러");

    /**
     * 마지막 한 사람이 나가기 직전의 방. inviteCode가 곧 게스트 1인방 판별 기준이다 —
     * 게스트 방은 초대코드 없이 만들어진다(LiveRoomService#createGuestSoloRoom).
     */
    private void lastMemberIn(String roomId, String playerKey, String status, String inviteCode) {
        Map<Object, Object> fields = new java.util.LinkedHashMap<>(Map.of(
                "title", "방", "visibility", "PRIVATE", "maxPlayers", "1",
                "status", status, "hostUserId", "누군가", "hostDisplayName", "방장",
                "createdAt", "1"));
        if (inviteCode != null) {
            fields.put("inviteCode", inviteCode);
        }
        given(repository.findRoomFields(roomId)).willReturn(Optional.of(fields));
        given(repository.hasMember(roomId, playerKey)).willReturn(true);
        // removeMember 뒤에 다시 읽으므로 "이미 빈 방"으로 답한다.
        given(repository.findMembers(roomId)).willReturn(List.<LiveRoomMemberValue>of());
    }

    @Test
    @DisplayName("게스트가 1인방에서 나가도 방은 지우지 않는다 — 다음 게임을 시작할 방이 사라지면 안 된다")
    void keepsTheGuestSoloRoomWhenItEmpties() {
        lastMemberIn(GUEST_ROOM, GUEST_KEY, "WAITING", null);

        service.leave(guest, GUEST_ROOM);

        verify(repository, never()).deleteRoom(anyString());
    }

    @Test
    @DisplayName("게임 중에 나갔어도 빈 1인방은 다시 대기 상태 — 안 돌리면 다음 입장이 ROOM_GAME_IN_PROGRESS")
    void resetsTheGuestSoloRoomToWaiting() {
        lastMemberIn(GUEST_ROOM, GUEST_KEY, "PLAYING", null);

        service.leave(guest, GUEST_ROOM);

        verify(repository).updateStatus(GUEST_ROOM, "WAITING");
    }

    @Test
    @DisplayName("회원 방은 비면 그대로 지운다 — 게스트 예외가 일반 방까지 살려 두면 안 된다")
    void stillDeletesAnEmptyMemberRoom() {
        lastMemberIn(MEMBER_ROOM, MEMBER_KEY, "WAITING", "INVITE");

        service.leave(member, MEMBER_ROOM);

        verify(repository).deleteRoom(MEMBER_ROOM);
    }
}
