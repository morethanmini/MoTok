package ssafy.a706.backend.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 화상 접속 토큰 발급 API 통합 테스트.
 * 전제: MySQL(3307)·Redis(6379) 기동 상태(docker compose up -d). LiveKit 컨테이너는 불필요 —
 * 발급은 무상태 서명뿐이라 LiveKit 없이 검증 가능(실접속은 하네스 E2E에서).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SfuTokenIntegrationTest {

    private static final String MEMBER_ID = "guest-member";
    private static final String OUTSIDER_ID = "guest-outsider";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private LiveRoomRepository liveRoomRepository;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private LivekitProperties properties;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String roomId;

    /** liveroom Redis 스키마로 방 시딩 (SignalRelayIntegrationTest와 동일 규격). */
    @BeforeEach
    void setUpRoom() {
        long now = System.currentTimeMillis();
        roomId = liveRoomRepository.generateUniqueRoomId();
        liveRoomRepository.saveRoom(roomId, Map.of(
                "title", "SFU 토큰 테스트",
                "visibility", "PRIVATE",
                "maxPlayers", "8",
                "status", "WAITING",
                "hostUserId", MEMBER_ID,
                "hostDisplayName", "멤버",
                "createdAt", String.valueOf(now)
        ));
        liveRoomRepository.addMember(roomId, "g:" + MEMBER_ID, MEMBER_ID, "멤버", true, now);
    }

    @AfterEach
    void tearDown() {
        redisTemplate.delete(List.of("room:" + roomId, "room:" + roomId + ":members"));
    }

    @Test
    @DisplayName("방 멤버는 200과 함께 LiveKit 접속 정보(url·검증 가능한 토큰)를 받는다")
    void issueTokenForMember() throws Exception {
        HttpResponse<String> response = get(roomId, tokenProvider.createGuestToken(MEMBER_ID, "멤버"));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode body = objectMapper.readTree(response.body());
        assertThat(body.get("success").asBoolean()).isTrue();
        assertThat(body.at("/data/url").asText()).isEqualTo(properties.url());
        assertThat(body.at("/data/expiresIn").asLong()).isEqualTo(properties.tokenTtl().toSeconds());

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(properties.apiSecret().getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(body.at("/data/token").asText())
                .getPayload();
        assertThat(claims.getIssuer()).isEqualTo(properties.apiKey());
        assertThat(claims.getSubject()).isEqualTo(MEMBER_ID);
        assertThat(claims.get("video", Map.class)).containsEntry("room", roomId);
    }

    @Test
    @DisplayName("방에 없는 사용자는 403 SFU_NOT_IN_ROOM")
    void rejectNonMember() throws Exception {
        HttpResponse<String> response = get(roomId, tokenProvider.createGuestToken(OUTSIDER_ID, "외부인"));

        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(objectMapper.readTree(response.body()).get("code").asText()).isEqualTo("SFU_NOT_IN_ROOM");
    }

    @Test
    @DisplayName("존재하지 않는 방이면 404 ROOM_NOT_FOUND")
    void rejectUnknownRoom() throws Exception {
        HttpResponse<String> response = get("no-such-room", tokenProvider.createGuestToken(MEMBER_ID, "멤버"));

        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(objectMapper.readTree(response.body()).get("code").asText()).isEqualTo("ROOM_NOT_FOUND");
    }

    @Test
    @DisplayName("인증 없이 호출하면 401")
    void rejectAnonymous() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url(roomId)))
                .GET()
                .build();

        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(401);
    }

    // ---- helpers ----

    private String url(String roomId) {
        return "http://localhost:" + port + "/api/v1/live-rooms/" + roomId + "/video-token";
    }

    private HttpResponse<String> get(String roomId, String jwt) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url(roomId)))
                .header("Authorization", "Bearer " + jwt)
                .GET()
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
