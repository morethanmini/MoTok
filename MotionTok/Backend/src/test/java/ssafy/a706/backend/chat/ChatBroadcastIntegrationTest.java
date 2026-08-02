package ssafy.a706.backend.chat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.test.context.TestPropertySource;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.chat.dto.ChatGameSuggestRequest;
import ssafy.a706.backend.chat.dto.ChatMessageResponse;
import ssafy.a706.backend.chat.dto.ChatSendRequest;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 대기실 채팅 통합 테스트 — 실제 서버를 띄우고 WebSocketStompClient로 검증한다.
 * 전제: MySQL(3307)·Redis(6379) 기동 상태(docker compose up -d).
 * (클라이언트 구성·인증 헤더 규약은 signal/SignalRelayIntegrationTest 참고)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class ChatBroadcastIntegrationTest {

    private static final String SENDER_ID = "guest-chat-sender";
    private static final String RECEIVER_ID = "guest-chat-receiver";
    private static final String OUTSIDER_ID = "guest-chat-outsider";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private LiveRoomRepository liveRoomRepository;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ChatLogRepository chatLogRepository;

    private String roomId;
    private final List<StompSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUpRoom() {
        long now = System.currentTimeMillis();
        roomId = liveRoomRepository.generateUniqueRoomId();
        liveRoomRepository.saveRoom(roomId, Map.of(
                "title", "채팅 테스트",
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
        redisTemplate.delete(List.of("room:" + roomId, "room:" + roomId + ":members", "room:" + roomId + ":chat"));
    }

    @Test
    @DisplayName("참가자가 보낸 채팅이 /topic 구독자 전원(발신자 포함)에게 서버 확정 신원·시각과 함께 브로드캐스트된다")
    void broadcastChatToRoomTopic() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        StompSession receiver = connect(RECEIVER_ID, "받는이");
        String topic = "/topic/rooms/" + roomId + "/chat";
        BlockingQueue<ChatMessageResponse> senderInbox = subscribe(sender, topic, ChatMessageResponse.class);
        BlockingQueue<ChatMessageResponse> receiverInbox = subscribe(receiver, topic, ChatMessageResponse.class);

        sender.send("/app/rooms/" + roomId + "/chat", new ChatSendRequest("안녕하세요!"));

        ChatMessageResponse received = receiverInbox.poll(5, TimeUnit.SECONDS);
        assertThat(received).isNotNull();
        assertThat(received.chatId()).isNotBlank();
        assertThat(received.type()).isEqualTo(ChatMessageResponse.MessageType.TALK);
        assertThat(received.userId()).isEqualTo(SENDER_ID);
        assertThat(received.nickname()).isEqualTo("보낸이");
        assertThat(received.text()).isEqualTo("안녕하세요!");
        assertThat(received.sentAt()).isNotNull();

        ChatMessageResponse echoed = senderInbox.poll(5, TimeUnit.SECONDS);
        assertThat(echoed).isNotNull();
        assertThat(echoed.text()).isEqualTo("안녕하세요!");

        // -131: 브로드캐스트된 chatId로 Redis Stream에서 같은 내용이 조회돼야 한다(신고의 전제).
        ChatLogEntry stored = chatLogRepository.findById(roomId, received.chatId()).orElseThrow();
        assertThat(stored.userId()).isEqualTo(SENDER_ID);
        assertThat(stored.text()).isEqualTo("안녕하세요!");
        assertThat(stored.type()).isEqualTo("TALK");
    }

    @Test
    @DisplayName("방 참가자가 아닌 발신자는 /user/queue/errors로 CHAT_NOT_IN_ROOM을 받는다")
    void rejectSenderNotInRoom() throws Exception {
        StompSession outsider = connect(OUTSIDER_ID, "외부인");
        BlockingQueue<ErrorResponse> errors = subscribe(outsider, "/user/queue/errors", ErrorResponse.class);

        outsider.send("/app/rooms/" + roomId + "/chat", new ChatSendRequest("몰래 한마디"));

        ErrorResponse error = errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo("CHAT_NOT_IN_ROOM");
    }

    @Test
    @DisplayName("빈 메시지는 COMMON_INVALID_INPUT으로 거부되고 브로드캐스트되지 않는다")
    void rejectBlankText() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        BlockingQueue<ChatMessageResponse> inbox =
                subscribe(sender, "/topic/rooms/" + roomId + "/chat", ChatMessageResponse.class);
        BlockingQueue<ErrorResponse> errors = subscribe(sender, "/user/queue/errors", ErrorResponse.class);

        sender.send("/app/rooms/" + roomId + "/chat", new ChatSendRequest("   "));

        ErrorResponse error = errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo("COMMON_INVALID_INPUT");
        assertThat(inbox.poll(1, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("게임 제안이 type=GAME_SUGGEST와 게임 정보·폴백 문구로 브로드캐스트된다")
    void broadcastGameSuggest() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        StompSession receiver = connect(RECEIVER_ID, "받는이");
        BlockingQueue<ChatMessageResponse> receiverInbox =
                subscribe(receiver, "/topic/rooms/" + roomId + "/chat", ChatMessageResponse.class);

        sender.send("/app/rooms/" + roomId + "/game-suggest", new ChatGameSuggestRequest(7L, "몸으로 말해요"));

        ChatMessageResponse received = receiverInbox.poll(5, TimeUnit.SECONDS);
        assertThat(received).isNotNull();
        assertThat(received.chatId()).isNotBlank();
        assertThat(received.type()).isEqualTo(ChatMessageResponse.MessageType.GAME_SUGGEST);
        assertThat(received.userId()).isEqualTo(SENDER_ID);
        assertThat(received.nickname()).isEqualTo("보낸이");
        assertThat(received.gameId()).isEqualTo(7L);
        assertThat(received.gameName()).isEqualTo("몸으로 말해요");
        assertThat(received.text()).isEqualTo("'몸으로 말해요' 게임을 제안했습니다.");
        assertThat(received.sentAt()).isNotNull();
    }

    @Test
    @DisplayName("gameId가 없거나 게임명이 비면 게임 제안은 COMMON_INVALID_INPUT으로 거부된다")
    void rejectInvalidGameSuggest() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        BlockingQueue<ChatMessageResponse> inbox =
                subscribe(sender, "/topic/rooms/" + roomId + "/chat", ChatMessageResponse.class);
        BlockingQueue<ErrorResponse> errors = subscribe(sender, "/user/queue/errors", ErrorResponse.class);

        sender.send("/app/rooms/" + roomId + "/game-suggest", new ChatGameSuggestRequest(null, "몸으로 말해요"));
        ErrorResponse noId = errors.poll(5, TimeUnit.SECONDS);
        assertThat(noId).isNotNull();
        assertThat(noId.code()).isEqualTo("COMMON_INVALID_INPUT");

        sender.send("/app/rooms/" + roomId + "/game-suggest", new ChatGameSuggestRequest(7L, "  "));
        ErrorResponse blankName = errors.poll(5, TimeUnit.SECONDS);
        assertThat(blankName).isNotNull();
        assertThat(blankName.code()).isEqualTo("COMMON_INVALID_INPUT");

        assertThat(inbox.poll(1, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("존재하지 않는 방으로 보내면 ROOM_NOT_FOUND 에러가 간다")
    void rejectUnknownRoom() throws Exception {
        StompSession sender = connect(SENDER_ID, "보낸이");
        BlockingQueue<ErrorResponse> errors = subscribe(sender, "/user/queue/errors", ErrorResponse.class);

        sender.send("/app/rooms/no-such-room/chat", new ChatSendRequest("아무도 없나요"));

        ErrorResponse error = errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).isNotNull();
        assertThat(error.code()).isEqualTo("ROOM_NOT_FOUND");
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
