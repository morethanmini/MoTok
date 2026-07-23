package ssafy.a706.backend.video;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.video.dto.IceServer;
import ssafy.a706.backend.video.dto.IceServersResponse;

import static org.assertj.core.api.Assertions.assertThat;

/** 자격 증명 생성 단위 테스트 — 기대값은 openssl로 독립 계산한 고정 벡터. */
class IceServerServiceTest {

    private static final long NOW = 1753141800L;

    private IceServerService service(String secret) {
        return new IceServerService(new TurnProperties("turn.test", 3478, secret, 600));
    }

    @Test
    @DisplayName("TURN 자격 증명: username=만료epoch:참가자ID, credential=HMAC-SHA1 고정 벡터 일치")
    void issuesHmacCredential() {
        // printf '%s' "1753142400:u123" | openssl dgst -sha1 -hmac "test-secret" -binary | base64
        IceServersResponse res = service("test-secret").issue("u123", NOW);

        assertThat(res.ttl()).isEqualTo(600);
        assertThat(res.iceServers()).hasSize(2);

        IceServer stun = res.iceServers().get(0);
        assertThat(stun.urls()).containsExactly("stun:turn.test:3478");
        assertThat(stun.username()).isNull();
        assertThat(stun.credential()).isNull();

        IceServer turn = res.iceServers().get(1);
        assertThat(turn.urls()).containsExactly(
                "turn:turn.test:3478?transport=udp",
                "turn:turn.test:3478?transport=tcp");
        assertThat(turn.username()).isEqualTo("1753142400:u123");
        assertThat(turn.credential()).isEqualTo("O33F/5SRDHezJUiKhUQiB6qSnyQ=");
    }

    @Test
    @DisplayName("secret 미설정이면 STUN만 내려준다 (로컬 degrade)")
    void stunOnlyWithoutSecret() {
        IceServersResponse res = service("").issue("u123", NOW);

        assertThat(res.iceServers()).hasSize(1);
        assertThat(res.iceServers().get(0).urls()).containsExactly("stun:turn.test:3478");
    }

    @Test
    @DisplayName("게스트 ID도 같은 규격으로 발급된다")
    void issuesForGuest() {
        IceServersResponse res = service("test-secret").issue("guest-ab3f", NOW);

        assertThat(res.iceServers().get(1).username()).isEqualTo("1753142400:guest-ab3f");
    }
}
