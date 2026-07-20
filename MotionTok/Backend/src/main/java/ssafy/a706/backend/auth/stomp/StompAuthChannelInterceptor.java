package ssafy.a706.backend.auth.stomp;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.List;

/**
 * STOMP CONNECT 프레임의 JWT를 검증해 세션에 인증 주체(Principal)를 바인딩하는 인터셉터.
 *
 * <h4>개념: ChannelInterceptor</h4>
 * 메시지 채널판 서블릿 필터. WebSocketConfig에서 clientInboundChannel에 등록했으므로
 * 클라이언트가 보내는 <b>모든</b> STOMP 프레임이 컨트롤러/브로커에 도달하기 전에
 * {@link #preSend}를 먼저 지나간다. 여기서 예외를 던지면 그 프레임은 폐기되고,
 * 스프링이 클라이언트에게 ERROR 프레임을 보낸 뒤 연결을 끊는다 → 사실상 "CONNECT 거부".
 *
 * <h4>왜 HTTP 필터(JwtAuthenticationFilter)로는 안 되나</h4>
 * 브라우저 WebSocket API는 핸드셰이크 HTTP 요청에 커스텀 헤더(Authorization)를 실을 수 없다.
 * 그래서 핸드셰이크는 인증 없이 통과시키고(SecurityConfig의 /ws/** permitAll),
 * 그 다음 단계인 STOMP CONNECT 프레임의 <b>네이티브 헤더</b>(STOMP 프레임 자체의 헤더)에
 * 토큰을 실어 보내게 해서 여기서 검증한다.
 *
 * <h4>인증은 CONNECT 때 한 번만</h4>
 * {@code accessor.setUser(...)}로 세팅한 Authentication은 스프링이 WebSocket 세션에 저장해 두고
 * 이후 같은 연결의 모든 프레임(SUBSCRIBE/SEND)에 자동으로 붙여 준다.
 * 그래서 컨트롤러에서 {@code Principal} 파라미터로 바로 꺼내 쓸 수 있고, 프레임마다 재검증하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String BEARER = "Bearer ";

    private final JwtTokenProvider tokenProvider;

    /**
     * 채널에 메시지가 들어가기 직전 호출된다. CONNECT 프레임일 때만 JWT를 검증한다.
     *
     * StompHeaderAccessor: Message는 불변(immutable)이라 헤더를 읽고 쓰려면 accessor라는
     * 도우미를 통해야 한다. ⚠ {@code StompHeaderAccessor.wrap(message)}를 쓰면 안 됨 —
     * wrap은 '사본' accessor를 만들기 때문에 setUser가 원본 메시지에 반영되지 않아
     * 인증이 조용히 증발한다. 반드시 getAccessor로 원본에 붙은 mutable accessor를 얻을 것.
     */
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            // getFirstNativeHeader: HTTP 헤더가 아니라 STOMP 프레임의 헤더에서 읽는다.
            // (프론트: stompClient.connectHeaders = { Authorization: `Bearer ${token}` })
            accessor.setUser(authenticate(accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION)));
        }
        return message;
    }

    /** Bearer 토큰 파싱·검증. 실패 시 BusinessException → ERROR 프레임 → 연결 종료. */
    private Authentication authenticate(String header) {
        if (header == null || !header.startsWith(BEARER)) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        Claims claims;
        try {
            claims = tokenProvider.parse(header.substring(BEARER.length()));
        } catch (JwtException | IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        // Refresh 토큰은 재발급 전용이므로 실시간 채널 인증 수단으로 인정하지 않는다.
        if (tokenProvider.isRefresh(claims)) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        return toAuthentication(claims);
    }

    /**
     * JWT Claims → 스프링 시큐리티 Authentication 변환. 회원/게스트를 type claim으로 분기한다.
     * 여기서 만든 principal의 getName()(= AuthPrincipal.userId())이 이후
     * /user/queue/* 개인 라우팅의 키가 된다 — SignalService 주석 참고.
     * (JwtAuthenticationFilter.toAuthentication과 동일 분기 — 필터는 이번 범위에서 수정하지 않아 소규모 중복)
     */
    private Authentication toAuthentication(Claims claims) {
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
