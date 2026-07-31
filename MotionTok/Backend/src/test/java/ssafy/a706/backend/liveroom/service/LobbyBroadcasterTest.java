package ssafy.a706.backend.liveroom.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;
import ssafy.a706.backend.liveroom.controller.dto.LobbyRoomEvent;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 1초 창에서 같은 방의 변화가 겹쳤을 때 무엇이 남는지.
 *
 * <p>특히 CREATED가 UPDATED에 먹히면 안 된다 — 로비 클라이언트는 자기 목록에 없는 방의 UPDATED를
 * 버리므로, 접히는 순간 그 방은 다음 전체 조회 전까지 아무에게도 보이지 않는다. 방 공개 직후
 * 첫 입장이 같은 창에 들어오면 바로 이 상황이 된다.</p>
 */
@ExtendWith(MockitoExtension.class)
class LobbyBroadcasterTest {

    private static final String ROOM_ID = "R1AB2C";

    @Mock SimpMessagingTemplate messagingTemplate;

    @InjectMocks LobbyBroadcaster broadcaster;

    @Captor ArgumentCaptor<List<LobbyRoomEvent>> batch;

    @Test
    @DisplayName("공개 직후 참가자가 들어와도 CREATED로 남는다 — 최신 인원수를 실어서")
    void createdSurvivesUpdate() {
        broadcaster.roomCreated(summary(1));
        broadcaster.roomUpdated(summary(2));

        broadcaster.flush();

        LobbyRoomEvent event = onlyEvent();
        assertThat(event.isCreated()).isTrue();
        assertThat(event.room().participantCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("생겼다가 같은 창에서 사라진 방은 아예 내보내지 않는다")
    void createdThenClosedIsDropped() {
        broadcaster.roomCreated(summary(1));
        broadcaster.roomClosed(ROOM_ID);

        broadcaster.flush();

        verify(messagingTemplate, never()).convertAndSend(eq(LobbyBroadcaster.LOBBY_TOPIC), any(List.class));
    }

    @Test
    @DisplayName("이미 목록에 있던 방이 닫히면 CLOSED만 남는다 — 지워질 방의 인원수를 그렸다 지우지 않는다")
    void updatedThenClosedKeepsClosed() {
        broadcaster.roomUpdated(summary(3));
        broadcaster.roomClosed(ROOM_ID);

        broadcaster.flush();

        assertThat(onlyEvent().isClosed()).isTrue();
    }

    private LobbyRoomEvent onlyEvent() {
        verify(messagingTemplate).convertAndSend(eq(LobbyBroadcaster.LOBBY_TOPIC), batch.capture());
        assertThat(batch.getValue()).hasSize(1);
        return batch.getValue().getFirst();
    }

    private LiveRoomSummaryResponse summary(int participantCount) {
        return new LiveRoomSummaryResponse(ROOM_ID, "놀자", "PUBLIC", 4, participantCount, "WAITING", false);
    }
}
