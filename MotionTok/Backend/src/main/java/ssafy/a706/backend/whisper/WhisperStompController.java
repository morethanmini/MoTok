package ssafy.a706.backend.whisper;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.whisper.dto.WhisperSendRequest;

import java.security.Principal;

/**
 * 친구 귓속말 STOMP 컨트롤러(-150).
 * 발행: {@code /app/friends/{targetUserId}/whisper} → 배달: 양쪽 {@code /user/queue/whisper}
 * (구조·에러 처리 패턴은 chat/ChatController와 동일)
 */
@Controller
@RequiredArgsConstructor
public class WhisperStompController {

    private final WhisperService whisperService;

    @MessageMapping("/friends/{targetUserId}/whisper")
    public void send(@DestinationVariable Long targetUserId,
                     WhisperSendRequest request,
                     Principal principal) {
        whisperService.send(requireMember(principal), targetUserId, request);
    }

    /**
     * 게스트는 RDB에 없어 친구를 가질 수 없다 — 귓속말의 전제가 성립하지 않는다.
     * {@code /ws/**}는 permitAll이라 게스트 세션도 여기까지 올 수 있으므로 직접 막는다.
     */
    private MemberPrincipal requireMember(Principal principal) {
        if (principal instanceof Authentication auth
                && auth.getPrincipal() instanceof MemberPrincipal member) {
            return member;
        }
        throw new BusinessException(ErrorCode.FORBIDDEN);
    }

    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
