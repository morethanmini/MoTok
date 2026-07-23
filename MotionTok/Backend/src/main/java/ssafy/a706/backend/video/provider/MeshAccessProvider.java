package ssafy.a706.backend.video.provider;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.video.IceServerService;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.IceServersResponse;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * 자체 시그널링(-29) + coturn(-31) P2P mesh 어댑터. 미디어서버 없이
 * ICE 자격 증명(STUN/TURN — 둘 다 coturn이 겸함)과 시그널 릴레이 목적지를 안내한다.
 * SDP/ICE 교환·재협상은 클라이언트가 STOMP 릴레이 위에서 직접 수행.
 */
@Component
@RequiredArgsConstructor
public class MeshAccessProvider implements VideoAccessProvider {

    private final IceServerService iceServerService;

    @Override
    public VideoAccessMode mode() {
        return VideoAccessMode.P2P_MESH;
    }

    @Override
    public VideoAccessResponse issue(String roomId, AuthPrincipal principal) {
        IceServersResponse ice = iceServerService.issue(principal.userId());
        return VideoAccessResponse.p2p(ice.iceServers(), ice.ttl(),
                // -29 시그널 릴레이 계약 (SignalController·WebSocketConfig 참고)
                new VideoAccessResponse.SignalChannel(
                        "/app/rooms/" + roomId + "/signal",
                        "/user/queue/signal",
                        "/user/queue/errors"));
    }
}
