package ssafy.a706.backend.auth.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.user.enums.UserRole;
import tools.jackson.databind.ObjectMapper;

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
    private final AccountBlockStore accountBlockStore;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, AccountBlockStore accountBlockStore,
                                   ObjectMapper objectMapper) {
        this.tokenProvider = tokenProvider;
        this.accountBlockStore = accountBlockStore;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER)) {
            try {
                Claims claims = tokenProvider.parse(header.substring(BEARER.length()));
                if (!tokenProvider.isRefresh(claims)) {
                    UsernamePasswordAuthenticationToken authentication = toAuthentication(claims);
                    AccountBlock block = blockOf(authentication);
                    if (block.isBlocked()) {
                        SecurityContextHolder.clearContext();
                        writeBlocked(response, request.getRequestURI(), block);
                        return;
                    }
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch (JwtException | IllegalArgumentException e) {
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * 계정 차단 확인 — Access 토큰은 서명만으로 유효해서(기본 1시간) 제재를 걸어도 이미 발급된
     * 토큰은 그대로 통한다. 즉시 차단하려면 요청마다 상태를 물어보는 수밖에 없다.
     * 기간 정지·영구 정지를 Redis 왕복 한 번으로 함께 보고(AccountBlockStore#blockOf),
     * 회원 토큰일 때만 탄다 — 게스트는 제재 대상이 아니다(RDB에 계정이 없다).
     */
    private AccountBlock blockOf(UsernamePasswordAuthenticationToken authentication) {
        if (authentication.getPrincipal() instanceof MemberPrincipal member) {
            return accountBlockStore.blockOf(member.id());
        }
        return AccountBlock.NONE;
    }

    /**
     * 인증을 비우고 넘기면 anyRequest().authenticated()에 걸려 401(인증 필요)이 나간다 —
     * 토큰은 멀쩡한데 계정이 막힌 상황을 "로그인하세요"로 안내하게 되므로 여기서 403으로 끊는다.
     * (InternalApiKeyFilter가 같은 이유로 직접 응답을 쓴다)
     *
     * <p>기간 정지와 영구 정지를 다른 코드로 내려보내는 이유 — 클라이언트가 "언제 풀리는지"를
     * 안내해야 하는데, 영구 정지에 그 문구를 띄우면 거짓말이 된다.</p>
     */
    private void writeBlocked(HttpServletResponse res, String path, AccountBlock block) throws IOException {
        ErrorCode ec = block == AccountBlock.BANNED ? ErrorCode.ACCOUNT_BANNED : ErrorCode.ACCOUNT_SUSPENDED;
        res.setStatus(ec.getStatus().value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(res.getWriter(), ErrorResponse.of(ec.getCode(), ec.getMessage(), path));
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
