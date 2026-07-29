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
import ssafy.a706.backend.auth.session.SessionRevocationStore;
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
    private final AccountBlockStore accountBlockStore;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider,
                                   SessionRevocationStore sessionRevocationStore,
                                   AccountBlockStore accountBlockStore,
                                   ObjectMapper objectMapper) {
        this.tokenProvider = tokenProvider;
        this.sessionRevocationStore = sessionRevocationStore;
        this.accountBlockStore = accountBlockStore;
        this.objectMapper = objectMapper;
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
                    // 세션 폐기를 먼저 본다 — 폐기된 자격이면 계정 상태를 더 물어볼 이유가 없다.
                    SessionRevocationStore.Reason revoked = revocationOf(claims);
                    if (revoked != null) {
                        request.setAttribute(REVOKED_ATTRIBUTE, revoked);
                    } else {
                        UsernamePasswordAuthenticationToken authentication = toAuthentication(claims);
                        // 살아 있는 세션이어도 계정이 제재됐으면 여기서 끊는다(-105).
                        AccountBlock block = blockOf(authentication);
                        if (block.isBlocked()) {
                            SecurityContextHolder.clearContext();
                            writeBlocked(response, request.getRequestURI(), block);
                            return;
                        }
                        SecurityContextHolder.getContext().setAuthentication(authentication);
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
     * Redis 장애 시에도 통과시킨다(fail-open) — 서명 검증만으로 서비스를 유지하고, 폐기 반영이
     * 최대 액세스 수명만큼 늦는 것을 감수한다. 여기서 막으면 Redis 장애가 곧 전면 장애가 된다.
     */
    private SessionRevocationStore.Reason revocationOf(Claims claims) {
        String sid = tokenProvider.getSessionId(claims);
        if (sid == null) {
            return null;
        }
        try {
            return sessionRevocationStore.reasonOf(sid);
        } catch (RuntimeException e) {
            logger.warn("세션 폐기 목록 조회 실패 — 서명 검증만으로 통과시킨다(fail-open)", e);
            return null;
        }
    }

    /**
     * 계정 차단 확인 — Access 토큰은 서명만으로 유효해서(기본 30분) 제재를 걸어도 이미 발급된
     * 토큰은 그대로 통한다. 즉시 차단하려면 요청마다 상태를 물어보는 수밖에 없다.
     * 기간 정지·영구 정지를 Redis 왕복 한 번으로 함께 보고(AccountBlockStore#blockOf),
     * 회원 토큰일 때만 탄다 — 게스트는 제재 대상이 아니다(RDB에 계정이 없다).
     *
     * <p>세션 폐기 조회와 같은 이유로 fail-open이다 — 여기서 막으면 Redis 장애가 곧 전면 장애가
     * 된다. 감수하는 것은 장애 동안 제재가 최대 액세스 수명만큼 늦게 듣는 것뿐이고, 그 사이에도
     * 새 토큰은 못 받는다(로그인이 users.status와 이 저장소를 함께 본다).</p>
     */
    private AccountBlock blockOf(UsernamePasswordAuthenticationToken authentication) {
        if (!(authentication.getPrincipal() instanceof MemberPrincipal member)) {
            return AccountBlock.NONE;
        }
        try {
            return accountBlockStore.blockOf(member.id());
        } catch (RuntimeException e) {
            logger.warn("계정 제재 조회 실패 — 서명 검증만으로 통과시킨다(fail-open)", e);
            return AccountBlock.NONE;
        }
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
