package ssafy.a706.backend.auth.cookie;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseCookie;

import java.time.Duration;

/**
 * Refresh 토큰을 실어 나르는 쿠키.
 *
 * <p>본문(JSON)이 아니라 쿠키로 내보내는 이유 — 본문으로 주면 클라이언트가 어딘가에 저장해야 하고,
 * 그 저장소는 결국 스크립트가 읽을 수 있는 곳(localStorage 등)이다. XSS 한 방에 14일짜리 재발급 수단이
 * 통째로 넘어간다. {@code HttpOnly} 쿠키는 자바스크립트가 값을 읽지 못하고 브라우저가 알아서 붙여 준다.</p>
 *
 * <ul>
 *   <li><b>Path=/api/auth</b> — 갱신·로그아웃 말고는 이 쿠키가 붙을 이유가 없다. 매 API 요청마다
 *       14일짜리 자격증명을 실어 보내지 않는다.</li>
 *   <li><b>SameSite=Lax</b> — 이 쿠키를 쓰는 건 POST 뿐인데 Lax는 교차 사이트 POST에 쿠키를 붙이지 않는다.
 *       즉 CSRF로는 갱신을 대신 호출할 수 없다.</li>
 *   <li><b>Secure</b> — 운영은 nginx가 TLS를 종료하고 {@code X-Forwarded-Proto: https}를 넘겨 주므로
 *       그걸 보고 켠다. 로컬 dev(http)에서는 꺼진다 — 켜 두면 LAN IP로 붙는 실기기 테스트에서
 *       쿠키가 통째로 무시된다.</li>
 * </ul>
 */
public final class RefreshCookies {

    public static final String NAME = "refreshToken";

    /** 갱신(POST /auth/token/refresh)과 로그아웃만 이 prefix 아래에 있다. */
    private static final String PATH = "/api/auth";

    private RefreshCookies() {
    }

    /**
     * @param persistent 로그인 시 rememberMe. true면 Max-Age를 박은 영구 쿠키,
     *                   false면 세션 쿠키(브라우저를 닫으면 사라진다)
     */
    public static String issue(HttpServletRequest request, String token, Duration ttl, boolean persistent) {
        // 음수 Max-Age는 속성 자체를 생략시킨다 = 세션 쿠키.
        return base(request, token).maxAge(persistent ? ttl : Duration.ofSeconds(-1)).build().toString();
    }

    /** 로그아웃·게스트 전환 — 같은 속성으로 덮어써야 브라우저가 기존 쿠키를 지운다. */
    public static String clear(HttpServletRequest request) {
        return base(request, "").maxAge(0).build().toString();
    }

    private static ResponseCookie.ResponseCookieBuilder base(HttpServletRequest request, String value) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(isSecure(request))
                .sameSite("Lax")
                .path(PATH);
    }

    private static boolean isSecure(HttpServletRequest request) {
        return request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"));
    }
}
