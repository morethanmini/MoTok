package ssafy.a706.backend.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * OpenVidu(SFU) 연동 설정(-123). OpenVidu 3는 내부 엔진이 LiveKit라 필드 구성이
 * LivekitProperties와 동일하다 — 배포 대상(url)과 키만 별도로 관리한다.
 * 로컬 기본 포트가 LiveKit과 같은 이유: OpenVidu 로컬 배포도 LiveKit 호환 API를 7880에 연다
 * (로컬에선 미디어서버를 한 번에 하나만 띄우는 전제).
 */
@ConfigurationProperties(prefix = "openvidu")
public record OpenViduProperties(String url, String apiKey, String apiSecret, Duration tokenTtl) {
}
