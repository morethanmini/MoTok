package ssafy.a706.backend.video.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import ssafy.a706.backend.video.VideoAccessMode;

import java.util.List;

/**
 * 통합 화상 접속 응답(-123). mode로 판별하는 union — sfu/p2p 중 한쪽만 채워지고
 * 나머지는 응답에서 생략된다. 클라이언트 분기 코드는 switch(mode) 하나면 된다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record VideoAccessResponse(VideoAccessMode mode, SfuAccess sfu, P2pAccess p2p) {

    public static VideoAccessResponse sfu(VideoAccessMode mode, String url, String token, long expiresIn) {
        return new VideoAccessResponse(mode, new SfuAccess(url, token, expiresIn), null);
    }

    public static VideoAccessResponse p2p(List<IceServer> iceServers, long ttl, SignalChannel signal) {
        return new VideoAccessResponse(VideoAccessMode.P2P_MESH, null, new P2pAccess(iceServers, ttl, signal));
    }

    /** SFU 계열: livekit-client의 Room.connect(url, token)에 그대로 투입 */
    public record SfuAccess(String url, String token, long expiresIn) {
    }

    /** P2P mesh: iceServers는 RTCPeerConnection에 투입, 시그널링은 signal 목적지 사용 */
    public record P2pAccess(List<IceServer> iceServers, long ttl, SignalChannel signal) {
    }

    /** -29 STOMP 시그널 릴레이 목적지 (publish=발행, subscribe·errors=구독) */
    public record SignalChannel(String publish, String subscribe, String errors) {
    }
}
