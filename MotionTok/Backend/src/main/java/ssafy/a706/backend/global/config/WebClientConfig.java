package ssafy.a706.backend.global.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * 외부 HTTP 호출용 WebClient. 현재는 소셜 로그인 provider(토큰·userinfo) 호출에 사용한다.
 * MVC(블로킹)에서 block()으로 동기 호출하므로, 응답이 없으면 Tomcat 스레드가 무한 점유된다.
 * 이를 막기 위해 connect/response/read 타임아웃을 반드시 건다(공개 엔드포인트라 스레드풀 고갈 방지).
 * 타임아웃은 SOCIAL_LOGIN_FAILED로 매핑된다(AbstractOauthClient.exchange의 try/catch).
 */
@Configuration
public class WebClientConfig {

    private static final int CONNECT_TIMEOUT_MS = 5_000;
    private static final int RESPONSE_TIMEOUT_SEC = 5;
    /** 비전 모델 추론은 수 초~수십 초 걸린다 — 게임 채점 유예(60s)보다 짧게 잡아 먼저 실패하게 한다. */
    private static final int JUDGE_TIMEOUT_SEC = 45;
    private static final int DEFAULT_BUFFER_BYTES = 256 * 1024;
    /** 도화지 PNG(base64)를 실어 보내므로 기본 256KB로는 부족하다. */
    private static final int JUDGE_BUFFER_BYTES = 8 * 1024 * 1024;

    @Bean
    public WebClient oauthWebClient() {
        return build(RESPONSE_TIMEOUT_SEC, DEFAULT_BUFFER_BYTES);
    }

    /**
     * 그림으로 말해요 AI 채점(GMS 비전 모델) 전용.
     * 이미지를 보고 추론하는 호출이라 소셜 로그인보다 훨씬 오래 걸려 타임아웃을 길게 잡고,
     * 그림 PNG(base64)를 실어 보내므로 요청/응답 버퍼 상한도 올린다.
     */
    @Bean
    public WebClient gmsWebClient() {
        return build(JUDGE_TIMEOUT_SEC, JUDGE_BUFFER_BYTES);
    }

    /** SFU 관리 API(RemoveParticipant 등) — 비동기 best-effort 호출이라 짧은 타임아웃이면 족하다. */
    @Bean
    public WebClient sfuAdminWebClient() {
        return build(RESPONSE_TIMEOUT_SEC, DEFAULT_BUFFER_BYTES);
    }

    private WebClient build(int timeoutSec, int bufferBytes) {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, CONNECT_TIMEOUT_MS)
                .responseTimeout(Duration.ofSeconds(timeoutSec))
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(timeoutSec, TimeUnit.SECONDS)));
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(c -> c.defaultCodecs().maxInMemorySize(bufferBytes))
                .build();
    }
}
