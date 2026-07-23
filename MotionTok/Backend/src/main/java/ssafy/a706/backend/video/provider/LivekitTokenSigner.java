package ssafy.a706.backend.video.provider;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import ssafy.a706.backend.auth.principal.AuthPrincipal;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

/**
 * LiveKit 규격 Access Token(HS256 JWT) 서명. OpenVidu 3도 내부 엔진이 LiveKit라
 * 같은 규격을 쓰므로 두 SFU 어댑터가 공유한다(-63/03).
 *
 * 규격: iss=apiKey, sub=identity(participantId), name=표시명,
 * video={room, roomJoin, canPublish, canSubscribe}. 미디어서버가 같은 apiSecret으로
 * 검증하므로 서버 간 통신이 없다 — coturn HMAC 자격 증명(-31)과 동일한 공유 비밀 사상.
 */
final class LivekitTokenSigner {

    private LivekitTokenSigner() {
    }

    static String sign(String apiKey, String apiSecret, Duration ttl, String roomId, AuthPrincipal principal) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(apiKey)
                .subject(principal.userId())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .claim("name", principal.displayName())
                .claim("video", Map.of(
                        "room", roomId,
                        "roomJoin", true,
                        "canPublish", true,
                        "canSubscribe", true))
                .signWith(Keys.hmacShaKeyFor(apiSecret.getBytes(StandardCharsets.UTF_8)), Jwts.SIG.HS256)
                .compact();
    }
}
