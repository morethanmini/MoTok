package ssafy.a706.backend.video.provider;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.video.OpenViduProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * OpenVidu 3 SFU 어댑터(-123). 내부 엔진이 LiveKit라 토큰 규격·클라이언트 SDK(livekit-client)가
 * LiveKit 어댑터와 완전 호환 — 백엔드 관점 차이는 접속 URL·키뿐이다(-63/03).
 * 두 배포판의 성능·오버헤드 비교(-120)를 위해 어댑터를 분리해 둔다.
 * OpenVidu 고유 동작이 필요해지면 이 클래스 안에만 격리할 것.
 */
@Component
@RequiredArgsConstructor
public class OpenViduAccessProvider implements VideoAccessProvider {

    private final OpenViduProperties properties;

    @Override
    public VideoAccessMode mode() {
        return VideoAccessMode.SFU_OPENVIDU;
    }

    @Override
    public VideoAccessResponse issue(String roomId, AuthPrincipal principal) {
        String token = LivekitTokenSigner.sign(
                properties.apiKey(), properties.apiSecret(), properties.tokenTtl(), roomId, principal);
        return VideoAccessResponse.sfu(mode(), properties.url(), token, properties.tokenTtl().toSeconds());
    }
}
