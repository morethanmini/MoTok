package ssafy.a706.backend.auth.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtTokenProvider {

    public static final String TYPE_MEMBER = "member";
    public static final String TYPE_GUEST = "guest";
    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_NAME = "name";

    private final SecretKey key;
    private final long expirationMs;

    public JwtTokenProvider(@Value("${jwt.secret}") String secret,
                            @Value("${jwt.access-expiration-ms}") long expirationMs) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    public String createMemberToken(String userId, String nickname) {
        return create(userId, TYPE_MEMBER, nickname);
    }

    public String createGuestToken(String guestId, String nickname) {
        return create(guestId, TYPE_GUEST, nickname);
    }

    private String create(String subject, String type, String name) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);
        return Jwts.builder()
                .subject(subject)
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_NAME, name)
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** 서명/만료 검증 후 Claims 반환. 실패 시 JwtException 계열 발생. */
    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isGuest(Claims claims) {
        return TYPE_GUEST.equals(claims.get(CLAIM_TYPE, String.class));
    }

    public String getName(Claims claims) {
        return claims.get(CLAIM_NAME, String.class);
    }
}
