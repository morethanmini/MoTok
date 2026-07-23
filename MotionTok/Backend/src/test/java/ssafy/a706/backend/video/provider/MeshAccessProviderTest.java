package ssafy.a706.backend.video.provider;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.video.IceServerService;
import ssafy.a706.backend.video.TurnProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

import static org.assertj.core.api.Assertions.assertThat;

/** mesh 어댑터: ICE 자격(-31 재사용) + -29 시그널 릴레이 목적지 동봉을 검증. */
class MeshAccessProviderTest {

    private final MeshAccessProvider provider = new MeshAccessProvider(
            new IceServerService(new TurnProperties("turn.test", 3478, "test-secret", 600)));

    @Test
    @DisplayName("P2P_MESH mode로 iceServers·ttl·방별 시그널 목적지를 내려준다")
    void issuesMeshAccess() {
        VideoAccessResponse response = provider.issue("room-77", new GuestPrincipal("guest-a", "게스트A"));

        assertThat(response.mode()).isEqualTo(VideoAccessMode.P2P_MESH);
        assertThat(response.sfu()).isNull();

        VideoAccessResponse.P2pAccess p2p = response.p2p();
        assertThat(p2p.ttl()).isEqualTo(600);
        assertThat(p2p.iceServers()).hasSize(2);   // STUN + TURN(자격) — 값 검증은 IceServerServiceTest
        assertThat(p2p.iceServers().get(0).urls()).containsExactly("stun:turn.test:3478");

        assertThat(p2p.signal().publish()).isEqualTo("/app/rooms/room-77/signal");
        assertThat(p2p.signal().subscribe()).isEqualTo("/user/queue/signal");
        assertThat(p2p.signal().errors()).isEqualTo("/user/queue/errors");
    }
}
