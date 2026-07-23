package ssafy.a706.backend.video.dto;

import java.util.List;

/** IceServersResponse (API 명세 -31): ttl = 자격 증명 만료(초) */
public record IceServersResponse(List<IceServer> iceServers, long ttl) {
}
