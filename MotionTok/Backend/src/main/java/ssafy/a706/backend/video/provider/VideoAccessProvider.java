package ssafy.a706.backend.video.provider;

import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.video.VideoAccessMode;
import ssafy.a706.backend.video.dto.VideoAccessResponse;

/**
 * 화상 접속 정보 발급 어댑터(-123). 구현체 = LiveKit / OpenVidu / mesh(자체 시그널링+coturn).
 * 방 존재·멤버 검증은 호출자(VideoAccessService)가 끝낸 뒤 들어온다 —
 * 구현체는 "발급"만 하고 저장소·미디어서버 호출 없이 무상태로 동작한다.
 */
public interface VideoAccessProvider {

    VideoAccessMode mode();

    VideoAccessResponse issue(String roomId, AuthPrincipal principal);
}
