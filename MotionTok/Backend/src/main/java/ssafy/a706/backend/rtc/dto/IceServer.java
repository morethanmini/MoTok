package ssafy.a706.backend.rtc.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * RTCPeerConnection의 iceServers 항목과 동일한 모양.
 * STUN은 자격 증명이 없으므로 null 필드는 응답에서 생략한다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record IceServer(List<String> urls, String username, String credential) {

    public static IceServer stun(String url) {
        return new IceServer(List.of(url), null, null);
    }
}
