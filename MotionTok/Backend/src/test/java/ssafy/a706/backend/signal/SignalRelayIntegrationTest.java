package ssafy.a706.backend.signal;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.TestPropertySource;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.dto.SignalMessage;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 시그널 릴레이 통합 테스트 — 실제 서버를 띄우고 WebSocketStompClient 2개로 검증한다.
 * 전제: MySQL(3307)·Redis(6379) 기동 상태(docker compose up -d).
 * ⚠ JWT는 STOMP CONNECT 헤더(3번째 인자)에 넣는다 — 핸드셰이크 HTTP 헤더가 아님.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class SignalRelayIntegrationTest {

    private static final String SENDER_ID = "guest-sender";
    private static final String RECEIVER_ID = "guest-receiver";
    private static final String OUTSIDER_ID = "guest-outsider";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private LiveRoomRepository liveRoomRepository;

    @Autowired
    private StringRedisTemplate redisTemplate;

    private String roomId;
    private final List<StompSession> sessions = new ArrayList<>();

    /** liveroom Redis 스키마로 방을 시딩한다(멤버 필드 키는 게스트 g:{id} 규격). */
    @BeforeEach
    void setUpRoom() {
        long now = System.currentTimeMillis();
        roomId = liveRoomRepository.generateUniqueRoomId();
        liveRoomRepository.saveRoom(roomId, Map.of(
                "title", "시그널 테스트",
                "visibility", "PRIVATE",
                "maxPlayers", "8",
                "status", "WAITING",
                "hostUserId", SENDER_ID,
                "hostDisplayName", "보낸이",
                "createdAt", String.valueOf(now)
        ));
        liveRoomRepository.addMember(roomId, "g:" + SENDER_ID, SENDER_ID, "보낸이", true, now);
        liveRoomRepository.addMember(roomId, "g:" + RECEIVER_ID, RECEIVER_ID, "받는이", true, now);
    }

    @AfterEach
    void tearDown() {
        sessions.forEach(s -> {
            if (s.isConnected()) s.disconnect();
        });
        sessions.clear();
        redisTemplate.delete(List.of("room:" + roomId, "room:" + roomId + ":members"));
    }

    @Test
    @DisplayName("A가 보낸 OFFER가 B의 /user/queue/signal로 전달되고 fromUserId는 서버가 덮어쓴다")
    void relayOfferToTarget() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        StompSession receiver = connect(RECEIVER_ID, "받는이");
        BlockingQueue<SignalMessage> received = subscribe(receiver, "/user/queue/signal", SignalMessage.class);

        // fromUserId를 위조해서 보내도 서버가 인증 주체로 덮어써야 한다
        sender.send("/app/rooms/" + roomId + "/signal",
                new SignalMessage(SignalMessage.SignalType.OFFER, "위조된-발신자", RECEIVER_ID, "v=0 dummy-sdp", null));

        SignalMessage msg = received.poll(5, TimeUnit.SECONDS);
        assertThat(msg).isNotNull();
        assertThat(msg.type()).isEqualTo(SignalMessage.SignalType.OFFER);
        assertThat(msg.fromUserId()).isEqualTo(SENDER_ID);
        assertThat(msg.toUserId()).isEqualTo(RECEIVER_ID);
        assertThat(msg.sdp()).isEqualTo("v=0 dummy-sdp");
    }

    @Test
    @DisplayName("방 참가자가 아닌 발신자는 /user/queue/errors로 SIGNAL_NOT_IN_ROOM을 받는다")
    void rejectSenderNotInRoom() throws Exception {
        StompSession outsider = connect(OUTSIDER_ID, "외부인");
        BlockingQueue<ErrorResponse> errors = subscribe(outsider, "/user/queue/errors", ErrorResponse.class);

        outsider.send("/app/rooms/" + roomId + "/signal",
                new SignalMessage(SignalMessage.SignalType.OFFER, null, RECEIVER_ID, "sdp", null));

        ErrorResponse error = errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo("SIGNAL_NOT_IN_ROOM");
    }

    @Test
    @DisplayName("수신자가 방에 없으면 발신자에게 SIGNAL_TARGET_NOT_FOUND 에러가 간다")
    void rejectTargetNotInRoom() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        BlockingQueue<ErrorResponse> errors = subscribe(sender, "/user/queue/errors", ErrorResponse.class);

        sender.send("/app/rooms/" + roomId + "/signal",
                new SignalMessage(SignalMessage.SignalType.CANDIDATE, null, "guest-nobody", null, null));

        ErrorResponse error = errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo("SIGNAL_TARGET_NOT_FOUND");
    }

    @Test
    @DisplayName("CONNECT를 생략하고 곧장 SEND하면 ERROR 프레임과 함께 거부된다")
    void rejectSendWithoutConnect() throws Exception {
        BlockingQueue<String> frames = new ArrayBlockingQueue<>(4);
        CountDownLatch closed = new CountDownLatch(1);
        // STOMP 클라이언트가 아닌 raw WebSocket으로 프로토콜 순서를 무시하는 클라이언트를 흉내낸다
        WebSocketSession raw = new StandardWebSocketClient().execute(new TextWebSocketHandler() {
            @Override
            protected void handleTextMessage(WebSocketSession session, TextMessage message) {
                frames.add(message.getPayload());
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                closed.countDown();
            }
        }, wsUrl()).get(5, TimeUnit.SECONDS);

        raw.sendMessage(new TextMessage(
                "SEND\ndestination:/app/rooms/" + roomId + "/signal\ncontent-type:application/json\n\n{}\0"));

        String response = frames.poll(5, TimeUnit.SECONDS);
        boolean rejected = (response != null && response.startsWith("ERROR"))
                || closed.await(5, TimeUnit.SECONDS);
        assertThat(rejected).as("ERROR 프레임 수신 또는 연결 종료").isTrue();
        if (raw.isOpen()) raw.close();
    }

    @Test
    @DisplayName("JWT 없이 CONNECT하면 연결이 거부된다")
    void rejectConnectWithoutToken() {
        assertThatThrownBy(() -> newClient()
                .connectAsync(wsUrl(), new WebSocketHttpHeaders(), new StompHeaders(),
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class);
    }

    // ---- helpers ----

    private String wsUrl() {
        return "ws://localhost:" + port + "/ws";
    }

    private WebSocketStompClient newClient() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new JacksonJsonMessageConverter());
        return client;
    }

    private StompSession connect(String guestId, String nickname) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + tokenProvider.createGuestToken(guestId, nickname));
        StompSession session = newClient()
                .connectAsync(wsUrl(), new WebSocketHttpHeaders(), connectHeaders,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
        sessions.add(session);
        return session;
    }

    /** 구독 후 브로커 반영을 잠깐 기다린다(SUBSCRIBE는 응답 프레임이 없어 receipt 없이는 완료 시점을 모름). */
    private <T> BlockingQueue<T> subscribe(StompSession session, String destination, Class<T> payloadType)
            throws InterruptedException {
        BlockingQueue<T> queue = new ArrayBlockingQueue<>(8);
        session.subscribe(destination, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return payloadType;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                queue.add((T) payload);
            }
        });
        Thread.sleep(500);
        return queue;
    }
}
