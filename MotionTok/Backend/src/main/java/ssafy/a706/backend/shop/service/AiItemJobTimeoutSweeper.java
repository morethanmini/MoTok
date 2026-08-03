package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 방치된 AI 아이템 생성 job 자동 정리(-102 부속).
 *
 * <p>GPU 워커가 응답 없이 죽거나 큐가 막히면 job은 PROCESSING에 영원히 갇힌다. 프론트는 60초
 * 폴링 후 포기하지만 서버 job은 그대로라 /internal/ai-jobs/{id}/fail이 호출되지 않고,
 * pointsCharged 환불도 일어나지 않는다 — 유저가 결제한 포인트를 그냥 잃는 채로 남는다.
 *
 * <p><b>PENDING도 함께 걷는다.</b> 워커가 아예 떠 있지 않으면 job은 PROCESSING까지 가지도 못하고
 * PENDING에 남는데, 그건 누구도 실패로 바꿔 주지 않아 포인트가 영구히 묶였다(실측으로 확인).
 * PENDING은 {@code updatedAt}이 NULL이라 아래 두 조회의 기준 컬럼이 다르다 — 생성 시각으로 본다.
 * 아직 시간이 남은 PENDING은 fal 인계 대상이므로({@code AiFalDispatcher}) 여기서 건드리지 않는다.
 *
 * <p>{@link AiItemJobService#fail}을 그대로 재사용해 환불·중복환불 방지(조건부 UPDATE) 로직을
 * 한 곳만 유지한다. 반드시 다른 빈(AiItemJobService)의 메서드로 호출해야 한다 — 같은 클래스
 * 안에서 this.fail(...)로 부르면(self-invocation) 프록시를 안 거쳐 @Transactional이 아예
 * 적용되지 않는다. 이렇게 분리해 두면 job마다 독립된 트랜잭션으로 처리되어
 * (ConnectTimeFlushScheduler와 같은 패턴), 한 job이 그 사이 워커에 의해 이미 처리됐어도
 * (AI_JOB_INVALID_STATE) 나머지 job 처리에 영향을 주지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiItemJobTimeoutSweeper {

    private static final long SWEEP_INTERVAL_MS = 60_000;
    private static final String TIMEOUT_MESSAGE = "생성 시간이 초과되어 자동으로 정리되었습니다.";
    /** PENDING 방치 — 아무도 가져가지 않은 경우. 원인이 달라 문구를 나눠 로그·DB에서 구분되게 한다. */
    private static final String NOT_PICKED_MESSAGE = "생성을 처리할 서버가 없어 자동으로 정리되었습니다.";

    private final AiItemJobRepository aiItemJobRepository;
    private final AiItemJobService aiItemJobService;

    /** application.yaml app.shop.ai-job-timeout-minutes — 이 시간 이상 PROCESSING이면 방치로 본다. */
    @Value("${app.shop.ai-job-timeout-minutes}")
    private int timeoutMinutes;

    @Scheduled(fixedDelay = SWEEP_INTERVAL_MS)
    public void sweep() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(timeoutMinutes);
        List<AiItemJob> stale = aiItemJobRepository.findAllByStatusAndUpdatedAtBefore(AiJobStatus.PROCESSING, cutoff);

        int cleaned = sweepPending(cutoff);
        for (AiItemJob job : stale) {
            try {
                aiItemJobService.fail(job.getId(), TIMEOUT_MESSAGE);
                cleaned++;
                log.info("AI 아이템 생성 job {} 타임아웃 정리 — PROCESSING 상태로 {}분 이상 경과(워커 무응답 의심), userId={}",
                        job.getId(), timeoutMinutes, job.getUserId());
            } catch (BusinessException e) {
                // 그 사이 워커가 complete/fail을 불러 이미 종료 상태가 된 경우(AI_JOB_INVALID_STATE) — 건너뛴다.
                log.debug("AI 아이템 생성 job {} 타임아웃 정리 스킵 — 이미 종료 상태: {}", job.getId(), e.getMessage());
            }
        }
        if (cleaned > 0) {
            log.info("방치된 AI 아이템 생성 job 타임아웃 정리 완료: {}건", cleaned);
        }
    }

    /**
     * 아무도 가져가지 않은 PENDING을 실패·환불한다.
     *
     * <p>{@code updatedAt}이 NULL이라 PROCESSING과 같은 조회를 쓸 수 없다 — 생성 시각으로 본다.
     * 그리고 {@code fail()}은 PROCESSING만 받으므로 PENDING 전용 경로를 쓴다.</p>
     */
    private int sweepPending(LocalDateTime cutoff) {
        List<AiItemJob> waiting =
                aiItemJobRepository.findAllByStatusAndCreatedAtBefore(AiJobStatus.PENDING, cutoff);
        int cleaned = 0;
        for (AiItemJob job : waiting) {
            try {
                if (aiItemJobService.failPending(job.getId(), NOT_PICKED_MESSAGE)) {
                    cleaned++;
                    log.info("AI 아이템 생성 job {} 정리 — {}분 동안 아무도 가져가지 않음(워커 미기동 의심), userId={}",
                            job.getId(), timeoutMinutes, job.getUserId());
                }
            } catch (BusinessException e) {
                log.debug("AI 아이템 생성 job {} 정리 스킵 — 이미 종료 상태: {}", job.getId(), e.getMessage());
            }
        }
        return cleaned;
    }
}
