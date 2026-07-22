package ssafy.a706.backend.rtc;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.rtc.dto.IceServer;
import ssafy.a706.backend.rtc.dto.IceServersResponse;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * ICE 서버 목록 발급(-31). coturn의 TURN REST API 방식(use-auth-secret):
 * username = "만료epoch:참가자ID", credential = Base64(HMAC-SHA1(secret, username)).
 * coturn이 같은 secret으로 재계산해 검증하므로 서버 간 통신·저장소가 필요 없다.
 * HMAC-SHA1은 coturn 규격 고정값(보안 용도가 아니라 인증 토큰 규격).
 */
@Service
@RequiredArgsConstructor
public class IceServerService {

    private static final String HMAC_ALGORITHM = "HmacSHA1";

    private final TurnProperties properties;

    public IceServersResponse issue(String participantId) {
        return issue(participantId, Instant.now().getEpochSecond());
    }

    /** secret 미설정이면 STUN만 내려준다 — coturn 없는 로컬 개발에서도 직접 연결 경로는 동작. */
    IceServersResponse issue(String participantId, long nowEpochSeconds) {
        String hostPort = properties.host() + ":" + properties.port();
        List<IceServer> servers = new ArrayList<>();
        servers.add(IceServer.stun("stun:" + hostPort));

        if (properties.secret() != null && !properties.secret().isBlank()) {
            String username = (nowEpochSeconds + properties.credentialTtlSeconds()) + ":" + participantId;
            servers.add(new IceServer(
                    List.of("turn:" + hostPort + "?transport=udp",
                            "turn:" + hostPort + "?transport=tcp"),
                    username,
                    hmacBase64(username)));
        }
        return new IceServersResponse(servers, properties.credentialTtlSeconds());
    }

    private String hmacBase64(String message) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(properties.secret().getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM));
            return Base64.getEncoder().encodeToString(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("TURN 자격 증명 생성 실패", e);
        }
    }
}
