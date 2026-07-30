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
 * Access는 기본 30분, Refresh는 14일이며 해시가 Redis auth:refresh:{userId}에 저장된다.
 *
 * <p>회원 Access/Refresh에는 세션 ID(sid claim)가 실린다 — 로그인마다 새로 발급되어
 * 그 로그인으로 나간 토큰 전부를 하나로 묶는 끈이다. 밀어내기·로그아웃은 이 sid를
 * 폐기 목록(SessionRevocationStore)에 올려 이미 나간 Access까지 그 자리에서 죽인다.
 * Access를 짧게 유지하는 이유는 폐기 목록의 TTL(= Access 수명)이 곧 Redis에 남는 흔적의 수명이기 때문.</p>
 *
 * 게스트 토큰만 만료를 따로 둔다(기본 30분). 게스트에겐 Refresh 토큰이 없어 갱신 수단이 없으므로
 * 이 값이 곧 "로그인 없이 이어서 쓸 수 있는 시간"이다. 짧게 잡은 것은 의도적이다 —
 * 회원 가입·로그인으로 넘어오게 만드는 마찰이고, 익명 토큰이 오래 떠다니지 않게 하는 효과도 있다.
 * 탭을 닫으면 클라이언트가 sessionStorage와 함께 버린다.
 */
@Component
public class JwtTokenProvider {

    public static final String TYPE_MEMBER = "member";
    public static final String TYPE_GUEST = "guest";
    public static final String TYPE_REFRESH = "refresh";
    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_NAME = "name";
    private static final String CLAIM_ROLE = "role";
    private static final String CLAIM_SESSION = "sid";

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

    /**
     * role은 users.role(USER/ADMIN)을 claim으로 실어 관리자 인가(-133)를 DB 재조회 없이 판별한다.
     * 구 토큰(claim 없음)은 getRole()이 null → 필터가 USER로 폴백하므로 하위호환 문제 없음.
     * sessionId는 이 토큰이 속한 로그인 세션(sid) — 폐기 목록 대조 키다. null이면 claim이 빠진다(구 토큰 재현용).
     */
    public String createAccessToken(Long userId, String nickname, String role, String sessionId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim(CLAIM_TYPE, TYPE_MEMBER)
                .claim(CLAIM_NAME, nickname)
                .claim(CLAIM_ROLE, role)
                .claim(CLAIM_SESSION, sessionId)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + accessExpirationMs))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /**
     * Refresh 토큰. jti(고유 식별자)를 넣어 매 발급마다 값이 달라지게 한다.
     * jti가 없으면 iat이 초 단위라 같은 초에 발급된 토큰이 완전히 동일해져 회전(rotation)이 무력화된다.
     * sid는 회전을 거쳐도 유지된다 — 세션의 수명 동안 불변이라 갱신 요청이 어느 세션의 것인지 말해 준다.
     */
    public String createRefreshToken(Long userId, String sessionId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .id(UUID.randomUUID().toString())
                .claim(CLAIM_TYPE, TYPE_REFRESH)
                .claim(CLAIM_SESSION, sessionId)
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

    /** role claim(USER/ADMIN). role claim 도입 이전 토큰은 null. */
    public String getRole(Claims claims) {
        return claims.get(CLAIM_ROLE, String.class);
    }

    /** 로그인 세션 ID(sid claim). 게스트·sid 도입 이전 토큰은 null. */
    public String getSessionId(Claims claims) {
        return claims.get(CLAIM_SESSION, String.class);
    }

    /** Access 토큰 만료(초) — TokenResponse.expiresIn 용도. */
    public long accessExpiresInSeconds() {
        return accessExpirationMs / 1000;
    }
}
