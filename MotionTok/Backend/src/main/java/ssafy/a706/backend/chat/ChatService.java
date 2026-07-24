package ssafy.a706.backend.chat;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.chat.dto.ChatGameSuggestRequest;
import ssafy.a706.backend.chat.dto.ChatMessageResponse;
import ssafy.a706.backend.chat.dto.ChatSendRequest;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.time.Instant;

/**
 * 대기실 텍스트 채팅 — 검증 후 Redis Stream에 저장하고 방 전체 토픽으로 브로드캐스트한다.
 * 저장(-131)은 채팅 신고(-132)의 전제 조건이다: Stream이 발급한 chatId가 신고 대상 식별자가 되고,
 * 방 폭파 시 로그도 함께 삭제된다(즉시 삭제 — 방을 나가면 신고 불가가 정책).
 *
 * 시그널(/user/queue/* 1:1 전달)과 달리 채팅은 /topic 브로드캐스트라 구독자 전원에게 간다.
 * 방 상태 읽기는 signal 패키지의 RoomMembershipReader 포트를 재사용한다
 * (존재·참가 여부만 필요해 요구 사항이 동일).
 */
@Service
@RequiredArgsConstructor
public class ChatService {

    private static final String CHAT_TOPIC = "/topic/rooms/%s/chat";

    /** 메시지 최대 길이 — 브로드캐스트 채널 남용(대용량 프레임) 방지용 서버측 상한. */
    private static final int MAX_TEXT_LENGTH = 500;

    /** 게임 표시명 상한 — 카탈로그 게임명 길이를 넉넉히 커버하는 수준. */
    private static final int MAX_GAME_NAME_LENGTH = 50;

    private final RoomMembershipReader membershipReader;
    private final SimpMessagingTemplate messagingTemplate;
    private final ChatLogRepository chatLogRepository;

    /**
     * 일반 채팅(TALK). 검증 순서: 입력 형식 → 방 존재 → 발신자 참가.
     * 실패는 전부 BusinessException → ChatController의 @MessageExceptionHandler가
     * 발신자 /user/queue/errors로 돌려준다.
     */
    public void send(String roomId, ChatSendRequest request, AuthPrincipal sender) {
        String text = request.text();
        if (text == null || text.isBlank() || text.length() > MAX_TEXT_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        requireMembership(roomId, sender);
        // 발신자 신원·시각은 서버가 확정한다(클라이언트 입력 불신). 저장 후 발급된 chatId를 함께 방송한다.
        Instant sentAt = Instant.now();
        String chatId = chatLogRepository.appendTalk(
                roomId, sender.userId(), sender.displayName(), text, sentAt);
        broadcast(roomId, ChatMessageResponse.talk(
                chatId, sender.userId(), sender.displayName(), text, sentAt));
    }

    /**
     * 게임 제안(GAME_SUGGEST) — 비방장의 "게임 제안" 버튼. 채팅 토픽에 타입만 다르게 브로드캐스트.
     * 방장 여부는 서버에서 구분하지 않는다(버튼 노출 분기는 UI 책임 — 참가자면 누구나 발신 가능).
     * gameId 실존 검증은 게임 도메인 미구현이라 보류(형식 검증만) — 도메인 구현 시 강화.
     */
    public void suggestGame(String roomId, ChatGameSuggestRequest request, AuthPrincipal sender) {
        Long gameId = request.gameId();
        String gameName = request.gameName();
        if (gameId == null || gameId <= 0
                || gameName == null || gameName.isBlank() || gameName.length() > MAX_GAME_NAME_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        requireMembership(roomId, sender);
        // text는 구형/단순 클라이언트용 표시 폴백 — 커스텀 렌더링은 type·gameId·gameName으로.
        String text = String.format("'%s' 게임을 제안했습니다.", gameName);
        Instant sentAt = Instant.now();
        String chatId = chatLogRepository.appendGameSuggest(
                roomId, sender.userId(), sender.displayName(), text, gameId, gameName, sentAt);
        broadcast(roomId, ChatMessageResponse.gameSuggest(
                chatId, sender.userId(), sender.displayName(), text, gameId, gameName, sentAt));
    }

    private void requireMembership(String roomId, AuthPrincipal sender) {
        if (!membershipReader.existsRoom(roomId)) {
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!membershipReader.isMember(roomId, sender.userId())) {
            throw new BusinessException(ErrorCode.CHAT_NOT_IN_ROOM);
        }
    }

    private void broadcast(String roomId, ChatMessageResponse message) {
        messagingTemplate.convertAndSend(String.format(CHAT_TOPIC, roomId), message);
    }
}
