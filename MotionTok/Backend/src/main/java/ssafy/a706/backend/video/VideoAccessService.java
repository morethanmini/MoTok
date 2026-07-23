package ssafy.a706.backend.video;

import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.signal.RoomMembershipReader;
import ssafy.a706.backend.video.dto.VideoAccessResponse;
import ssafy.a706.backend.video.provider.VideoAccessProvider;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 화상 접속 발급 진입점(-123). 방 존재·멤버 검증을 방식과 무관하게 여기서 한 번만 하고,
 * 발급은 선택된 어댑터(VideoAccessProvider)에 위임한다.
 * 방식 선택: rtc.provider 전역 설정 (잘못된 값·미등록 방식은 기동 시점에 실패).
 */
@Service
public class VideoAccessService {

    private final RoomMembershipReader membershipReader;
    private final Map<VideoAccessMode, VideoAccessProvider> providers;
    private final VideoAccessMode defaultMode;

    public VideoAccessService(RoomMembershipReader membershipReader,
                              List<VideoAccessProvider> providerList,
                              VideoAccessProperties properties) {
        this.membershipReader = membershipReader;
        this.providers = new EnumMap<>(VideoAccessMode.class);
        providerList.forEach(provider -> providers.put(provider.mode(), provider));
        this.defaultMode = VideoAccessMode.fromConfig(properties.provider());
        if (!providers.containsKey(defaultMode)) {
            throw new IllegalStateException("rtc.provider=" + properties.provider() + " 어댑터 미등록");
        }
    }

    /** 통합 엔드포인트용 — 전역 설정(rtc.provider)이 고른 방식으로 발급 */
    public VideoAccessResponse issue(String roomId, AuthPrincipal principal) {
        return issue(roomId, principal, defaultMode);
    }

    /** 방식 고정 발급 — 레거시 video-token은 rtc.provider와 무관하게 LiveKit 유지(프론트 계약 보존) */
    public VideoAccessResponse issue(String roomId, AuthPrincipal principal, VideoAccessMode mode) {
        if (!membershipReader.existsRoom(roomId)) {
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!membershipReader.isMember(roomId, principal.userId())) {
            throw new BusinessException(ErrorCode.SFU_NOT_IN_ROOM);
        }
        return providers.get(mode).issue(roomId, principal);
    }
}
