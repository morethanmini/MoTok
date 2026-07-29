package ssafy.a706.backend.video.provider;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import ssafy.a706.backend.video.LivekitProperties;
import ssafy.a706.backend.video.OpenViduProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.VideoAccessProperties;

import java.util.Map;

/**
 * SFU 참가자 강제 퇴장 — 미디어서버 RoomService API(twirp) 호출.
 *
 * <p>단일 세션 밀어내기(-157 후속)의 마지막 조각이다. sid 폐기는 우리 JWT만 죽인다 —
 * SFU 접속 토큰은 미디어서버가 자기 비밀로 따로 검증하는 별개의 JWT라, 이미 붙어 있는
 * 미디어 연결은 서버가 직접 끊어 달라고 해야 끊긴다. LiveKit과 OpenVidu는 엔진이 같아
 * 동일한 twirp API를 쓰고(-63/03), mesh는 중앙 미디어서버가 없어 끊을 대상도 없다(no-op).</p>
 *
 * <p>발급 어댑터(VideoAccessProvider)에 넣지 않은 이유 — 그 인터페이스는 "저장소·미디어서버 호출
 * 없이 무상태 발급"이 계약이다. 퇴장은 미디어서버를 직접 부르는 반대 성격의 동작이라 따로 둔다.</p>
 *
 * <p>best-effort다 — 로그인 경로에서 비동기로 불리므로 실패해도 밀어내기 자체는 이미 끝나 있고
 * (sid 폐기·소켓 종료), 방 상태도 RoomPresenceTracker가 정리한다. 실패는 로그로만 남긴다.</p>
 */
@Slf4j
@Component
public class SfuParticipantEjector {

    private static final String REMOVE_PARTICIPANT = "/twirp/livekit.RoomService/RemoveParticipant";

    private final WebClient webClient;
    private final VideoAccessMode mode;
    private final String baseUrl;
    private final String apiKey;
    private final String apiSecret;

    public SfuParticipantEjector(WebClient sfuAdminWebClient,
                                 VideoAccessProperties accessProperties,
                                 LivekitProperties livekit,
                                 OpenViduProperties openVidu) {
        this.webClient = sfuAdminWebClient;
        this.mode = VideoAccessMode.fromConfig(accessProperties.provider());
        // 클라이언트 접속 URL(ws/wss)을 관리 API 주소(http/https)로 바꾼다 — LiveKit 공식 SDK와 같은 규칙.
        String url = mode == VideoAccessMode.SFU_OPENVIDU ? openVidu.url() : livekit.url();
        this.baseUrl = url.replaceFirst("^ws", "http");
        this.apiKey = mode == VideoAccessMode.SFU_OPENVIDU ? openVidu.apiKey() : livekit.apiKey();
        this.apiSecret = mode == VideoAccessMode.SFU_OPENVIDU ? openVidu.apiSecret() : livekit.apiSecret();
    }

    /** 참가자를 방에서 끊는다. identity = 토큰 발급 때 넣은 값(AuthPrincipal.userId, 회원은 PK 문자열). */
    public void eject(String roomId, String identity) {
        if (mode == VideoAccessMode.P2P_MESH) {
            return;
        }
        try {
            webClient.post()
                    .uri(baseUrl + REMOVE_PARTICIPANT)
                    .header(HttpHeaders.AUTHORIZATION,
                            "Bearer " + LivekitTokenSigner.signRoomAdmin(apiKey, apiSecret, roomId))
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(Map.of("room", roomId, "identity", identity))
                    .retrieve()
                    .toBodilessEntity()
                    .block();
            log.info("SFU 강제 퇴장: room={} identity={}", roomId, identity);
        } catch (RuntimeException e) {
            // 이미 스스로 나갔거나(404) 미디어서버 장애 — 퇴장 실패가 밀어내기를 되돌리지는 못한다.
            log.warn("SFU 강제 퇴장 실패: room={} identity={} — {}", roomId, identity, e.getMessage());
        }
    }
}
