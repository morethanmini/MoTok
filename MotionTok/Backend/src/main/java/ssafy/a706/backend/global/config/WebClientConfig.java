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

    @Bean
    public WebClient oauthWebClient() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, CONNECT_TIMEOUT_MS)
                .responseTimeout(Duration.ofSeconds(RESPONSE_TIMEOUT_SEC))
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(RESPONSE_TIMEOUT_SEC, TimeUnit.SECONDS)));
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }
}
