package ssafy.a706.backend.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * RTC 접속 방식 전역 스위치(-123). 부하테스트(-120)에서 env(RTC_PROVIDER)만 바꿔
 * 재기동하면 3방식(livekit/openvidu/mesh)이 통째로 전환된다.
 * 방 단위 토폴로지 오버라이드(-63 하이브리드)는 후속 확장.
 */
@ConfigurationProperties(prefix = "rtc")
public record VideoAccessProperties(String provider) {
}
