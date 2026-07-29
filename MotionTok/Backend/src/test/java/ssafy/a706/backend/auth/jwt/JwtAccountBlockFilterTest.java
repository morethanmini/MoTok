package ssafy.a706.backend.auth.jwt;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 제재의 즉시 반영 — Access 토큰은 서명만으로 유효해서(기본 1시간) 제재를 걸어도 이미 발급된
 * 토큰이 그대로 통한다. 필터가 요청마다 Redis를 확인하는 것이 유일한 차단 지점이라
 * "차단된다"·"401이 아니라 403이다"·"기간 정지와 영구 정지가 다른 코드로 나간다"를 함께 고정한다.
 */
class JwtAccountBlockFilterTest {

    private static final String SECRET = "0123456789012345678901234567890123456789";
    private static final long BLOCKED_USER_ID = 42L;

    private final JwtTokenProvider provider =
            new JwtTokenProvider(SECRET, 3_600_000L, 1_209_600_000L, 43_200_000L);
    private final AccountBlockStore accountBlockStore = mock(AccountBlockStore.class);
    private final JwtAuthenticationFilter filter =
            new JwtAuthenticationFilter(provider, accountBlockStore, new ObjectMapper());

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("기간 정지된 회원의 토큰은 만료 전이어도 403으로 끊고 체인을 진행하지 않는다")
    void suspendedMemberIsBlocked() throws Exception {
        given(accountBlockStore.blockOf(BLOCKED_USER_ID)).willReturn(AccountBlock.SUSPENDED);

        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse response = doFilter(
                provider.createAccessToken(BLOCKED_USER_ID, "정지된회원", "USER"), chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("AUTH_ACCOUNT_SUSPENDED");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        // 체인을 탔다면 컨트롤러까지 요청이 갔다는 뜻이다.
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("영구 정지는 다른 코드로 끊는다 — 기간 안내 문구를 띄우면 거짓말이 된다")
    void bannedMemberGetsItsOwnErrorCode() throws Exception {
        given(accountBlockStore.blockOf(BLOCKED_USER_ID)).willReturn(AccountBlock.BANNED);

        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse response = doFilter(
                provider.createAccessToken(BLOCKED_USER_ID, "영구정지회원", "USER"), chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("AUTH_ACCOUNT_BANNED");
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("막히지 않은 회원은 평소대로 인증된다")
    void activeMemberPassesThrough() throws Exception {
        given(accountBlockStore.blockOf(7L)).willReturn(AccountBlock.NONE);

        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse response = doFilter(
                provider.createAccessToken(7L, "일반회원", "USER"), chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        assertThat(chain.getRequest()).isNotNull();
    }

    @Test
    @DisplayName("게스트 토큰은 차단 조회를 하지 않는다 — RDB에 계정이 없어 제재 대상이 아니다")
    void guestTokenSkipsBlockLookup() throws Exception {
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse response = doFilter(
                provider.createGuestToken("guest-abc12345", "게스트1234"), chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(chain.getRequest()).isNotNull();
        verifyNoInteractions(accountBlockStore);
    }

    private MockHttpServletResponse doFilter(String token, MockFilterChain chain) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRequestURI("/api/users/me");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        return response;
    }
}
