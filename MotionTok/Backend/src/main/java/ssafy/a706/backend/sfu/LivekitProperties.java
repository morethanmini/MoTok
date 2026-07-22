package ssafy.a706.backend.sfu;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * LiveKit(SFU) 연동 설정.
 * - url: 클라이언트가 접속할 LiveKit 주소(응답에 그대로 실어 내려보냄)
 * - apiKey/apiSecret: LiveKit 서버(keys 설정)와 공유하는 토큰 서명 키 —
 *   coturn의 TURN_SECRET과 같은 사상(공유 비밀, 서버 간 통신 없음)
 * - tokenTtl: 접속 토큰 유효시간. 접속 시점에만 쓰이므로 짧게(만료돼도 기존 연결은 유지됨)
 */
@ConfigurationProperties(prefix = "livekit")
public record LivekitProperties(String url, String apiKey, String apiSecret, Duration tokenTtl) {
}
