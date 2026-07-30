package ssafy.a706.backend.user.sanction.dto;

import java.time.LocalDateTime;

/**
 * 지금 이 계정에 걸려 있는 제재.
 *
 * <p>기간 정지와 영구 정지를 <b>한 응답에</b> 담는다 — 관리자 화면은 "이 사람 지금 어떤 상태인가"를
 * 한 번에 알아야 하고, 둘을 따로 조회하면 그 사이에 상태가 바뀌어 화면이 엇갈릴 수 있다.
 * 정상적으로는 둘이 동시에 서지 않는다(영구 정지를 걸 때 기간 정지 키를 지운다).</p>
 *
 * @param suspended        기간 정지 중인지
 * @param suspendReason    기간 정지 사유. 정지 중이 아니면 null
 * @param remainingSeconds 남은 기간 정지 시간(초). 정지 중이 아니면 null
 * @param releaseAt        자동 해제 예정 시각. 남은 TTL로 계산한 값이라 초 단위 오차가 있다
 * @param banned           영구 정지 중인지. 이쪽은 남은 기간이라는 개념이 없다
 * @param banReason        영구 정지 사유. 밴이 아니면 null
 * @param suspendCount     누적 기간 정지 횟수(이력 기준) — TTL이 만료돼도 남는다
 * @param banCount         누적 영구 정지 횟수 — 해제 후 재밴을 구분하려면 별도로 센다
 * @param warnCount        누적 경고 횟수 — 정지 기간을 정할 때 관리자가 보는 값이다
 */
public record SanctionStatusResponse(
        boolean suspended,
        String suspendReason,
        Long remainingSeconds,
        LocalDateTime releaseAt,
        boolean banned,
        String banReason,
        long suspendCount,
        long banCount,
        long warnCount
) {

    /** 기간 정지 없음. 영구 정지 여부는 따로 실린다 — 둘은 독립적으로 판정한다. */
    public static SanctionStatusResponse of(boolean banned, String banReason,
                                            long suspendCount, long banCount, long warnCount) {
        return new SanctionStatusResponse(false, null, null, null,
                banned, banReason, suspendCount, banCount, warnCount);
    }

    public static SanctionStatusResponse suspended(String suspendReason, long remainingSeconds,
                                                   boolean banned, String banReason,
                                                   long suspendCount, long banCount, long warnCount) {
        return new SanctionStatusResponse(true, suspendReason, remainingSeconds,
                LocalDateTime.now().plusSeconds(remainingSeconds),
                banned, banReason, suspendCount, banCount, warnCount);
    }
}
