package ssafy.a706.backend.auth.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.user.enums.UserRole;

import java.io.IOException;
import java.util.List;

/**
 * Authorization: Bearer 헤더의 JWT를 검증해 SecurityContext에 인증을 설정한다.
 * 게스트 토큰(type=guest)은 DB 조회 없이 GuestPrincipal로 인증한다.
 * Refresh 토큰(type=refresh)은 API 인증 수단이 아니므로 여기서 거부한다.
 * (SecurityConfig에서 직접 생성해 등록하므로 @Component로 두지 않는다 — 서블릿 이중 등록 방지)
 *
 * <p>서명이 유효해도 세션(sid)이 폐기 목록에 있으면 인증하지 않는다 — 밀어내기·로그아웃이
 * 이미 나간 액세스 토큰을 그 자리에서 죽이는 지점이다. 사유는 요청 attribute로만 남긴다.
 * 여기서 응답을 직접 쓰지 않는 이유 — permitAll 경로(로그인 등)는 폐기된 토큰을 들고 와도
 * 비인증으로 통과해야 하고, 보호 경로는 어차피 entry point가 401을 쓰므로 그쪽에서
 * attribute를 보고 전용 코드(AUTH_SESSION_DISPLACED)로 갈라 준다(SecurityConfig).</p>
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    /** 폐기된 sid의 토큰이었음을 entry point에 전하는 요청 attribute. 값은 {@link SessionRevocationStore.Reason}. */
    private static final String REVOKED_ATTRIBUTE = JwtAuthenticationFilter.class.getName() + ".revoked";

    private static final String BEARER = "Bearer ";

    private final JwtTokenProvider tokenProvider;
    private final SessionRevocationStore sessionRevocationStore;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, SessionRevocationStore sessionRevocationStore) {
        this.tokenProvider = tokenProvider;
        this.sessionRevocationStore = sessionRevocationStore;
    }

    /** 이 요청의 401이 "다른 곳 로그인으로 밀려남" 때문인가 — entry point가 오류 코드를 고를 때 쓴다. */
    public static boolean wasDisplaced(HttpServletRequest request) {
        return request.getAttribute(REVOKED_ATTRIBUTE) == SessionRevocationStore.Reason.DISPLACED;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER)) {
            try {
                Claims claims = tokenProvider.parse(header.substring(BEARER.length()));
                if (!tokenProvider.isRefresh(claims)) {
                    SessionRevocationStore.Reason revoked = revocationOf(claims);
                    if (revoked != null) {
                        request.setAttribute(REVOKED_ATTRIBUTE, revoked);
                    } else {
                        SecurityContextHolder.getContext().setAuthentication(toAuthentication(claims));
                    }
                }
            } catch (JwtException | IllegalArgumentException e) {
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * 세션 폐기 여부. sid가 없는 토큰(게스트·도입 이전 발급분)은 대조할 열쇠가 없어 통과한다.
     * Redis 장애 시의 fail-open은 스토어가 책임진다({@link SessionRevocationStore#reasonOf}) —
     * 호출자마다 try/catch를 들면 한 곳만 빠뜨려도 그 경로만 정책이 갈린다.
     */
    private SessionRevocationStore.Reason revocationOf(Claims claims) {
        String sid = tokenProvider.getSessionId(claims);
        return sid == null ? null : sessionRevocationStore.reasonOf(sid);
    }

    private UsernamePasswordAuthenticationToken toAuthentication(Claims claims) {
        String subject = claims.getSubject();
        String name = tokenProvider.getName(claims);
        if (tokenProvider.isGuest(claims)) {
            return new UsernamePasswordAuthenticationToken(
                    new GuestPrincipal(subject, name), null,
                    List.of(new SimpleGrantedAuthority("ROLE_GUEST")));
        }
        return new UsernamePasswordAuthenticationToken(
                new MemberPrincipal(Long.valueOf(subject), name), null, memberAuthorities(claims));
    }

    /**
     * role claim이 ADMIN이면 ROLE_ADMIN + ROLE_USER를 함께 부여한다(관리자도 일반 회원 기능 사용).
     * claim이 없거나(구 토큰) USER면 기존과 동일하게 ROLE_USER만 — 하위호환 유지.
     */
    private List<SimpleGrantedAuthority> memberAuthorities(Claims claims) {
        if (UserRole.ADMIN.name().equals(tokenProvider.getRole(claims))) {
            return List.of(new SimpleGrantedAuthority("ROLE_ADMIN"), new SimpleGrantedAuthority("ROLE_USER"));
        }
        return List.of(new SimpleGrantedAuthority("ROLE_USER"));
    }
}
