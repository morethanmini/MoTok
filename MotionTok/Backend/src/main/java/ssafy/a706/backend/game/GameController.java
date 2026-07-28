package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.GameDrawRequest;
import ssafy.a706.backend.game.dto.GameDrawResultRequest;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameProgressRequest;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.dto.PoseSubmitRequest;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;

import java.security.Principal;

/**
 * 게임 세션 STOMP 엔드포인트 (S15P11A706-115).
 * 수신: /app/rooms/{roomId}/game/start(방장) · /progress · /finish
 * 배포: /topic/rooms/{roomId}/game (GameEventResponse 유니온)
 * 실패는 채팅과 동일하게 발신자 /user/queue/errors로 회신한다.
 */
@Controller
@RequiredArgsConstructor
public class GameController {

    private final GameSessionService gameSessionService;

    @MessageMapping("/rooms/{roomId}/game/start")
    public void start(@DestinationVariable String roomId, GameStartRequest request, Principal principal) {
        gameSessionService.start(roomId, request, extractSender(principal));
    }

    /** 게임④ 출제자 포즈 제출(-86) — 서버가 challenge 저장 후 POSE_SET을 방 전체에 배포한다. */
    @MessageMapping("/rooms/{roomId}/game/pose-submit")
    public void poseSubmit(@DestinationVariable String roomId, PoseSubmitRequest request, Principal principal) {
        gameSessionService.submitPose(roomId, request, extractSender(principal));
    }

    @MessageMapping("/rooms/{roomId}/game/progress")
    public void progress(@DestinationVariable String roomId, GameProgressRequest request, Principal principal) {
        gameSessionService.progress(roomId, request, extractSender(principal));
    }

    @MessageMapping("/rooms/{roomId}/game/finish")
    public void finish(@DestinationVariable String roomId, GameFinishRequest request, Principal principal) {
        gameSessionService.finish(roomId, request, extractSender(principal));
    }

    // ── 그림으로 말해요(게임 10, 명세 v0.2.20) ──
    @MessageMapping("/rooms/{roomId}/game/draw")
    public void draw(@DestinationVariable String roomId, GameDrawRequest request, Principal principal) {
        gameSessionService.draw(roomId, request, extractSender(principal));
    }

    @MessageMapping("/rooms/{roomId}/game/draw-result")
    public void drawResult(@DestinationVariable String roomId, GameDrawResultRequest request, Principal principal) {
        gameSessionService.drawResult(roomId, request, extractSender(principal));
    }

    private AuthPrincipal extractSender(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof AuthPrincipal sender) {
            return sender;
        }
        throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
