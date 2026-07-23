package ssafy.a706.backend.video;

import java.util.Arrays;

/**
 * 화상 접속 방식(-123). 응답의 mode 필드로 그대로 노출되며, 클라이언트는 이 값으로 분기한다.
 * - SFU_LIVEKIT / SFU_OPENVIDU: livekit-client SDK로 sfu.url·token 접속 (두 방식은 클라 동일)
 * - P2P_MESH: RTCPeerConnection(p2p.iceServers) + STOMP 시그널 릴레이(-29)
 */
public enum VideoAccessMode {

    SFU_LIVEKIT("livekit"),
    SFU_OPENVIDU("openvidu"),
    P2P_MESH("mesh");

    /** application.yaml rtc.provider 설정값 */
    private final String configValue;

    VideoAccessMode(String configValue) {
        this.configValue = configValue;
    }

    public static VideoAccessMode fromConfig(String value) {
        return Arrays.stream(values())
                .filter(mode -> mode.configValue.equalsIgnoreCase(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "rtc.provider 값이 잘못됨: '" + value + "' (허용: livekit | openvidu | mesh)"));
    }
}
