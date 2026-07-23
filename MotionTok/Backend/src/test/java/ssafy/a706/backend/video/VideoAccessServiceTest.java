package ssafy.a706.backend.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.signal.RoomMembershipReader;
import ssafy.a706.backend.video.dto.VideoAccessResponse;
import ssafy.a706.backend.video.provider.LivekitAccessProvider;
import ssafy.a706.backend.video.provider.MeshAccessProvider;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * 공통 검증(방 존재·멤버)과 rtc.provider 선택이 어댑터와 무관하게 한 곳에서 동작하는지 검증.
 * (구 SfuTokenServiceTest의 검증 케이스 이관)
 */
class VideoAccessServiceTest {

    private static final String ROOM_ID = "room-1234";

    private final RoomMembershipReader membershipReader = mock(RoomMembershipReader.class);
    private final LivekitAccessProvider livekit = new LivekitAccessProvider(
            new LivekitProperties("ws://localhost:7880", "devkey",
                    "devsecret-unit-test-0123456789abcdef", Duration.ofMinutes(10)));
    private final MeshAccessProvider mesh = new MeshAccessProvider(
            new IceServerService(new TurnProperties("turn.test", 3478, "test-secret", 600)));

    private VideoAccessService service(String provider) {
        return new VideoAccessService(membershipReader, List.of(livekit, mesh),
                new VideoAccessProperties(provider));
    }

    @Test
    @DisplayName("rtc.provider=livekit이면 통합 발급이 SFU_LIVEKIT으로 나간다")
    void defaultProviderLivekit() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-a")).willReturn(true);

        VideoAccessResponse response = service("livekit").issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A"));

        assertThat(response.mode()).isEqualTo(VideoAccessMode.SFU_LIVEKIT);
        assertThat(response.sfu()).isNotNull();
    }

    @Test
    @DisplayName("rtc.provider=mesh면 같은 요청이 P2P_MESH로 나간다 (스위치 전환)")
    void defaultProviderMesh() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-a")).willReturn(true);

        VideoAccessResponse response = service("mesh").issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A"));

        assertThat(response.mode()).isEqualTo(VideoAccessMode.P2P_MESH);
        assertThat(response.p2p().signal().publish()).isEqualTo("/app/rooms/" + ROOM_ID + "/signal");
    }

    @Test
    @DisplayName("방식 고정 발급: mesh 설정에서도 레거시 경로는 LiveKit을 유지한다")
    void forcedModeKeepsLegacyContract() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-a")).willReturn(true);

        VideoAccessResponse response = service("mesh")
                .issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A"), VideoAccessMode.SFU_LIVEKIT);

        assertThat(response.mode()).isEqualTo(VideoAccessMode.SFU_LIVEKIT);
    }

    @Test
    @DisplayName("존재하지 않는 방이면 ROOM_NOT_FOUND")
    void rejectUnknownRoom() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(false);

        assertThatThrownBy(() -> service("livekit").issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.ROOM_NOT_FOUND);
    }

    @Test
    @DisplayName("방 멤버가 아니면 SFU_NOT_IN_ROOM")
    void rejectNonMember() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-x")).willReturn(false);

        assertThatThrownBy(() -> service("livekit").issue(ROOM_ID, new GuestPrincipal("guest-x", "외부인")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.SFU_NOT_IN_ROOM);
    }

    @Test
    @DisplayName("rtc.provider 오타는 기동 시점(생성자)에 실패한다")
    void rejectUnknownProviderConfig() {
        assertThatThrownBy(() -> service("livkit"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("livkit");
    }

    @Test
    @DisplayName("설정된 방식의 어댑터가 미등록이면 기동 시점에 실패한다")
    void rejectMissingProviderBean() {
        assertThatThrownBy(() -> new VideoAccessService(membershipReader, List.of(livekit),
                new VideoAccessProperties("mesh")))
                .isInstanceOf(IllegalStateException.class);
    }
}
