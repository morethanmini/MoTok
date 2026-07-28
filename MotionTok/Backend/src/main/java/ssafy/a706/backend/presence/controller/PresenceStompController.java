package ssafy.a706.backend.presence.controller;

import lombok.RequiredArgsConstructor;
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
import ssafy.a706.backend.presence.controller.dto.PresenceBeatRequest;
import ssafy.a706.backend.presence.controller.dto.PresenceQueueMessage;
import ssafy.a706.backend.presence.service.PresenceService;

import java.security.Principal;

/**
 * 접속 상태 하트비트 — 전역 STOMP 연결의 SEND 프레임으로 받는다(-143).
 * 발행: {@code /app/presence/heartbeat} → 필요할 때만 응답: {@code /user/queue/presence}
 *
 * <h4>왜 HTTP를 걷어냈나</h4>
 * 종전 {@code POST /api/presence/heartbeat}는 20초마다 <b>요청 한 건의 풀코스</b>를 치렀다 —
 * TCP/TLS 재사용은 되더라도 요청·응답 헤더, JWT 서명 검증, 시큐리티 필터 체인, 디스패처서블릿
 * 매핑, 응답 직렬화가 매번 붙는다. 실제로 서버가 하는 일은 Redis에 필드 두 개를 쓰고 TTL을
 * 미는 것뿐인데 그 앞뒤가 훨씬 무거웠다. 같은 일을 이미 열려 있는 소켓 위의 STOMP SEND 프레임으로
 * 하면 인증은 CONNECT 때 한 번 끝났고 라우팅은 destination 문자열 매칭뿐이라 부대비용이 사라진다.
 *
 * <h4>그래도 주기 비트를 남긴 이유</h4>
 * 연결만으로 온라인을 판정하고 비트를 없애면 두 가지가 함께 깨진다.
 * ① {@code presence:{userId}}의 TTL(60s)을 아무도 갱신하지 않아 연결이 살아 있어도 오프라인이 되고,
 * ② 총 접속시간(-141)이 "직전 비트와의 간격"을 델타로 쌓는데 그 간격이 사라진다
 * (델타는 TTL로 clamp되므로 2시간짜리 세션도 60초로 잘린다).
 * 비트의 <b>의미</b>를 그대로 두고 <b>전송 수단만</b> 바꾼 이유가 이것이다.
 */
@Controller
@RequiredArgsConstructor
public class PresenceStompController {

    private final PresenceService presenceService;

    /**
     * 주기 하트비트. 응답은 클라이언트가 쓰는 간격이 서버와 어긋날 때만 나간다 —
     * 매번 ack를 돌려주면 프레임 수가 두 배가 되고, 정상 상태에서 그 값은 늘 같은 숫자다.
     * (null 반환이면 스프링이 아무것도 보내지 않는다.)
     */
    @MessageMapping("/presence/heartbeat")
    @SendToUser(destinations = "/queue/presence", broadcast = false)
    public PresenceQueueMessage heartbeat(PresenceBeatRequest request,
                                          @Header("simpSessionId") String sessionId,
                                          Principal principal) {
        Long userId = memberIdOf(principal);
        String roomId = request == null ? null : request.roomId();
        // 방은 탭마다 다르다 — 세션 ID를 함께 넘겨야 "어느 탭이 어느 방에 있는지"를 원장이 구분한다.
        long interval = presenceService.heartbeat(userId, sessionId, roomId);
        if (request != null && request.knows(interval)) {
            return null;
        }
        return PresenceQueueMessage.beat(interval);
    }

    /**
     * 게스트는 프레즌스 대상이 아니다 — RDB에 없어 친구를 가질 수 없고, presence 키가 회원 PK
     * 기반이라 {@code guest-xxxx}는 담을 자리도 없다. HTTP 시절 SecurityConfig가 하던 차단을
     * {@code /ws/**}(permitAll)에서는 여기서 대신한다.
     */
    private Long memberIdOf(Principal principal) {
        if (principal instanceof Authentication auth
                && auth.getPrincipal() instanceof MemberPrincipal member) {
            return member.id();
        }
        throw new BusinessException(ErrorCode.FORBIDDEN);
    }

    /** 채팅·시그널과 동일한 STOMP 에러 패턴 — 발신자 /user/queue/errors로 Error 스키마 반환. */
    @MessageExceptionHandler(BusinessException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBusiness(BusinessException e,
                                        @Header(name = "simpDestination", required = false) String destination) {
        ErrorCode ec = e.getErrorCode();
        return ErrorResponse.of(ec.getCode(), e.getMessage(), destination);
    }
}
