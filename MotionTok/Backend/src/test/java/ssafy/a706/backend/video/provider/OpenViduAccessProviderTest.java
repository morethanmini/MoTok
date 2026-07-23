package ssafy.a706.backend.video.provider;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.video.OpenViduProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** OpenVidu 어댑터: LiveKit 호환 토큰이 openvidu 키·URL 기준으로 발급되는지 검증. */
class OpenViduAccessProviderTest {

    private static final String SECRET = "ov-secret-unit-test-0123456789abcdef";

    private final OpenViduAccessProvider provider = new OpenViduAccessProvider(
            new OpenViduProperties("wss://ov.test/openvidu", "ov-key", SECRET, Duration.ofMinutes(5)));

    @Test
    @DisplayName("SFU_OPENVIDU mode로 openvidu 키 서명 LiveKit 호환 토큰을 발급한다")
    void issuesOpenViduToken() {
        VideoAccessResponse response = provider.issue("room-9", new GuestPrincipal("guest-b", "게스트B"));

        assertThat(response.mode()).isEqualTo(VideoAccessMode.SFU_OPENVIDU);
        assertThat(response.p2p()).isNull();
        assertThat(response.sfu().url()).isEqualTo("wss://ov.test/openvidu");
        assertThat(response.sfu().expiresIn()).isEqualTo(300);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(response.sfu().token())
                .getPayload();
        assertThat(claims.getIssuer()).isEqualTo("ov-key");
        assertThat(claims.getSubject()).isEqualTo("guest-b");
        assertThat(claims.get("video", Map.class)).containsEntry("room", "room-9");
    }
}
