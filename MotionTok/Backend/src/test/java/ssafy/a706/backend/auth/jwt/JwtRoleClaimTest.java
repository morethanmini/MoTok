package ssafy.a706.backend.auth.jwt;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import tools.jackson.databind.ObjectMapper;

import ssafy.a706.backend.auth.session.SessionRevocationStore;

import java.nio.charset.StandardCharsets;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

/**
 * role claim(-133) — 토큰 발급·파싱과 필터의 권한 매핑.
 * 관리자 인가는 이 claim 하나에 걸려 있으므로 구 토큰(claim 없음) 폴백까지 고정한다.
 */
class JwtRoleClaimTest {

    private static final String SECRET = "0123456789012345678901234567890123456789";

    private final JwtTokenProvider provider =
            new JwtTokenProvider(SECRET, 3_600_000L, 1_209_600_000L, 43_200_000L);
    // 폐기 목록은 이 테스트의 관심사가 아니다 — 빈 목록(reasonOf=null)으로 두면 전부 통과한다.
    /** 제재 조회도 관심사가 아니다 — 아래에서 "막히지 않음"으로 고정한다. */
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);
    private final JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
            provider, mock(SessionRevocationStore.class), accountBlockStore, new ObjectMapper());

    /** 열거형 반환은 mock 기본값이 null이라 명시해야 한다(null이면 필터가 NPE로 죽는다). */
    @BeforeEach
    void notBlocked() {
        given(accountBlockStore.blockOf(anyLong())).willReturn(AccountBlock.NONE);
    }

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void 액세스_토큰에_role_claim이_실린다() {
        String token = provider.createAccessToken(1L, "관리자", "ADMIN", "sid-1");

        assertThat(provider.getRole(provider.parse(token))).isEqualTo("ADMIN");
    }

    @Test
    void ADMIN_토큰은_ROLE_ADMIN과_ROLE_USER를_함께_받는다() throws Exception {
        Authentication auth = authenticate(provider.createAccessToken(1L, "관리자", "ADMIN", "sid-1"));

        assertThat(auth.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_ADMIN", "ROLE_USER");
    }

    @Test
    void USER_토큰은_ROLE_USER만_받는다() throws Exception {
        Authentication auth = authenticate(provider.createAccessToken(2L, "회원", "USER", "sid-2"));

        assertThat(auth.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_USER");
    }

    @Test
    void role_claim이_없는_구_토큰은_USER로_폴백한다() throws Exception {
        // role claim 도입 전 포맷을 재현 — 재로그인 전의 기존 발급분과 동일하다.
        Date now = new Date();
        String legacyToken = Jwts.builder()
                .subject("3")
                .claim("type", "member")
                .claim("name", "구토큰회원")
                .issuedAt(now)
                .expiration(new Date(now.getTime() + 3_600_000L))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)), Jwts.SIG.HS256)
                .compact();

        Authentication auth = authenticate(legacyToken);

        assertThat(auth.getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_USER");
    }

    private Authentication authenticate(String token) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        return auth;
    }
}
