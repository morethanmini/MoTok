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
 * STOMP CONNECT 프레임의 Authorization 헤더 JWT를 검증해 세션 Principal을 세팅한다.
 * 검증 실패 시 예외를 던져 CONNECT 자체를 거부한다(ERROR 프레임 후 연결 종료).
 * 이후 프레임은 세션에 바인딩된 Principal이 자동 유지되므로 재검증하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String BEARER = "Bearer ";

    private final JwtTokenProvider tokenProvider;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        // wrap(사본)이 아닌 getAccessor(원본)를 써야 setUser가 실제 메시지에 반영된다.
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            accessor.setUser(authenticate(accessor.getFirstNativeHeader(HttpHeaders.AUTHORIZATION)));
        }
        return message;
    }

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
        if (tokenProvider.isRefresh(claims)) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        return toAuthentication(claims);
    }

    // JwtAuthenticationFilter.toAuthentication과 동일 분기 — 필터는 이번 범위에서 수정하지 않아 소규모 중복.
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
