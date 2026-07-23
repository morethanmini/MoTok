package ssafy.a706.backend.auth.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * JWT 발급·검증. subject는 USER PK(회원) 또는 guest-xxxx(게스트)다.
 * Access는 기본 1시간, Refresh는 14일이며 Redis auth:refresh:{userId}에 저장된다.
 *
 * 게스트 토큰만 만료를 따로 둔다(기본 12시간). 게스트에겐 Refresh 토큰이 없어 갱신 수단이 없는데,
 * 1인 게임을 한 시간 넘게 이어가면 토큰이 죽어 플레이 도중 튕기기 때문이다. 권한이 없는 토큰이라
 * 길게 잡아도 위험이 작고, 탭을 닫으면 클라이언트가 sessionStorage와 함께 버린다.
 */
@Component
public class JwtTokenProvider {

    public static final String TYPE_MEMBER = "member";
    public static final String TYPE_GUEST = "guest";
    public static final String TYPE_REFRESH = "refresh";
    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_NAME = "name";

    private final SecretKey key;

    @Getter
    private final long accessExpirationMs;
    @Getter
    private final long refreshExpirationMs;
    @Getter
    private final long guestExpirationMs;

    public JwtTokenProvider(@Value("${jwt.secret}") String secret,
                            @Value("${jwt.access-expiration-ms}") long accessExpirationMs,
                            @Value("${jwt.refresh-expiration-ms}") long refreshExpirationMs,
                            @Value("${jwt.guest-expiration-ms}") long guestExpirationMs) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpirationMs = accessExpirationMs;
        this.refreshExpirationMs = refreshExpirationMs;
        this.guestExpirationMs = guestExpirationMs;
    }

    public String createAccessToken(Long userId, String nickname) {
        return create(String.valueOf(userId), TYPE_MEMBER, nickname, accessExpirationMs);
    }

    /**
     * Refresh 토큰. jti(고유 식별자)를 넣어 매 발급마다 값이 달라지게 한다.
     * jti가 없으면 iat이 초 단위라 같은 초에 발급된 토큰이 완전히 동일해져 회전(rotation)이 무력화된다.
     */
    public String createRefreshToken(Long userId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .id(UUID.randomUUID().toString())
                .claim(CLAIM_TYPE, TYPE_REFRESH)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + refreshExpirationMs))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    public String createGuestToken(String guestId, String nickname) {
        return create(guestId, TYPE_GUEST, nickname, guestExpirationMs);
    }

    private String create(String subject, String type, String name, long ttlMs) {
        Date now = new Date();
        return Jwts.builder()
                .subject(subject)
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_NAME, name)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + ttlMs))
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

    public boolean isRefresh(Claims claims) {
        return TYPE_REFRESH.equals(claims.get(CLAIM_TYPE, String.class));
    }

    public String getName(Claims claims) {
        return claims.get(CLAIM_NAME, String.class);
    }

    /** Access 토큰 만료(초) — TokenResponse.expiresIn 용도. */
    public long accessExpiresInSeconds() {
        return accessExpirationMs / 1000;
    }
}
