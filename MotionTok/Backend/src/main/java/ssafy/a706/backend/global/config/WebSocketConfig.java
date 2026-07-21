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
 * STOMP WebSocket 설정 — 실시간 통신의 뼈대. 시그널링뿐 아니라 방/채팅/게임 채널 공용 기반이다.
 *
 * <h4>개념: WebSocket과 STOMP의 관계</h4>
 * <ul>
 *   <li><b>WebSocket</b>: HTTP 요청으로 시작해 "Upgrade" 핸드셰이크를 거친 뒤 끊지 않고 유지되는
 *       양방향 통신 연결. 연결 자체는 텍스트/바이트가 오가는 '파이프'일 뿐이라
 *       메시지가 누구에게 가야 하는지, 무슨 용도인지는 정의하지 않는다.</li>
 *   <li><b>STOMP</b>: 그 파이프 위에서 쓰는 단순한 메시징 프로토콜(TCP 위의 HTTP 같은 관계).
 *       프레임(명령 + 헤더 + 바디) 단위로 오가며 주요 명령은
 *       CONNECT(접속)/SUBSCRIBE(구독)/SEND(발행)/DISCONNECT(종료).
 *       프레임의 destination 헤더(경로처럼 생긴 문자열)로 메시지를 라우팅한다.</li>
 * </ul>
 *
 * <h4>{@code @EnableWebSocketMessageBroker}가 부팅 시 조립해 주는 것</h4>
 * 클라이언트와 서버 코드 사이에 메시지 채널 3개와 처리기들이 만들어진다.
 * <pre>
 * clientInboundChannel  : 클라→서버로 들어오는 모든 STOMP 프레임의 통로 (인증 인터셉터가 여기 붙는다)
 * clientOutboundChannel : 서버→클라로 나가는 프레임의 통로
 * brokerChannel         : 서버 내부 코드(SimpMessagingTemplate 등)가 브로커로 보낼 때 쓰는 통로
 * </pre>
 * 들어온 프레임은 destination prefix에 따라 두 갈래로 나뉜다.
 * <pre>
 * /app/...            → SimpAnnotationMethodMessageHandler → @MessageMapping 컨트롤러 (우리 코드 실행)
 * /topic/..., /queue/... → SimpleBroker (구독자 명부 보고 그대로 배달만)
 * </pre>
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    /**
     * 클라이언트가 최초 접속(HTTP 핸드셰이크)하는 URL 등록.
     * 프론트는 {@code ws://localhost:8080/ws}(배포 시 {@code wss://<도메인>/ws})로 연결한다.
     * wss는 앞단 Nginx가 TLS를 종료해 주므로 서버 코드는 동일하다.
     *
     * setAllowedOriginPatterns: WebSocket은 브라우저 동일출처정책(SOP) 적용 대상이 아니라서
     * 스프링이 핸드셰이크의 Origin 헤더를 직접 검사한다. HTTP CORS 설정(SecurityConfig)과 별개라
     * 여기에도 프론트 오리진을 등록해야 한다(같은 프로퍼티 재사용).
     */
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(
                        Arrays.stream(allowedOrigins.split(",")).map(String::trim).toArray(String[]::new));
    }

    /**
     * 메시지 브로커 설정. 브로커 = "구독자 명부를 관리하고, 메시지가 오면 구독자들에게 배달하는 우체국".
     *
     * enableSimpleBroker: 스프링 내장 인메모리 브로커 활성화. 여기 등록한 prefix로 시작하는
     * destination은 컨트롤러를 거치지 않고 브로커가 직접 처리(구독 등록·배달)한다.
     * - /topic : 여러 명이 같이 받는 방송용(방 전체 알림 등 — 이후 방/채팅 채널이 사용할 예정)
     * - /queue : 특정 개인에게 보내는 1:1용(시그널이 사용)
     * 단일 서버 인스턴스 전제(InMemoryRoomRegistry와 동일). 서버를 여러 대로 늘리면
     * 인스턴스 간 전파가 안 되므로 그때 Redis 등 외부 브로커 릴레이로 교체한다.
     *
     * setApplicationDestinationPrefixes: /app으로 시작하는 SEND는 브로커가 아니라
     * {@code @MessageMapping} 컨트롤러로 라우팅된다. 즉 "/app = 서버 로직 실행, 그 외 = 단순 배달".
     *
     * 참고: "/user" prefix는 여기서 설정 안 해도 기본 활성화된다(UserDestinationMessageHandler).
     * 클라가 /user/queue/signal을 구독하면 스프링이 "그 세션 전용 큐"로 바꿔 관리해 주는 개인 우편함 기능.
     * 자세한 동작은 SignalService 주석 참고.
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
    }

    /**
     * 클라→서버 인바운드 채널에 인터셉터 등록. 모든 수신 프레임(CONNECT/SUBSCRIBE/SEND...)이
     * 컨트롤러·브로커에 닿기 전에 이 인터셉터를 먼저 통과한다. 여기서 CONNECT 시 JWT를 검증한다.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }
}
