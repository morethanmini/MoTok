package ssafy.a706.backend.gameguide;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.gameguide.dto.GameGuideEvent;
import ssafy.a706.backend.gameguide.dto.GameGuideRequests;
import ssafy.a706.backend.global.response.ErrorResponse;

import java.security.Principal;

/**
 * 게임 설명 함께 보기 STOMP 엔드포인트 — 리듬과 마찬가지로 전용 경로다.
 *
 * <pre>
 * 수신 /app/rooms/{roomId}/guide       (방장 — 열기·페이지 넘김·닫기를 한 프레임으로)
 *      /app/rooms/{roomId}/guide/sync  (누구나 — 지금 상태를 나에게만 회신)
 * 배포 /topic/rooms/{roomId}/guide     (GameGuideEvent 상태 스냅샷)
 * 회신 /user/queue/game-guide          (sync 응답 — 발신자에게만)
 * 실패 /user/queue/errors              (발신자에게만)
 * </pre>
 *
 * <p>목적지를 새로 여는 데 설정 변경은 필요 없다(RhythmController 주석 참고).</p>
 */
@Controller
@RequiredArgsConstructor
public class GameGuideController {

    private final GameGuideService gameGuideService;

    @MessageMapping("/rooms/{roomId}/guide")
    public void publish(@DestinationVariable String roomId, GameGuideRequests.Publish request,
                        Principal principal) {
        gameGuideService.publish(roomId, request, extractSender(principal));
    }

    /**
     * 지금 상태 조회 — 설명이 떠 있는 중에 들어오거나 새로고침한 사람을 맞춰 준다.
     * 토픽이 아니라 발신자 개인 큐로 회신한다(다른 사람 화면을 건드리지 않는다).
     */
    @MessageMapping("/rooms/{roomId}/guide/sync")
    @SendToUser(destinations = "/queue/game-guide", broadcast = false)
    public GameGuideEvent sync(@DestinationVariable String roomId, Principal principal) {
        return gameGuideService.current(roomId, extractSender(principal));
    }

    private AuthPrincipal extractSender(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof AuthPrincipal sender) {
            return sender;
        }
        throw GameGuideException.unauthorized();
    }

    /** 전용 예외 핸들러 — 회신 프레임 모양(code·message·path)은 다른 채널과 동일하다. */
    @MessageExceptionHandler(GameGuideException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleGuide(GameGuideException e,
                                     @Header(name = "simpDestination", required = false) String destination) {
        return ErrorResponse.of(e.getCode(), e.getMessage(), destination);
    }
}
