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

import java.io.IOException;
import java.util.List;

/**
 * Authorization: Bearer 헤더의 JWT를 검증해 SecurityContext에 인증을 설정한다.
 * 게스트 토큰(type=guest)은 DB 조회 없이 GuestPrincipal로 인증한다.
 * Refresh 토큰(type=refresh)은 API 인증 수단이 아니므로 여기서 거부한다.
 * (SecurityConfig에서 직접 생성해 등록하므로 @Component로 두지 않는다 — 서블릿 이중 등록 방지)
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final JwtTokenProvider tokenProvider;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER)) {
            try {
                Claims claims = tokenProvider.parse(header.substring(BEARER.length()));
                if (!tokenProvider.isRefresh(claims)) {
                    SecurityContextHolder.getContext().setAuthentication(toAuthentication(claims));
                }
            } catch (JwtException | IllegalArgumentException e) {
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
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
                new MemberPrincipal(Long.valueOf(subject), name), null,
                List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }
}
