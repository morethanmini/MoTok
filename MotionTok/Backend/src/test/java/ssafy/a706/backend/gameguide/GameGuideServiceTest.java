package ssafy.a706.backend.gameguide;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.gameguide.dto.GameGuideEvent;
import ssafy.a706.backend.gameguide.dto.GameGuideRequests;
import ssafy.a706.backend.liveroom.event.LiveRoomClosedEvent;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 설명 함께 보기 단위 테스트 — 브로커·Redis 없이 순수 로직 검증.
 *
 * <p>지키려는 것은 두 가지다. (1) 방장만 남의 화면을 바꿀 수 있다. (2) 늦게 들어온 사람이
 * 지금 상태를 받아 볼 수 있다 — 토픽은 재생되지 않으므로 이게 없으면 그 사람만 화면이 빈다.</p>
 */
@ExtendWith(MockitoExtension.class)
class GameGuideServiceTest {

    private static final String ROOM_ID = "R1AB2C";
    private static final String TOPIC = "/topic/rooms/" + ROOM_ID + "/guide";
    private static final String HOST_ID = "1";
    private static final String GUEST_ID = "2";

    @Mock RoomMembershipReader membershipReader;
    @Mock LiveRoomRepository liveRoomRepository;
    @Mock SimpMessagingTemplate messagingTemplate;

    @InjectMocks GameGuideService service;

    @Captor ArgumentCaptor<GameGuideEvent> eventCaptor;

    private static MemberPrincipal principal(String userId) {
        return new MemberPrincipal(Long.parseLong(userId), "user" + userId);
    }

    @BeforeEach
    void roomExists() {
        lenient().when(membershipReader.existsRoom(ROOM_ID)).thenReturn(true);
        lenient().when(membershipReader.isMember(eq(ROOM_ID), org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(true);
        lenient().when(liveRoomRepository.findRoomFields(ROOM_ID))
                .thenReturn(Optional.of(Map.of("hostUserId", HOST_ID)));
    }

    @Test
    void 방장이_연_설명이_방_전체에_배포된다() {
        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, 2), principal(HOST_ID));

        verify(messagingTemplate).convertAndSend(eq(TOPIC), eventCaptor.capture());
        assertThat(eventCaptor.getValue()).isEqualTo(new GameGuideEvent(true, 1L, 2));
    }

    @Test
    void 방장이_아니면_거절된다() {
        assertThatThrownBy(() ->
                service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, 0), principal(GUEST_ID)))
                .isInstanceOf(GameGuideException.class)
                .hasFieldOrPropertyWithValue("code", "GUIDE_NOT_HOST");

        verify(messagingTemplate, never()).convertAndSend(eq(TOPIC), org.mockito.ArgumentMatchers.any(Object.class));
    }

    @Test
    void 늦게_들어온_사람은_지금_페이지를_그대로_받는다() {
        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 11L, 3), principal(HOST_ID));

        // 방장이 아니어도 조회는 된다 — 보기만 하는 요청이다.
        assertThat(service.current(ROOM_ID, principal(GUEST_ID)))
                .isEqualTo(new GameGuideEvent(true, 11L, 3));
    }

    @Test
    void 닫으면_상태가_남지_않는다() {
        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, 4), principal(HOST_ID));
        service.publish(ROOM_ID, new GameGuideRequests.Publish(false, null, 0), principal(HOST_ID));

        assertThat(service.current(ROOM_ID, principal(GUEST_ID))).isEqualTo(GameGuideEvent.closed());
    }

    @Test
    void 열면서_게임을_안_주면_거절된다() {
        assertThatThrownBy(() ->
                service.publish(ROOM_ID, new GameGuideRequests.Publish(true, null, 0), principal(HOST_ID)))
                .isInstanceOf(GameGuideException.class)
                .hasFieldOrPropertyWithValue("code", "GUIDE_GAME_REQUIRED");
    }

    @Test
    void 터무니없는_페이지는_범위로_잘린다() {
        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, -5), principal(HOST_ID));
        assertThat(service.current(ROOM_ID, principal(HOST_ID)).page()).isZero();

        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, 9999), principal(HOST_ID));
        assertThat(service.current(ROOM_ID, principal(HOST_ID)).page()).isEqualTo(99);
    }

    @Test
    void 방이_닫히면_상태를_버린다() {
        service.publish(ROOM_ID, new GameGuideRequests.Publish(true, 1L, 1), principal(HOST_ID));

        service.onRoomClosed(new LiveRoomClosedEvent(ROOM_ID));

        assertThat(service.current(ROOM_ID, principal(HOST_ID))).isEqualTo(GameGuideEvent.closed());
    }

    @Test
    void 방에_없으면_조회도_막힌다() {
        when(membershipReader.isMember(ROOM_ID, GUEST_ID)).thenReturn(false);

        assertThatThrownBy(() -> service.current(ROOM_ID, principal(GUEST_ID)))
                .isInstanceOf(GameGuideException.class)
                .hasFieldOrPropertyWithValue("code", "GUIDE_NOT_IN_ROOM");
    }
}
