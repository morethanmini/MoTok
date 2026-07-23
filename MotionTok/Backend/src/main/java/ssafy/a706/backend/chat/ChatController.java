package ssafy.a706.backend.chat;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.chat.dto.ChatSendRequest;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;

import java.security.Principal;

/**
 * 대기실 텍스트 채팅 STOMP 컨트롤러.
 * 발행: /app/rooms/{roomId}/chat → 브로드캐스트: /topic/rooms/{roomId}/chat
 * (STOMP 컨트롤러 구조·에러 처리 패턴은 signal/SignalController 주석 참고)
 */
@Controller
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    @MessageMapping("/rooms/{roomId}/chat")
    public void send(@DestinationVariable String roomId, ChatSendRequest request, Principal principal) {
        chatService.send(roomId, request, extractSender(principal));
    }

    /**
     * 인터셉터가 CONNECT 때 setUser한 Authentication에서 AuthPrincipal을 꺼낸다.
     * 채팅은 닉네임(displayName)까지 필요해서 getName()만으로는 부족하다.
     */
    private AuthPrincipal extractSender(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof AuthPrincipal sender) {
            return sender;
        }
        throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    /** signal과 동일한 STOMP 에러 패턴 — 발신자 /user/queue/errors로 Error 스키마 반환. */
    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
