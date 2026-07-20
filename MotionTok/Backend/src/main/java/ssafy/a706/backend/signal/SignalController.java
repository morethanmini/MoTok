package ssafy.a706.backend.signal;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.signal.dto.SignalMessage;

import java.security.Principal;

/**
 * WebRTC 시그널 STOMP 컨트롤러.
 * 클라 발행: /app/rooms/{roomId}/signal → 대상자 개인 큐: /user/queue/signal
 * 오류: 발신 세션의 /user/queue/errors 로 Error 스키마 그대로 전달.
 */
@Controller
@RequiredArgsConstructor
public class SignalController {

    private final SignalService signalService;

    @MessageMapping("/rooms/{roomId}/signal")
    public void relay(@DestinationVariable String roomId, SignalMessage message, Principal principal) {
        // principal.getName() = participantId (AuthPrincipal.getName 참고)
        signalService.relay(roomId, message, principal.getName());
    }

    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
