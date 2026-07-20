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
 * 시그널 릴레이 — 같은 방 참가자 간 1:1 전달만 한다(토폴로지 비종속).
 * RoomRegistry를 직접 쓴다(참가자 존재 확인이 registry 쿼리라서).
 */
@Service
@RequiredArgsConstructor
public class SignalService {

    private static final String SIGNAL_QUEUE = "/queue/signal";

    private final RoomRegistry roomRegistry;
    private final SimpMessagingTemplate messagingTemplate;

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
        messagingTemplate.convertAndSendToUser(message.toUserId(), SIGNAL_QUEUE, message.withFrom(senderId));
    }
}
