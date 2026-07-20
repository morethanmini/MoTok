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
 *
 * <h4>REST 컨트롤러와의 대응 관계</h4>
 * <pre>
 * @RestController + @PostMapping   ↔  @Controller + @MessageMapping
 * @PathVariable                    ↔  @DestinationVariable
 * @RequestBody                     ↔  파라미터의 페이로드(SignalMessage) — 어노테이션 없이 바인딩
 * @RestControllerAdvice(전역)      ↔  @MessageExceptionHandler(컨트롤러 안에 선언)
 * ResponseEntity로 응답            ↔  @SendToUser 등으로 특정 destination에 발행
 * </pre>
 * 주의: {@code @RestController}를 쓰면 안 된다(HTTP 전용). 메시징에서는 {@code @Controller}.
 */
@Controller
@RequiredArgsConstructor
public class SignalController {

    private final SignalService signalService;

    /**
     * 클라이언트가 SEND한 시그널 수신.
     * 실제 destination은 /app/rooms/{roomId}/signal — "/app" prefix는 WebSocketConfig의
     * setApplicationDestinationPrefixes가 떼고 매핑하므로 여기엔 쓰지 않는다.
     *
     * @param roomId    destination 경로에서 추출 (@PathVariable의 메시징판)
     * @param message   프레임 바디(JSON)가 역직렬화된 페이로드
     * @param principal 인터셉터가 CONNECT 때 setUser로 박아둔 인증 주체를 스프링이 주입.
     *                  getName() = participantId (AuthPrincipal.getName 참고) — 발신자 신원은
     *                  메시지 내용이 아니라 여기서 얻는다(위조 불가).
     */
    @MessageMapping("/rooms/{roomId}/signal")
    public void relay(@DestinationVariable String roomId, SignalMessage message, Principal principal) {
        signalService.relay(roomId, message, principal.getName());
    }

    /**
     * 이 컨트롤러의 @MessageMapping 처리 중 던져진 BusinessException 처리.
     * REST의 GlobalExceptionHandler는 HTTP 전용이라 STOMP까지 커버하지 못하므로 별도로 둔다.
     *
     * @SendToUser: 반환값을 "지금 문제를 일으킨 그 사용자"의 개인 destination으로 발행한다.
     * broadcast=false — 같은 유저가 탭 여러 개로 접속해 있어도 문제를 일으킨 세션에만 보낸다.
     * 클라이언트는 /user/queue/errors를 구독해 두면 받는다.
     * 응답 본문은 REST 오류와 동일한 Error 스키마(ErrorResponse)로 통일, path에는 발행하려던
     * destination(simpDestination 헤더)을 넣는다.
     */
    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
