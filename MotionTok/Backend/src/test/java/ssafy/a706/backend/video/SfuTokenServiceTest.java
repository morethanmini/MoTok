package ssafy.a706.backend.video;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.video.dto.SfuTokenResponse;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * 발급 토큰을 같은 시크릿으로 역파싱해 LiveKit Access Token 규격
 * (iss/sub/name/video 클레임)을 검증한다. Spring 컨텍스트 불필요.
 */
class SfuTokenServiceTest {

    private static final String SECRET = "devsecret-unit-test-0123456789abcdef";
    private static final String ROOM_ID = "room-1234";

    private final RoomMembershipReader membershipReader = mock(RoomMembershipReader.class);
    private final LivekitProperties properties =
            new LivekitProperties("ws://localhost:7880", "devkey", SECRET, Duration.ofMinutes(10));
    private final SfuTokenService service = new SfuTokenService(membershipReader, properties);

    @Test
    @DisplayName("방 멤버에게 room·identity·권한이 박힌 LiveKit 규격 토큰을 발급한다")
    void issueTokenForMember() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-a")).willReturn(true);

        SfuTokenResponse response = service.issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A"));

        assertThat(response.url()).isEqualTo("ws://localhost:7880");
        assertThat(response.expiresIn()).isEqualTo(600);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(response.token())
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

    @Test
    @DisplayName("존재하지 않는 방이면 ROOM_NOT_FOUND")
    void rejectUnknownRoom() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(false);

        assertThatThrownBy(() -> service.issue(ROOM_ID, new GuestPrincipal("guest-a", "게스트A")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.ROOM_NOT_FOUND);
    }

    @Test
    @DisplayName("방 멤버가 아니면 SFU_NOT_IN_ROOM")
    void rejectNonMember() {
        given(membershipReader.existsRoom(ROOM_ID)).willReturn(true);
        given(membershipReader.isMember(ROOM_ID, "guest-x")).willReturn(false);

        assertThatThrownBy(() -> service.issue(ROOM_ID, new GuestPrincipal("guest-x", "외부인")))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.SFU_NOT_IN_ROOM);
    }
}
