package ssafy.a706.backend.shop.service.ai;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobProvider;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;
import ssafy.a706.backend.shop.service.AiItemJobService;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * GPU 워커가 가져가지 않은 job을 fal이 넘겨받는다 (-102 부속).
 *
 * <p><b>PENDING만 가져간다.</b> 워커가 이미 집어간 job(PROCESSING)은 건드리지 않아서, 같은 job을
 * 둘이 동시에 만드는 상황 자체가 생기지 않는다 — claim 토큰·하트비트 같은 장치 없이 기존
 * 조건부 UPDATE 하나로 끝난다. 워커가 가져가 놓고 죽은 job은 {@code AiItemJobTimeoutSweeper}가
 * 지금까지처럼 정리·환불한다.</p>
 *
 * <p><b>fal 호출은 전용 executor에서 한다.</b> 이 스케줄 메서드는 후보만 골라 던지고 바로 끝난다.
 * 앱 스케줄러는 {@code SchedulingConfig}가 풀 4개로 잡아 두었는데, 거기서 10~20초를 블로킹하면
 * 같이 도는 로비 flush(1초 창)·접속시간 스윕·방 청소·AI 타임아웃 정리가 밀린다 — 특히 로비
 * flush는 "1초 안에 반영"이 규격이라 몇 초씩 튀는 형태로 드러난다.</p>
 *
 * <p>결과 처리는 {@link AiItemJobService#complete}·{@link AiItemJobService#fail}을 그대로 쓴다 —
 * 업로드·상태 전이·환불 로직이 GPU 경로와 한 곳에만 있게 된다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiFalDispatcher {

    private static final long POLL_INTERVAL_MS = 2_000;

    /**
     * 동시 호출 상한이자 스레드 수. 스레드와 크레딧 소모 속도를 같은 손잡이로 잡는다.
     * 큐를 짧게 두는 이유 — 길게 잡으면 몇 분 뒤에야 처리될 job을 붙들고 있게 되는데,
     * 프론트는 60초면 포기하므로 그때 만든 그림은 아무도 보지 않는다(크레딧만 쓰인다).
     */
    private static final int POOL_SIZE = 2;
    private static final int QUEUE_CAPACITY = 4;

    private static final String LIMIT_MESSAGE =
            "오늘의 AI 생성 한도를 모두 사용했어요. 내일 다시 시도해 주세요.";

    private final AiItemJobRepository aiItemJobRepository;
    private final AiItemJobService aiItemJobService;
    private final FalImageClient falImageClient;
    private final AiItemImagePostProcessor postProcessor;
    private final FalProperties properties;

    @Value("${app.shop.ai-provider}")
    private AiProviderMode mode;

    /** 상한 경고를 폴링마다 쌓지 않기 위한 상태 — 상한에 걸린 순간과 풀린 순간에만 남긴다. */
    private boolean limitWarned;

    /**
     * 이 시간이 지난 job은 넘겨받지 않는다(스위퍼의 정리 기준과 같은 값).
     *
     * <p>프론트는 60초면 포기하고 스위퍼는 이 시간이 지나면 FAILED로 돌려 환불한다 —
     * 그보다 오래된 job을 지금 만들어 봐야 결과를 볼 사람이 없고 크레딧만 나간다.
     * 서버가 한동안 꺼져 있었거나 큐가 밀렸을 때 묵은 job을 무더기로 결제하는 것도 막는다.</p>
     */
    @Value("${app.shop.ai-job-timeout-minutes}")
    private int maxAgeMinutes;

    /**
     * fal 호출 전용 스레드풀 — <b>일부러 스프링 빈으로 만들지 않는다.</b>
     *
     * <p>{@code Executor} 타입 빈을 하나라도 등록하면 부트의 기본 태스크 실행기
     * (applicationTaskExecutor)가 {@code @ConditionalOnMissingBean(Executor.class)}로 물러난다.
     * 그러면 {@code @Async}로 도는 게임 정산·보상 리스너가 여기 작은 풀(거부 정책 포함)로
     * 넘어와 부하 때 정산이 거부된다. 그래서 이 풀은 이 클래스가 직접 소유한다.</p>
     */
    private ThreadPoolExecutor executor;

    @PostConstruct
    void startExecutor() {
        executor = new ThreadPoolExecutor(
                POOL_SIZE, POOL_SIZE, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY),
                runnable -> {
                    Thread thread = new Thread(runnable, "ai-fal-worker");
                    thread.setDaemon(true);
                    return thread;
                },
                // 큐가 차면 호출부가 대신 실행하는 기본 정책(CallerRuns)은 쓰지 않는다 —
                // 그러면 결국 스케줄러 스레드가 블로킹된다. 거부시키고 job을 되돌린다.
                new ThreadPoolExecutor.AbortPolicy());
    }

    @PreDestroy
    void stopExecutor() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    @Scheduled(fixedDelay = POLL_INTERVAL_MS)
    public void dispatchPending() {
        if (!mode.usesFal() || !falImageClient.available()) {
            return;
        }
        // FAL 모드는 기다릴 이유가 없다(GPU를 아예 안 쓴다). AUTO는 워커에게 먼저 기회를 준다.
        int waitSeconds = mode == AiProviderMode.FAL ? 0 : properties.handoverSeconds();
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(waitSeconds);

        LocalDateTime tooOld = LocalDateTime.now().minusMinutes(maxAgeMinutes);
        List<AiItemJob> candidates =
                aiItemJobRepository.findAllByStatusAndCreatedAtBefore(AiJobStatus.PENDING, cutoff).stream()
                        .filter(job -> job.getCreatedAt().isAfter(tooOld))
                        .toList();
        if (candidates.isEmpty()) {
            return;
        }

        // 남은 여유를 폴링당 한 번만 센다. 후보마다 COUNT를 돌리면 대기가 많을 때 쿼리가 그만큼 늘어난다.
        int remaining = remainingDailyCapacity();
        for (AiItemJob job : candidates) {
            if (remaining == 0) {
                giveUpOverLimit(candidates);
                return;
            }
            // 여기서 뺏어 온다. 그 사이 워커가 먼저 가져갔으면 false가 돌아오고 조용히 넘어간다.
            // 서비스(다른 빈)를 거치는 이유 — 이 스케줄 메서드에는 트랜잭션이 없고,
            // 커밋이 끝난 뒤에 넘겨야 fal 스레드가 PROCESSING 상태를 볼 수 있다.
            if (!aiItemJobService.claimForFal(job.getId())) {
                continue;
            }
            if (remaining > 0) {
                remaining--;
            }
            submit(job);
        }
        limitWarned = false;
    }

    /**
     * 상한에 걸렸을 때의 처리.
     *
     * <p><b>FAL 모드에서는 기다릴 이유가 없어 바로 실패·환불한다.</b> fal이 유일한 경로라
     * 상한이 풀리는 자정까지 아무도 만들어 주지 않는데, 그대로 두면 job은 PROCESSING도 아닌
     * PENDING으로 남아 타임아웃 스위퍼(5분)가 걷어갈 때까지 포인트가 묶인다. 유저 화면은
     * 이미 60초에 포기한 뒤다 — 결과가 같다면 빨리 돌려주는 게 낫다.</p>
     *
     * <p>AUTO 모드에서는 취소하지 않는다. GPU 워커가 아직 가져갈 수 있어서, 여기서 지우면
     * 만들 수 있는 job을 우리가 없애는 셈이 된다.</p>
     */
    private void giveUpOverLimit(List<AiItemJob> candidates) {
        int waiting = candidates.size();
        if (mode != AiProviderMode.FAL) {
            warnLimitOnce("fal 일일 상한({})에 도달해 인계를 멈춥니다 — GPU 워커가 가져갈 수 있어 대기시킵니다. 대기 job {}건",
                    waiting);
            return;
        }
        warnLimitOnce("fal 일일 상한({})에 도달했습니다. fal이 유일한 경로라 대기 job {}건을 실패 처리하고 환불합니다",
                waiting);
        for (AiItemJob job : candidates) {
            try {
                if (aiItemJobService.failPending(job.getId(), LIMIT_MESSAGE)) {
                    log.info("fal 상한 초과로 job {} 취소·환불 userId={}", job.getId(), job.getUserId());
                }
            } catch (RuntimeException e) {
                log.error("fal 상한 초과 job {} 취소 실패 — 타임아웃 스위퍼가 정리할 것", job.getId(), e);
            }
        }
    }

    /** 폴링마다 같은 경고가 쌓이지 않게 상태가 바뀔 때만 남긴다. */
    private void warnLimitOnce(String message, int waiting) {
        if (limitWarned) {
            return;
        }
        limitWarned = true;
        log.warn(message, properties.dailyLimit(), waiting);
    }

    private void submit(AiItemJob job) {
        try {
            executor.execute(() -> generate(job));
        } catch (RejectedExecutionException e) {
            // 큐가 가득 찼다 — 붙잡고 있으면 PROCESSING에 갇히므로 즉시 실패시켜 환불한다.
            log.warn("fal 작업 큐 포화로 job {} 반려", job.getId());
            failQuietly(job.getId(), "지금은 생성 요청이 많아요. 잠시 후 다시 시도해 주세요.");
        }
    }

    /** 전용 스레드에서 도는 실제 생성. 예외를 밖으로 흘리지 않는다(스레드가 죽으면 job이 갇힌다). */
    private void generate(AiItemJob job) {
        try {
            String raw = falImageClient.edit(job.getCategory(), job.getSketchBase64());
            // GPU 워커의 rembg + _normalize에 해당하는 단계 — 이게 없으면 fal 스티커만
            // 흰 사각형으로 붙는다(프롬프트가 흰 배경을 그리게 시킨다).
            String imageBase64 = postProcessor.toTransparentItem(raw);
            aiItemJobService.complete(job.getId(), imageBase64);
            log.info("fal 생성 완료 job={} userId={}", job.getId(), job.getUserId());
        } catch (FalGenerationException e) {
            log.warn("fal 생성 실패 job={}: {}", job.getId(), e.getMessage());
            failQuietly(job.getId(), "그림을 만들지 못했어요. 다시 시도해 주세요.");
        } catch (RuntimeException e) {
            // 업로드·DB 등 우리 쪽 실패. 사유는 로그로 남기고 유저에겐 같은 문구로 알린다.
            log.error("fal 결과 처리 실패 job={}", job.getId(), e);
            failQuietly(job.getId(), "그림을 만들지 못했어요. 다시 시도해 주세요.");
        }
    }

    /**
     * 실패 기록·환불. 이것마저 실패하면 job은 PROCESSING에 남지만
     * {@code AiItemJobTimeoutSweeper}가 뒤에서 같은 일을 하므로 포인트가 사라지지는 않는다.
     */
    private void failQuietly(Long jobId, String message) {
        try {
            aiItemJobService.fail(jobId, message);
        } catch (RuntimeException e) {
            log.error("fal 실패 처리 중 오류 job={} — 타임아웃 스위퍼가 정리할 것", jobId, e);
        }
    }

    /** 오늘 더 부를 수 있는 횟수. 설정이 0 이하면 무제한이라 -1을 준다. */
    private int remainingDailyCapacity() {
        int limit = properties.dailyLimit();
        if (limit <= 0) {
            return -1;
        }
        long today = aiItemJobRepository.countByProviderAndCreatedAtAfter(
                AiJobProvider.FAL, LocalDate.now().atStartOfDay());
        return (int) Math.max(0, limit - today);
    }
}
