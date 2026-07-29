package ssafy.a706.backend.presence;

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
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.presence.controller.dto.PresenceBeatRequest;
import ssafy.a706.backend.presence.controller.dto.PresenceQueueMessage;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 친구 프레즌스 실시간 push(-149) 통합 테스트 — 실제 서버를 띄우고 STOMP로 끝까지 확인한다.
 *
 * <p>이 기능은 층이 많아(비트 수신 → 상태 전이 판정 → 이벤트 발행 → 친구 팬아웃 → 개인 큐 라우팅)
 * 중간 한 곳만 어긋나도 <b>에러 없이 조용히 아무 일도 안 일어난다</b>. 특히 개인 큐 라우팅 키가
 * Principal 이름과 한 글자라도 다르면 메시지가 사라지는데 로그조차 남지 않는다.
 * 단위 테스트로는 그 침묵을 잡을 수 없어 실제 왕복으로 검증한다.</p>
 *
 * <p>전제: MySQL(3307)·Redis(6379) 기동 상태(docker compose up -d).
 * 클라이언트 구성 규약은 chat/ChatBroadcastIntegrationTest 참고.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FriendPresencePushIntegrationTest {

    private static final String ROOM_ID = "PRSNC1";

    @LocalServerPort
    private int port;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private FriendshipRepository friendshipRepository;

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private ssafy.a706.backend.presence.repository.PresenceRepository presenceRepository;

    private User mover;      // 상태가 바뀌는 쪽
    private User watcher;    // 그 변화를 받아야 하는 친구
    private Friendship friendship;
    private final List<StompSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUpFriends() {
        mover = userRepository.saveAndFlush(newUser("mover"));
        watcher = userRepository.saveAndFlush(newUser("watcher"));
        Friendship pending = Friendship.request(mover.getId(), watcher.getId());
        pending.accept();
        friendship = friendshipRepository.saveAndFlush(pending);
    }

    @AfterEach
    void tearDown() {
        sessions.forEach(s -> {
            if (s.isConnected()) s.disconnect();
        });
        sessions.clear();
        presenceService.clear(mover.getId());
        presenceService.clear(watcher.getId());
        friendshipRepository.delete(friendship);
        userRepository.deleteAll(List.of(mover, watcher));
    }

    @Test
    @DisplayName("친구가 방에 들어가면 그 변화가 내 개인 큐로 즉시 온다 — 폴링 없이")
    void pushesRoomEnterToFriend() throws Exception {
        StompSession watcherSession = connect(watcher);
        BlockingQueue<PresenceQueueMessage> inbox =
                subscribe(watcherSession, "/user/queue/presence", PresenceQueueMessage.class);
        StompSession moverSession = connect(mover);
        drainConnectNoise(inbox);

        // 방에 들어간 탭이 방 ID를 실어 비트를 보낸다.
        moverSession.send("/app/presence/heartbeat", new PresenceBeatRequest(ROOM_ID, 20L));

        PresenceQueueMessage received = pollFriendEvent(inbox);
        assertThat(received).as("친구 상태 변화가 도착해야 한다").isNotNull();
        assertThat(received.userId()).isEqualTo(mover.getId());
        assertThat(received.presence()).isEqualTo("IN_ROOM");
        assertThat(received.currentRoomId()).isEqualTo(ROOM_ID);
    }

    @Test
    @DisplayName("친구가 로그아웃하면 오프라인 전이가 내 개인 큐로 온다")
    void pushesLogoutToFriend() throws Exception {
        StompSession watcherSession = connect(watcher);
        BlockingQueue<PresenceQueueMessage> inbox =
                subscribe(watcherSession, "/user/queue/presence", PresenceQueueMessage.class);
        StompSession moverSession = connect(mover);
        moverSession.send("/app/presence/heartbeat", new PresenceBeatRequest(null, 20L));
        drainConnectNoise(inbox);

        presenceService.clear(mover.getId()); // 로그아웃이 하는 일

        PresenceQueueMessage received = pollFriendEvent(inbox);
        assertThat(received).as("오프라인 전이가 도착해야 한다").isNotNull();
        assertThat(received.userId()).isEqualTo(mover.getId());
        assertThat(received.presence()).isEqualTo("OFFLINE");
    }

    @Test
    @DisplayName("프레즌스가 TTL로 이미 사라진 뒤 로그아웃해도 오프라인 전이를 알린다")
    void pushesLogoutEvenAfterPresenceExpired() throws Exception {
        StompSession watcherSession = connect(watcher);
        BlockingQueue<PresenceQueueMessage> inbox =
                subscribe(watcherSession, "/user/queue/presence", PresenceQueueMessage.class);
        connect(mover);
        drainConnectNoise(inbox);

        // 절전·백그라운드 탭·망 단절이면 비트가 끊겨 presence 키가 TTL로 조용히 사라진다.
        // 이 소멸에는 훅이 없어 이벤트가 하나도 나가지 않으므로, 친구 목록에는 접속 중으로 남아 있다.
        presenceRepository.delete(mover.getId());
        inbox.clear();

        presenceService.clear(mover.getId()); // 그 상태에서 로그아웃을 누른다

        PresenceQueueMessage received = pollFriendEvent(inbox);
        assertThat(received)
                .as("직전 상태가 '오프라인'이라도 로그아웃은 알려야 한다 — 안 그러면 목록에 영원히 박제된다")
                .isNotNull();
        assertThat(received.presence()).isEqualTo("OFFLINE");
    }

    @Test
    @DisplayName("방 안에서 소켓이 재연결돼도 '방에서 나갔다'로 오인하지 않는다")
    void reconnectKeepsRoom() throws Exception {
        StompSession watcherSession = connect(watcher);
        BlockingQueue<PresenceQueueMessage> inbox =
                subscribe(watcherSession, "/user/queue/presence", PresenceQueueMessage.class);
        StompSession first = connect(mover);
        first.send("/app/presence/heartbeat", new PresenceBeatRequest(ROOM_ID, 20L));
        Thread.sleep(700);
        first.disconnect();
        inbox.clear();

        // 같은 사용자가 방에 있는 채로 다시 붙는다(절전 복귀·프록시 유휴 타임아웃).
        connect(mover);

        PresenceQueueMessage received = pollFriendEvent(inbox);
        if (received != null) {
            assertThat(received.presence())
                    .as("재연결이 IN_ROOM을 ONLINE으로 되돌려서는 안 된다")
                    .isNotEqualTo("ONLINE");
        }
    }

    @Test
    @DisplayName("상태가 그대로인 비트는 친구에게 전달하지 않는다 — 전이만 흘린다")
    void doesNotPushUnchangedBeat() throws Exception {
        StompSession watcherSession = connect(watcher);
        BlockingQueue<PresenceQueueMessage> inbox =
                subscribe(watcherSession, "/user/queue/presence", PresenceQueueMessage.class);
        StompSession moverSession = connect(mover);
        // 연결 자체가 오프라인→온라인 전이라 이벤트를 하나 만든다. 그건 이 테스트의 관심사가 아니다.
        drainConnectNoise(inbox);
        moverSession.send("/app/presence/heartbeat", new PresenceBeatRequest(ROOM_ID, 20L));
        assertThat(pollFriendEvent(inbox)).as("방 입장 전이는 와야 한다").isNotNull();

        // 같은 방에서 한 번 더 — 바뀐 게 없으므로 아무것도 오면 안 된다.
        moverSession.send("/app/presence/heartbeat", new PresenceBeatRequest(ROOM_ID, 20L));

        assertThat(pollFriendEvent(inbox)).as("변화 없는 비트는 전파되지 않아야 한다").isNull();
    }

    /** 연결 직후의 BEAT(간격 정정)와 접속 전이는 이 테스트의 관심사가 아니다. */
    private void drainConnectNoise(BlockingQueue<PresenceQueueMessage> inbox) throws InterruptedException {
        Thread.sleep(700);
        inbox.clear();
    }

    /** BEAT 프레임을 건너뛰고 FRIEND 이벤트만 집는다. */
    private PresenceQueueMessage pollFriendEvent(BlockingQueue<PresenceQueueMessage> inbox)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            PresenceQueueMessage message = inbox.poll(500, TimeUnit.MILLISECONDS);
            if (message == null) {
                continue;
            }
            if ("FRIEND".equals(message.type())) {
                return message;
            }
        }
        return null;
    }

    private User newUser(String tag) {
        String unique = tag + "-" + UUID.randomUUID().toString().substring(0, 8);
        return User.builder()
                .email(unique + "@presence.test")
                .nickname(unique)
                .passwordHash("{noop}test")
                .build();
    }

    private StompSession connect(User user) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer "
                + tokenProvider.createAccessToken(user.getId(), user.getNickname(), "USER", "sid-it-" + user.getId()));
        StompSession session = newClient()
                .connectAsync(wsUrl(), new WebSocketHttpHeaders(), connectHeaders,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
        sessions.add(session);
        return session;
    }

    private <T> BlockingQueue<T> subscribe(StompSession session, String destination, Class<T> payloadType)
            throws InterruptedException {
        BlockingQueue<T> queue = new ArrayBlockingQueue<>(16);
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

    private String wsUrl() {
        return "ws://localhost:" + port + "/ws";
    }

    private WebSocketStompClient newClient() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new JacksonJsonMessageConverter());
        return client;
    }
}
