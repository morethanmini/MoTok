package ssafy.a706.backend.friend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
@Slf4j
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
        try {
            fanOut(event);
        } catch (RuntimeException e) {
            // 리스너는 발행자(로그아웃 트랜잭션·하트비트 프레임)와 같은 스레드에서 동기로 돈다.
            // 알림 실패가 로그아웃을 500으로 만들거나 하트비트를 깨뜨려선 안 된다 — 삼키고 남긴다.
            log.warn("친구 프레즌스 알림 실패 (userId={})", event.userId(), e);
        }
    }

    private void fanOut(PresenceChangedEvent event) {
        // 탈퇴·정지 계정의 상태는 애초에 내보내지 않는다. 목록 조회(GET /friends)가 그 사람을
        // 통째로 지우는데 실시간으로만 새어 나가면 "목록에 없는 사람의 상태가 뜨는" 화면이 된다.
        // 거르는 대상은 받는 사람이 아니라 <b>상태가 바뀐 당사자</b>다.
        boolean subjectVisible = userRepository.findById(event.userId())
                .filter(FriendService::isVisible)
                .isPresent();
        if (!subjectVisible) {
            log.debug("프레즌스 알림 생략 — 노출 대상 아님 (userId={})", event.userId());
            return;
        }

        Set<Long> friendIds = friendshipRepository
                .findAllByUserIdAndStatus(event.userId(), FriendshipStatus.ACCEPTED).stream()
                .map(f -> f.counterpartOf(event.userId()))
                .collect(Collectors.toSet());
        if (friendIds.isEmpty()) {
            log.debug("프레즌스 알림 생략 — 친구 없음 (userId={})", event.userId());
            return;
        }

        // 접속 중인 친구만 남긴다 — 파이프라인 한 번이면 끝나고, 대부분의 경우 여기서 크게 줄어든다.
        // (개인 큐는 받을 사람이 없으면 스프링이 조용히 버리므로 미리 좁히는 편이 싸다.)
        Set<Long> online = presenceRepository.findAll(friendIds).keySet();
        if (online.isEmpty()) {
            log.debug("프레즌스 알림 생략 — 접속 중인 친구 없음 (userId={}, 친구 {}명)",
                    event.userId(), friendIds.size());
            return;
        }

        PresenceQueueMessage payload = PresenceQueueMessage.friend(event.userId(), event.snapshot());
        for (Long friendId : online) {
            messagingTemplate.convertAndSendToUser(String.valueOf(friendId), PRESENCE_QUEUE, payload);
        }
        // 이 로그가 없으면 "델타가 안 온다"를 만났을 때 발행이 안 된 것인지, 수신자가 0인 것인지,
        // 보냈는데 프론트가 못 받은 것인지를 서버에서 구분할 방법이 없다.
        log.debug("프레즌스 알림 전송 (userId={}, 상태={}, 수신자 {}명)",
                event.userId(), event.snapshot().state(), online.size());
    }
}
