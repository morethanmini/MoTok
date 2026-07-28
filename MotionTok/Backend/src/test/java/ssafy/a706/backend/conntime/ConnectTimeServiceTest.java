package ssafy.a706.backend.conntime;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ssafy.a706.backend.conntime.entity.UserConnectTime;
import ssafy.a706.backend.conntime.repository.ConnectTimeRedisRepository;
import ssafy.a706.backend.conntime.repository.UserConnectTimeRepository;
import ssafy.a706.backend.conntime.service.ConnectTimeService;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 총 접속시간 집계 규칙(-141).
 *
 * <p>여기서 지키는 것 — <b>델타는 presence TTL로 clamp</b>(그보다 긴 공백은 오프라인 구간이라
 * 접속시간이 아니다), <b>flush 실패는 유실이 아니라 재시도</b>(버퍼 복원), 조회는 확정치+버퍼 합.</p>
 */
@ExtendWith(MockitoExtension.class)
class ConnectTimeServiceTest {

    private static final long USER_ID = 7L;

    @Mock UserConnectTimeRepository connectTimeRepository;
    @Mock ConnectTimeRedisRepository redisRepository;

    @InjectMocks ConnectTimeService service;

    @Test
    @DisplayName("직전 비트와의 간격을 초 단위로 누적한다")
    void accumulateAddsDeltaSeconds() {
        service.accumulate(USER_ID, 10_000L, 30_000L);

        verify(redisRepository).increment(USER_ID, 20L);
    }

    @Test
    @DisplayName("세션 첫 비트(직전 비트 없음)는 셀 구간이 없다")
    void firstBeatAccumulatesNothing() {
        service.accumulate(USER_ID, null, 30_000L);

        verify(redisRepository, never()).increment(anyLong(), anyLong());
    }

    @Test
    @DisplayName("TTL(60s)보다 긴 공백은 오프라인 구간 — 60s로 잘라서 센다")
    void deltaIsClampedToPresenceTtl() {
        service.accumulate(USER_ID, 0L, 300_000L); // 5분 공백

        verify(redisRepository).increment(USER_ID, 60L);
    }

    @Test
    @DisplayName("시계 역행(음수 델타)은 누적하지 않는다")
    void negativeDeltaIsIgnored() {
        service.accumulate(USER_ID, 30_000L, 10_000L);

        verify(redisRepository, never()).increment(anyLong(), anyLong());
    }

    @Test
    @DisplayName("flush — 버퍼를 걷어 기존 행에 더한다")
    void flushAddsPendingToExistingRow() {
        UserConnectTime row = new UserConnectTime(USER_ID);
        row.addSeconds(100);
        when(redisRepository.pop(USER_ID)).thenReturn(40L);
        when(connectTimeRepository.findById(USER_ID)).thenReturn(Optional.of(row));

        service.flush(USER_ID);

        verify(connectTimeRepository).save(argThat(saved -> saved.getTotalSeconds() == 140));
    }

    @Test
    @DisplayName("flush — 첫 정산이면 행을 새로 만든다")
    void flushCreatesRowOnFirstSettlement() {
        when(redisRepository.pop(USER_ID)).thenReturn(40L);
        when(connectTimeRepository.findById(USER_ID)).thenReturn(Optional.empty());

        service.flush(USER_ID);

        verify(connectTimeRepository).save(argThat(saved ->
                saved.getUserId().equals(USER_ID) && saved.getTotalSeconds() == 40));
    }

    @Test
    @DisplayName("flush — 버퍼가 비어 있으면 DB를 건드리지 않는다")
    void flushWithoutPendingTouchesNothing() {
        when(redisRepository.pop(USER_ID)).thenReturn(null);

        service.flush(USER_ID);

        verify(connectTimeRepository, never()).save(any());
    }

    @Test
    @DisplayName("flush — RDB 반영 실패 시 걷은 값을 버퍼에 되돌린다(유실 방지, 다음 스윕 재시도)")
    void flushRestoresPendingOnDbFailure() {
        when(redisRepository.pop(USER_ID)).thenReturn(40L);
        when(connectTimeRepository.findById(USER_ID)).thenThrow(new RuntimeException("db down"));

        service.flush(USER_ID); // 예외를 삼키고 복원한다 — 스윕이 계속 돌아야 하므로

        verify(redisRepository).increment(USER_ID, 40L);
    }

    @Test
    @DisplayName("총 접속시간 = RDB 확정치 + 아직 걷지 않은 버퍼")
    void totalIsPersistedPlusPending() {
        UserConnectTime row = new UserConnectTime(USER_ID);
        row.addSeconds(3600);
        when(connectTimeRepository.findById(USER_ID)).thenReturn(Optional.of(row));
        when(redisRepository.pendingOf(USER_ID)).thenReturn(120L);

        assertThat(service.totalSecondsOf(USER_ID)).isEqualTo(3720);
    }

    @Test
    @DisplayName("기록이 없는 회원은 0 — 집계 시작 전 가입자도 에러 없이 조회된다")
    void totalIsZeroWithoutAnyRecord() {
        when(connectTimeRepository.findById(USER_ID)).thenReturn(Optional.empty());
        when(redisRepository.pendingOf(USER_ID)).thenReturn(0L);

        assertThat(service.totalSecondsOf(USER_ID)).isZero();
    }
}
