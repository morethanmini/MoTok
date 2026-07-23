package ssafy.a706.backend.video.provider;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.video.LivekitProperties;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 발급 토큰을 같은 시크릿으로 역파싱해 LiveKit Access Token 규격
 * (iss/sub/name/video 클레임)을 검증한다. Spring 컨텍스트 불필요.
 * (구 SfuTokenServiceTest의 토큰 규격 검증 — 방 검증은 VideoAccessServiceTest로 분리)
 */
class LivekitAccessProviderTest {

    private static final String SECRET = "devsecret-unit-test-0123456789abcdef";
    private static final String ROOM_ID = "room-1234";

    private final LivekitAccessProvider provider = new LivekitAccessProvider(
            new LivekitProperties("ws://localhost:7880", "devkey", SECRET, Duration.ofMinutes(10)));

    @Test
    @DisplayName("room·identity·권한이 박힌 LiveKit 규격 토큰과 SFU_LIVEKIT mode를 발급한다")
    void issuesLivekitToken() {
        VideoAccessResponse response = provider.issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A"));

        assertThat(response.mode()).isEqualTo(VideoAccessMode.SFU_LIVEKIT);
        assertThat(response.p2p()).isNull();
        assertThat(response.sfu().url()).isEqualTo("ws://localhost:7880");
        assertThat(response.sfu().expiresIn()).isEqualTo(600);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(response.sfu().token())
                .getPayload();
        assertThat(claims.getIssuer()).isEqualTo("devkey");
        assertThat(claims.getSubject()).isEqualTo("guest-a");
        assertThat(claims.get("name", String.class)).isEqualTo("게스트A");
        assertThat(claims.getExpiration()).isAfter(claims.getIssuedAt());

        @SuppressWarnings("unchecked")
        Map<String, Object> video = claims.get("video", Map.class);
        assertThat(video).containsEntry("room", ROOM_ID)
                .containsEntry("roomJoin", true)
                .containsEntry("canPublish", true)
                .containsEntry("canSubscribe", true);
    }
}
