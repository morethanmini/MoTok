package ssafy.a706.backend.video.provider;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.video.LivekitProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * LiveKit 셀프호스팅 SFU 어댑터(-30 이관). 클라이언트가 미디어서버와 직접 시그널링·연결하므로
 * 우리 서버는 입장권(토큰) 발급 창구 역할만 한다.
 */
@Component
@RequiredArgsConstructor
public class LivekitAccessProvider implements VideoAccessProvider {

    private final LivekitProperties properties;

    @Override
    public VideoAccessMode mode() {
        return VideoAccessMode.SFU_LIVEKIT;
    }

    @Override
    public VideoAccessResponse issue(String roomId, AuthPrincipal principal) {
        String token = LivekitTokenSigner.sign(
                properties.apiKey(), properties.apiSecret(), properties.tokenTtl(), roomId, principal);
        return VideoAccessResponse.sfu(mode(), properties.url(), token, properties.tokenTtl().toSeconds());
    }
}
