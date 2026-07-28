package ssafy.a706.backend.conntime.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.conntime.repository.ConnectTimeRedisRepository;
import ssafy.a706.backend.presence.service.PresenceService;

import java.util.Set;

/**
 * 접속시간 정산 스윕(-141) — 미정산 버퍼가 있는 회원 중 <b>오프라인으로 전환된</b> 회원만 RDB로 flush.
 *
 * <p>브라우저 강제 종료처럼 로그아웃 없이 사라진 세션은 flush 시점이 없다. presence 키는 TTL(60s)로
 * 알아서 사라지므로, "buffered인데 presence가 없다 = 하트비트가 죽었다"를 오프라인 판정으로 쓴다.
 * 온라인인 회원은 건너뛴다 — 계속 누적 중이고, 조회는 버퍼를 합산해 읽으므로 미룰수록 손해가 없다.</p>
 *
 * <p>주기 60s는 presence TTL과 같은 스케일 — 더 촘촘해도 정확도가 늘지 않고(어차피 TTL이 지나야
 * 오프라인이 보인다), 더 성기면 고아 버퍼가 오래 남을 뿐이다.</p>
 */
@Component
@RequiredArgsConstructor
public class ConnectTimeFlushScheduler {

    private final ConnectTimeRedisRepository redisRepository;
    private final ConnectTimeService connectTimeService;
    private final PresenceService presenceService;

    @Scheduled(fixedDelay = 60_000)
    public void flushOfflineUsers() {
        Set<Long> buffered = redisRepository.pendingUserIds();
        if (buffered.isEmpty()) {
            return;
        }
        // findAll은 한 번의 파이프라인 왕복 — 결과에 없는 회원이 오프라인이다.
        Set<Long> online = presenceService.findAll(buffered).keySet();
        for (Long userId : buffered) {
            if (!online.contains(userId)) {
                connectTimeService.flush(userId); // 실패 시 내부에서 버퍼 복원 — 스윕은 계속 돈다
            }
        }
    }
}
