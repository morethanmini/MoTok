package ssafy.a706.backend.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.TestPropertySource;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * rtc.provider=mesh 전환 검증(-123) — env 스위치 하나로 같은 엔드포인트가
 * P2P_MESH(iceServers + 시그널 목적지) 응답으로 바뀌는지. 부하테스트(-120) 전환 방식 그대로.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "rtc.provider=mesh",
                "turn.host=turn.test",
                "turn.secret=it-secret",
                "turn.credential-ttl-seconds=600"
        })
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class VideoAccessMeshIntegrationTest {

    private static final String MEMBER_ID = "guest-member";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private LiveRoomRepository liveRoomRepository;

    @Autowired
    private StringRedisTemplate redisTemplate;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String roomId;

    @BeforeEach
    void setUpRoom() {
        long now = System.currentTimeMillis();
        roomId = liveRoomRepository.generateUniqueRoomId();
        liveRoomRepository.saveRoom(roomId, Map.of(
                "title", "mesh 전환 테스트",
                "visibility", "PRIVATE",
                "maxPlayers", "4",
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
    @DisplayName("mesh 설정이면 rtc-access가 P2P_MESH(iceServers·시그널 목적지)로 응답하고 sfu는 생략된다")
    void issueMeshAccess() throws Exception {
        HttpResponse<String> response = get(
                "/api/v1/live-rooms/" + roomId + "/rtc-access",
                tokenProvider.createGuestToken(MEMBER_ID, "멤버"));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(response.body()).get("data");
        assertThat(data.get("mode").asText()).isEqualTo("P2P_MESH");
        assertThat(data.has("sfu")).isFalse();

        JsonNode p2p = data.get("p2p");
        assertThat(p2p.get("ttl").asLong()).isEqualTo(600);
        assertThat(p2p.get("iceServers").get(0).get("urls").get(0).asText()).isEqualTo("stun:turn.test:3478");
        assertThat(p2p.get("iceServers").get(1).get("username").asText()).endsWith(":" + MEMBER_ID);
        assertThat(p2p.at("/signal/publish").asText()).isEqualTo("/app/rooms/" + roomId + "/signal");
        assertThat(p2p.at("/signal/subscribe").asText()).isEqualTo("/user/queue/signal");
    }

    @Test
    @DisplayName("mesh 설정에서도 레거시 video-token은 LiveKit 계약을 유지한다")
    void legacyEndpointUnaffectedBySwitch() throws Exception {
        HttpResponse<String> response = get(
                "/api/v1/live-rooms/" + roomId + "/video-token",
                tokenProvider.createGuestToken(MEMBER_ID, "멤버"));

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(response.body()).get("data");
        assertThat(data.has("url")).isTrue();
        assertThat(data.has("token")).isTrue();   // 기존 SfuTokenResponse 스키마 그대로
        assertThat(data.has("mode")).isFalse();
    }

    // ---- helpers ----

    private HttpResponse<String> get(String path, String jwt) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + port + path))
                .header("Authorization", "Bearer " + jwt)
                .GET()
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
