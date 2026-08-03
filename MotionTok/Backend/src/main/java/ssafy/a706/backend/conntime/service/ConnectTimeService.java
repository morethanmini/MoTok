package ssafy.a706.backend.conntime.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.conntime.entity.UserConnectTime;
import ssafy.a706.backend.conntime.repository.ConnectTimeRedisRepository;
import ssafy.a706.backend.conntime.repository.UserConnectTimeRepository;
import ssafy.a706.backend.presence.repository.PresenceRepository;

import java.time.LocalDateTime;

/**
 * 총 접속시간 집계(S15P11A706-141) — 하트비트 델타 누적(Redis) + 오프라인 시 정산(RDB).
 *
 * <p>흐름: 매 하트비트마다 직전 비트와의 간격을 {@code conntime:{userId}}에 INCRBY(accumulate),
 * 로그아웃·스윕이 오프라인을 확인하면 GETDEL로 걷어 user_connect_times에 한 번에 더한다(flush).
 * 조회는 RDB 확정치 + 미정산 버퍼 합(totalSecondsOf)이라 온라인 중에도 값이 실시간으로 자란다.</p>
 *
 * <p>델타는 presence TTL(60s)로 clamp한다 — 그보다 긴 공백은 하트비트가 죽어 있던(오프라인) 구간이라
 * 접속시간이 아니다. 세션 첫 비트는 직전 구간이 없으므로 0으로 친다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConnectTimeService {

    /** 한 구간으로 인정하는 최대 길이 = presence TTL. 이보다 길면 그 사이는 오프라인이었다. */
    private static final long MAX_DELTA_SECONDS = PresenceRepository.TTL.toSeconds();

    private final UserConnectTimeRepository connectTimeRepository;
    private final ConnectTimeRedisRepository redisRepository;

    /** 하트비트 1회분 누적 — prevBeatAt이 null(세션 첫 비트)이면 셀 구간이 없다. */
    public void accumulate(Long userId, Long prevBeatEpochMillis, long nowEpochMillis) {
        if (prevBeatEpochMillis == null) {
            return;
        }
        long deltaSeconds = (nowEpochMillis - prevBeatEpochMillis) / 1000;
        if (deltaSeconds <= 0) {
            return;
        }
        redisRepository.increment(userId, Math.min(deltaSeconds, MAX_DELTA_SECONDS));
    }

    /**
     * 미정산 버퍼를 걷어 RDB에 확정한다. RDB 반영이 실패하면 걷은 값을 버퍼에 되돌려
     * 다음 스윕이 재시도하게 한다 — 실패가 곧 유실이 되지 않게.
     */
    @Transactional
    public void flush(Long userId) {
        Long pending = redisRepository.pop(userId);
        if (pending == null || pending <= 0) {
            return;
        }
        try {
            UserConnectTime row = connectTimeRepository.findById(userId)
                    .orElseGet(() -> new UserConnectTime(userId));
            row.addSeconds(pending);
            connectTimeRepository.save(row);
        } catch (RuntimeException e) {
            redisRepository.increment(userId, pending);
            log.warn("접속시간 flush 실패 — 버퍼 복원 후 다음 스윕에 재시도 (userId={}, pending={}s)", userId, pending, e);
        }
    }

    /**
     * 마지막 접속 종료 시각(-179) — 공개 프로필이 가입일·총 접속시간과 함께 보여준다.
     *
     * <p>기록이 없으면(배포 이후 한 번도 정산되지 않음) null이다. 접속 중인 회원의 값은
     * <b>직전</b> 접속의 종료 시각이지만, 프로필은 "이 사람의 기록"을 보는 화면이라 그대로 싣는다 —
     * 지금 접속 중인지는 친구 목록의 상태 점이 알려준다.</p>
     */
    @Transactional(readOnly = true)
    public LocalDateTime lastSeenOf(Long userId) {
        return connectTimeRepository.findById(userId)
                .map(UserConnectTime::lastSeenAt)
                .orElse(null);
    }

    /** 총 접속시간(초) = RDB 확정치 + 아직 걷지 않은 버퍼. 기록이 없는(신규·미접속) 회원은 0. */
    @Transactional(readOnly = true)
    public long totalSecondsOf(Long userId) {
        long persisted = connectTimeRepository.findById(userId)
                .map(UserConnectTime::getTotalSeconds)
                .orElse(0L);
        return persisted + redisRepository.pendingOf(userId);
    }
}
