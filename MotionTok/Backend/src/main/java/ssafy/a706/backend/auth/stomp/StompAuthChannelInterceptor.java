package ssafy.a706.backend.auth.stomp;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.auth.session.SessionRevocationStore;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
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
@Slf4j
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String BEARER = "Bearer ";

    /** 로비 채널 — REST 방 목록(hasRole USER)과 같은 데이터를 실어 나르므로 같은 경계를 적용한다. */
    private static final String MEMBER_ONLY_PREFIX = "/topic/lobby";

    private final JwtTokenProvider tokenProvider;
    private final SessionRevocationStore sessionRevocationStore;
    private final AccountBlockStore accountBlockStore;

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
        if (accessor == null) {
            return message;
        }
        StompCommand command = accessor.getCommand();
        if (StompCommand.CONNECT.equals(command)) {
            // getFirstNativeHeader: HTTP 헤더가 아니라 STOMP 프레임의 헤더에서 읽는다.
            // (프론트: stompClient.connectHeaders = { Authorization: `Bearer ${token}` })
            accessor.setUser(authenticate(accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION)));
        } else if (StompCommand.SUBSCRIBE.equals(command) || StompCommand.SEND.equals(command)) {
            // 스프링은 "CONNECT 먼저"라는 프레임 순서를 강제하지 않는다. 악의적 클라이언트가
            // CONNECT를 생략하고 곧장 구독/발행하면 인증 없이 브로커까지 닿을 수 있으므로
            // (특히 /topic 채널 도청·스팸) 세션에 인증이 없는 SUBSCRIBE/SEND는 여기서 차단한다.
            // 하트비트(command == null)·DISCONNECT는 해당 없음.
            if (accessor.getUser() == null) {
                throw new BusinessException(ErrorCode.UNAUTHORIZED);
            }
            requireMemberForRestrictedDestination(accessor);
        }
        return message;
    }

    /**
     * 회원 전용 destination에 게스트가 붙는 것을 막는다(-142).
     *
     * <p>HTTP에서는 SecurityConfig가 {@code /api/v1/live-rooms}·{@code /api/friends}를 ROLE_USER로
     * 막고 있지만 {@code /ws/**}는 permitAll이고 게스트도 CONNECT에 성공한다. 연결이 게임룸
     * 안에서만 열리던 시절엔 게스트가 닿을 수 있는 토픽이 자기 1인방뿐이라 드러나지 않았는데,
     * 로그인 즉시 전원 상시 연결로 바뀌면 <b>같은 데이터의 접근 경계가 프로토콜마다 달라진다.</b>
     * REST로 막아 둔 것을 STOMP로 우회할 수 있으면 막았다고 할 수 없다.</p>
     *
     * <p>{@code /user/**}는 검사하지 않는다 — 스프링이 구독을 세션 전용 큐로 바꿔 주므로
     * 남의 큐를 구독하는 것 자체가 불가능하다.</p>
     */
    private void requireMemberForRestrictedDestination(StompHeaderAccessor accessor) {
        String destination = accessor.getDestination();
        if (destination == null || !destination.startsWith(MEMBER_ONLY_PREFIX)) {
            return;
        }
        if (accessor.getUser() instanceof Authentication auth
                && auth.getPrincipal() instanceof AuthPrincipal principal
                && !principal.isGuest()) {
            return;
        }
        throw new BusinessException(ErrorCode.FORBIDDEN);
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
        // 폐기된 세션이면 계정 상태를 더 물어볼 이유가 없다 — HTTP 필터와 같은 순서다.
        rejectRevokedSession(claims);

        Authentication authentication = toAuthentication(claims);
        // 계정 차단 확인 — HTTP는 JwtAuthenticationFilter가 막지만 WebSocket 핸드셰이크는 서블릿
        // 필터를 타지 않아 여기서 따로 끊지 않으면 제재된 사용자가 실시간 채널로 그대로 들어온다.
        if (authentication.getPrincipal() instanceof MemberPrincipal member) {
            AccountBlock block = accountBlockStore.blockOf(member.id());
            if (block.isBlocked()) {
                throw new BusinessException(block == AccountBlock.BANNED
                        ? ErrorCode.ACCOUNT_BANNED
                        : ErrorCode.ACCOUNT_SUSPENDED);
            }
        }
        return authentication;
    }

    /**
     * 폐기된 세션(sid)의 토큰으로는 CONNECT도 못 한다 — 밀어내기가 소켓을 닫아도(SingleSessionPolicy)
     * 옛 액세스 토큰이 살아 있으면 재연결로 실시간을 되살릴 수 있기 때문이다. HTTP 필터와 같은 경계·같은
     * fail-open(레디스 장애 시 서명 검증만으로 통과) 정책을 적용한다.
     */
    private void rejectRevokedSession(Claims claims) {
        String sid = tokenProvider.getSessionId(claims);
        if (sid == null) {
            return; // 게스트·sid 도입 이전 토큰
        }
        SessionRevocationStore.Reason reason;
        try {
            reason = sessionRevocationStore.reasonOf(sid);
        } catch (RuntimeException e) {
            log.warn("세션 폐기 목록 조회 실패 — STOMP CONNECT를 서명 검증만으로 통과시킨다(fail-open)", e);
            return;
        }
        if (reason == SessionRevocationStore.Reason.DISPLACED) {
            throw new BusinessException(ErrorCode.SESSION_DISPLACED);
        }
        if (reason != null) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
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
