package ssafy.a706.backend.global.notification;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * 개인 알림 채널 {@code /user/queue/notifications} 발신부(-100 초대, -57 친구 요청).
 *
 * <p>전역 STOMP 연결(-142) 이전에는 이 채널이 성립하지 않았다. 알림을 받을 사람은 정의상
 * 게임룸 밖(로비)에 있는데 소켓은 게임룸에서만 열렸기 때문이다. 그래서 로비가 12초마다
 * 초대·친구요청을 폴링해 가져갔고, 알림은 최대 한 주기만큼 늦게 떴다.</p>
 *
 * <p><b>푸시가 저장을 대체하지는 않는다</b> — 개인 큐로 보낸 메시지는 그 순간 접속 중이 아니면
 * 조용히 폐기된다. 재연결 중이거나 탭을 닫았다 연 사람은 못 받는다. 그래서 Redis 저장과
 * {@code GET /invitations}는 그대로 두고, 클라이언트는 연결이 성립할 때마다 한 번 스냅샷을
 * 받아 놓친 것을 메운다. 없어지는 건 <b>주기 폴링</b>이지 조회 API가 아니다.</p>
 */
@Component
@RequiredArgsConstructor
public class UserNotifier {

    private static final String NOTIFICATION_QUEUE = "/queue/notifications";

    private final SimpMessagingTemplate messagingTemplate;

    /**
     * @param userId 받을 사람. Principal.getName()과 같은 문자열로 변환해 보낸다 —
     *               Long 그대로 넘기면 라우팅 키가 어긋나 <b>에러 없이 아무에게도 안 가는</b> 실패가 된다
     */
    public void notify(Long userId, UserNotification notification) {
        messagingTemplate.convertAndSendToUser(String.valueOf(userId), NOTIFICATION_QUEUE, notification);
    }
}
