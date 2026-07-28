package ssafy.a706.backend.friend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.friend.model.FriendshipStatus;
import ssafy.a706.backend.friend.repository.FriendshipRepository;
import ssafy.a706.backend.presence.controller.dto.PresenceQueueMessage;
import ssafy.a706.backend.presence.model.PresenceChangedEvent;
import ssafy.a706.backend.presence.repository.PresenceRepository;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Set;
import java.util.stream.Collectors;

/**
 * 친구의 접속 상태 변화를 개인 큐로 밀어 준다(-149) — 로비 친구 목록 폴링의 대체물.
 *
 * <p><b>왜 폴링을 대체하나</b> — 종전에는 로비에 앉아 있는 모두가 12초마다 친구 목록 전체를
 * 다시 받아 갔다. 그 응답의 거의 전부는 "아무것도 안 바뀜"이다. 부하가 이벤트 수가 아니라
 * <b>접속자 수 × 주기</b>에 비례하는 구조라, 사람이 늘수록 쓸모없는 트래픽만 늘었다.
 * 이제 서버는 상태가 실제로 바뀐 순간에만, 그 변화를 볼 이유가 있는 사람에게만 보낸다.</p>
 *
 * <p><b>fan-out을 좁히는 두 단계</b> —
 * ① 받을 사람은 "나를 친구로 둔 회원" 전부가 아니라 <b>지금 접속 중인</b> 친구뿐이다.
 * 오프라인 친구에게 보낸 개인 큐 메시지는 스프링이 조용히 버리므로 계산만 낭비다.
 * ② 탈퇴·정지 계정은 목록 조회와 같은 기준으로 걸러 낸다 — push 경로에만 이 필터가 빠지면
 * 조회에서는 안 보이던 사람의 상태가 실시간으로는 새어 나간다.</p>
 *
 * <p>ACCEPTED 친구 관계는 방향과 무관한 단일 행이라 역방향 조회가 따로 필요 없다
 * ({@code findAllByUserIdAndStatus} 하나로 양쪽을 다 찾는다).</p>
 */
@Component
@RequiredArgsConstructor
public class FriendPresenceNotifier {

    private static final String PRESENCE_QUEUE = "/queue/presence";

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final PresenceRepository presenceRepository;
    private final SimpMessagingTemplate messagingTemplate;

    @EventListener
    @Transactional(readOnly = true)
    public void onPresenceChanged(PresenceChangedEvent event) {
        Set<Long> friendIds = friendshipRepository
                .findAllByUserIdAndStatus(event.userId(), FriendshipStatus.ACCEPTED).stream()
                .map(f -> f.counterpartOf(event.userId()))
                .collect(Collectors.toSet());
        if (friendIds.isEmpty()) {
            return;
        }

        // 접속 중인 친구만 남긴다 — 파이프라인 한 번이면 끝나고, 대부분의 경우 여기서 크게 줄어든다.
        Set<Long> online = presenceRepository.findAll(friendIds).keySet();
        if (online.isEmpty()) {
            return;
        }

        PresenceQueueMessage payload = PresenceQueueMessage.friend(event.userId(), event.snapshot());
        userRepository.findAllById(online).stream()
                .filter(FriendService::isVisible)
                .forEach(user -> messagingTemplate.convertAndSendToUser(
                        String.valueOf(user.getId()), PRESENCE_QUEUE, payload));
    }
}
