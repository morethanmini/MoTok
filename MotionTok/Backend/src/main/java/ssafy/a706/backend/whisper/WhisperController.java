package ssafy.a706.backend.whisper;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.whisper.dto.WhisperMessageResponse;

import java.util.List;

/**
 * 귓속말 이력 조회(-150). 실시간 배달은 STOMP({@link WhisperStompController})가 맡고,
 * 이 REST는 <b>대화창을 열 때 한 번</b> 지난 대화를 채우는 용도다.
 *
 * <p>실시간 채널이 델타만 주기 때문에 초기 스냅샷은 여전히 REST가 필요하다 — 로비 방 목록·친구
 * 목록과 같은 구조다. 주기적으로 부르지 않으므로 폴링 부하와는 무관하다.</p>
 *
 * <p>경로를 {@code /api/friends} 아래에 두면 SecurityConfig의 회원 전용 규칙이 그대로 적용된다.
 * 응답을 ApiResponse로 감싸지 않는 것도 친구 도메인 규약을 따른 것이다.</p>
 */
@RestController
@RequestMapping("/api/friends")
@RequiredArgsConstructor
public class WhisperController {

    private final WhisperService whisperService;

    /** GET /friends/{targetUserId}/whispers — 그 친구와의 최근 대화(시간순). 친구가 아니면 403. */
    @GetMapping("/{targetUserId}/whispers")
    public List<WhisperMessageResponse> history(@AuthenticationPrincipal MemberPrincipal principal,
                                                @PathVariable Long targetUserId) {
        return whisperService.history(principal.id(), targetUserId);
    }
}
