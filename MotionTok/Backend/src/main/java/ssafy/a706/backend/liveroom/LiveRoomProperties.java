package ssafy.a706.backend.liveroom;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yaml의 app.live-room.*
 * inviteLinkBaseUrl은 초대 링크의 기준 주소이며, 실제 링크는 inviteLinkBaseUrl + "?code={inviteCode}" 형태로 만든다.
 */
@ConfigurationProperties(prefix = "app.live-room")
public record LiveRoomProperties(
        String inviteLinkBaseUrl
) {
}
