package ssafy.a706.backend.video.dto;

/**
 * SFU 접속 정보. 프론트는 livekit-client로 {@code Room.connect(url, token)}에 그대로 투입한다.
 * expiresIn은 토큰 유효시간(초) — 만료 전에 접속을 시작해야 한다(재입장 시 재발급).
 */
public record SfuTokenResponse(String url, String token, long expiresIn) {
}
