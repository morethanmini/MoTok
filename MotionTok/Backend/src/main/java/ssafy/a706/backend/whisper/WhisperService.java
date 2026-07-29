package ssafy.a706.backend.whisper;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.presence.model.PresenceState;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.whisper.dto.WhisperMessageResponse;
import ssafy.a706.backend.whisper.dto.WhisperSendRequest;

import java.time.Instant;
import java.util.List;

/**
 * 친구 1:1 귓속말(-150) — 전역 STOMP 연결(-142) 위에서 방 밖에서도 이어지는 대화.
 *
 * <p><b>왜 지금까지 없었나</b> — 소켓이 게임룸 안에서만 열려 있었기 때문에 로비에 있는 사람에게
 * 무언가를 밀어 넣을 통로 자체가 없었다. 전역 연결이 생기면서 개인 큐 하나만 얹으면 되는 기능이 됐다.</p>
 *
 * <p><b>대기실 채팅과 같은 규칙, 다른 대상</b> — 검증 순서(입력 형식 → 관계 → 대상 상태)와
 * 서버가 신원·시각을 확정하는 원칙, Stream 저장 후 발급 ID를 함께 내려보내는 계약이 모두 같다.
 * 다른 것은 배달 대상뿐이다: 방 채팅은 {@code /topic} 브로드캐스트, 귓속말은 개인 큐 두 개
 * (수신자 + 발신자 에코).</p>
 *
 * <p><b>오프라인 상대는 조용히 버리지 않는다</b> — 개인 큐로 보낸 메시지는 받을 사람이 없으면
 * 스프링이 말없이 폐기한다(시그널이 그렇게 동작한다). 대화에서 그건 "보낸 줄 알았는데 안 갔다"는
 * 최악의 실패라, 보내기 전에 접속 여부를 확인하고 발신자에게 명시적으로 알린다.</p>
 */
@Service
@RequiredArgsConstructor
public class WhisperService {

    private static final String WHISPER_QUEUE = "/queue/whisper";

    /** 대기실 채팅과 같은 상한 — 같은 입력창 경험이라 다르게 둘 이유가 없다. */
    private static final int MAX_TEXT_LENGTH = 500;

    /** 대화창을 열 때 되짚어 주는 최근 메시지 수. */
    private static final int HISTORY_SIZE = 50;

    private final FriendshipRepository friendshipRepository;
    private final PresenceService presenceService;
    private final WhisperLogRepository whisperLogRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ProfanityFilter profanityFilter;

    @Transactional(readOnly = true)
    public void send(MemberPrincipal sender, Long targetUserId, WhisperSendRequest request) {
        String text = request == null ? null : request.text();
        if (text == null || text.isBlank() || text.length() > MAX_TEXT_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        if (targetUserId == null || targetUserId.equals(sender.id())) {
            throw new BusinessException(ErrorCode.INVALID_INPUT);
        }
        requireFriendship(sender.id(), targetUserId);
        if (presenceService.find(targetUserId).state() == PresenceState.OFFLINE) {
            throw new BusinessException(ErrorCode.WHISPER_TARGET_OFFLINE);
        }

        // 대기실 채팅과 같은 규칙(-152): 비속어는 마스킹해서 저장·전달한다(거절 아님).
        String masked = profanityFilter.mask(text.trim());

        Instant sentAt = Instant.now();
        String whisperId = whisperLogRepository.append(
                sender.id(), targetUserId, sender.displayName(), masked, sentAt);
        WhisperLogEntry entry = new WhisperLogEntry(
                whisperId, sender.id(), sender.displayName(), masked, sentAt);

        deliver(targetUserId, WhisperMessageResponse.forViewer(entry, targetUserId, sender.id()));
        deliver(sender.id(), WhisperMessageResponse.forViewer(entry, sender.id(), targetUserId));
    }

    /** 대화창을 열 때의 이력. push는 델타만 주므로 지난 대화는 이 REST가 채운다. */
    @Transactional(readOnly = true)
    public List<WhisperMessageResponse> history(Long viewerId, Long counterpartId) {
        requireFriendship(viewerId, counterpartId);
        return whisperLogRepository.findRecent(viewerId, counterpartId, HISTORY_SIZE).stream()
                .map(entry -> WhisperMessageResponse.forViewer(entry, viewerId, counterpartId))
                .toList();
    }

    private void requireFriendship(Long a, Long b) {
        boolean friends = friendshipRepository.findAllBetween(a, b).stream()
                .anyMatch(f -> f.getStatus() == FriendshipStatus.ACCEPTED);
        if (!friends) {
            throw new BusinessException(ErrorCode.WHISPER_NOT_FRIEND);
        }
    }

    /** 개인 큐 라우팅 키는 Principal.getName()과 같은 문자열이어야 한다 — 회원은 userId의 문자열 표현. */
    private void deliver(Long userId, WhisperMessageResponse message) {
        messagingTemplate.convertAndSendToUser(String.valueOf(userId), WHISPER_QUEUE, message);
    }
}
