package ssafy.a706.backend.signal;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.room.RoomRegistry;
import ssafy.a706.backend.room.model.RoomState;
import ssafy.a706.backend.signal.dto.SignalMessage;

/**
 * 시그널 릴레이 — 같은 방 참가자 간 1:1 전달만 한다(토폴로지 비종속: mesh든 SFU든 재사용).
 * RoomRegistry를 직접 쓴다(참가자 존재 확인 쿼리가 registry의 RoomState에만 있음).
 *
 * <h4>개념: SimpMessagingTemplate과 개인 큐(/user/queue/*)</h4>
 * SimpMessagingTemplate = 서버 코드에서 브로커로 메시지를 밀어 넣는 발행용 API
 * (JdbcTemplate·RestTemplate 같은 "템플릿" 계열의 메시징판. Simp = Simple Messaging Protocol).
 *
 * convertAndSendToUser(name, "/queue/signal", payload)의 내부 동작:
 * <pre>
 * 1. destination을 "/user/{name}/queue/signal"로 조립해 brokerChannel로 보낸다.
 * 2. UserDestinationMessageHandler가 {name}으로 접속 중인 세션을 찾아
 *    실제 큐 이름 "/queue/signal-user{sessionId}"로 변환한다.
 *    - 이때 세션을 찾는 키가 Authentication.getName() == AuthPrincipal.getName() == participantId.
 *      (getName이 안 맞으면 에러도 없이 아무한테도 안 간다 — AuthPrincipal에 getName을 정의한 이유)
 * 3. SimpleBroker가 그 큐의 구독자(= 해당 사용자의 그 세션)에게 배달한다.
 *    클라이언트 입장에선 "/user/queue/signal"을 구독해 두면 자기 것만 도착하는 개인 우편함.
 * </pre>
 * 대상이 접속 중이 아니면 조용히 버려진다(예외 없음) — 그래서 전달 전에 방 참가 여부를 검증해
 * 명확한 에러라도 돌려주는 것.
 */
@Service
@RequiredArgsConstructor
public class SignalService {

    private static final String SIGNAL_QUEUE = "/queue/signal";

    private final RoomRegistry roomRegistry;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * 검증 후 시그널을 수신자 개인 큐로 전달한다.
     * 검증 순서: 입력 형식 → 방 존재 → 발신자 참가 → 수신자 참가.
     * 실패는 전부 BusinessException → SignalController의 @MessageExceptionHandler가
     * 발신자 /user/queue/errors로 돌려준다.
     */
    public void relay(String roomId, SignalMessage message, String senderId) {
        if (message.type() == null || message.toUserId() == null || message.toUserId().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        RoomState room = roomRegistry.find(roomId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
        if (!room.hasParticipant(senderId)) {
            throw new BusinessException(ErrorCode.SIGNAL_NOT_IN_ROOM);
        }
        if (!room.hasParticipant(message.toUserId())) {
            throw new BusinessException(ErrorCode.SIGNAL_TARGET_NOT_FOUND);
        }
        // withFrom: fromUserId를 인증 주체로 덮어써 발신자 위조를 차단한다.
        messagingTemplate.convertAndSendToUser(message.toUserId(), SIGNAL_QUEUE, message.withFrom(senderId));
    }
}
