package ssafy.a706.backend.rtc;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.client.RestClient;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GET /api/v1/rtc/ice-servers 통합 테스트.
 * 전제: MySQL(3307)·Redis(6379) 기동 상태(docker compose up -d) — 컨텍스트 부팅에 필요.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "turn.host=turn.test",
                "turn.secret=it-secret",
                "turn.credential-ttl-seconds=600"
        })
class RtcIceServersIntegrationTest {

    private static final String PATH = "/api/v1/rtc/ice-servers";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    private RestClient client() {
        return RestClient.create("http://localhost:" + port);
    }

    /** exchange()는 상태 코드로 예외를 던지지 않아 4xx 검증에 그대로 쓴다. */
    private record Result(HttpStatusCode status, String body) {
    }

    private Result get(String bearerToken) {
        return client().get().uri(PATH)
                .headers(h -> {
                    if (bearerToken != null) {
                        h.setBearerAuth(bearerToken);
                    }
                })
                .exchange((req, res) -> new Result(res.getStatusCode(), res.bodyTo(String.class)));
    }

    @Test
    @DisplayName("게스트 JWT로 조회하면 200 + STUN/TURN 목록과 자격 증명이 온다")
    void returnsIceServersForAuthenticated() {
        Result res = get(tokenProvider.createGuestToken("guest-ice", "아이스"));

        assertThat(res.status()).isEqualTo(HttpStatus.OK);
        assertThat(res.body())
                .contains("\"success\":true")
                .contains("stun:turn.test:3478")
                .contains("turn:turn.test:3478?transport=udp")
                .contains("turn:turn.test:3478?transport=tcp")
                .contains(":guest-ice\"")   // username 끝이 참가자 ID
                .contains("\"credential\":")
                .contains("\"ttl\":600");
    }

    @Test
    @DisplayName("JWT 없이 조회하면 401")
    void rejectsAnonymous() {
        Result res = get(null);

        assertThat(res.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
