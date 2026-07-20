package ssafy.a706.backend.global.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import ssafy.a706.backend.auth.stomp.StompAuthChannelInterceptor;

import java.util.Arrays;

/**
 * STOMP WebSocket 설정. 시그널링뿐 아니라 방/채팅/게임 채널 공용 기반이다.
 * - 엔드포인트: /ws (wss는 배포 시 앞단 Nginx TLS 종료로 처리 — 서버 코드 동일)
 * - 클라 발행 prefix: /app, 브로커: /topic(방 단위), /queue(개인)
 * - 인증: CONNECT 프레임에서 StompAuthChannelInterceptor가 JWT 검증
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(
                        Arrays.stream(allowedOrigins.split(",")).map(String::trim).toArray(String[]::new));
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // 인메모리 브로커 — 단일 인스턴스 전제(InMemoryRoomRegistry와 동일). 다중 인스턴스 시 Redis 릴레이로 교체.
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }
}
