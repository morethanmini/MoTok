package ssafy.a706.backend.rhythm;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.rhythm.dto.RhythmRequests;

import java.security.Principal;

/**
 * 캐치캐치리듬 STOMP 엔드포인트 — 기존 게임 채널과 완전히 분리된 전용 경로.
 *
 * <pre>
 * 수신 /app/rooms/{roomId}/rhythm/start     (방장)
 *      /app/rooms/{roomId}/rhythm/progress
 *      /app/rooms/{roomId}/rhythm/finish
 * 배포 /topic/rooms/{roomId}/rhythm         (RhythmEventResponse 유니온)
 * 실패 /user/queue/errors                   (발신자에게만)
 * </pre>
 *
 * <p>목적지를 새로 여는 데 설정 변경이 필요 없다 — WebSocketConfig가 {@code /app} 프리픽스와
 * {@code /topic} 브로커만 등록하고, 인증 인터셉터는 목적지별 허용목록 없이 인증 여부만 본다.</p>
 */
@Controller
@RequiredArgsConstructor
public class RhythmController {

    private final RhythmSessionService rhythmSessionService;

    @MessageMapping("/rooms/{roomId}/rhythm/start")
    public void start(@DestinationVariable String roomId, RhythmRequests.Start request,
                      Principal principal) {
        rhythmSessionService.start(roomId, request, extractSender(principal));
    }

    @MessageMapping("/rooms/{roomId}/rhythm/progress")
    public void progress(@DestinationVariable String roomId, RhythmRequests.Progress request,
                         Principal principal) {
        rhythmSessionService.progress(roomId, request, extractSender(principal));
    }

    @MessageMapping("/rooms/{roomId}/rhythm/finish")
    public void finish(@DestinationVariable String roomId, RhythmRequests.Finish request,
                       Principal principal) {
        rhythmSessionService.finish(roomId, request, extractSender(principal));
    }

    /** 방장 강제종료(-164) — 정산 없이 세션을 접고 RHYTHM_ABORTED를 배포한다. */
    @MessageMapping("/rooms/{roomId}/rhythm/abort")
    public void abort(@DestinationVariable String roomId, Principal principal) {
        rhythmSessionService.abort(roomId, extractSender(principal));
    }

    private AuthPrincipal extractSender(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof AuthPrincipal sender) {
            return sender;
        }
        throw RhythmException.unauthorized();
    }

    /**
     * 전용 예외 핸들러 — 공용 ErrorCode enum을 늘리지 않기 위해 이 게임의 오류는 여기서 끝낸다.
     * 회신 프레임 모양(code·message·path)은 다른 채널과 동일하다.
     */
    @MessageExceptionHandler(RhythmException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleRhythm(RhythmException e,
                                      @Header(name = "simpDestination", required = false) String destination) {
        return ErrorResponse.of(e.getCode(), e.getMessage(), destination);
    }
}
