package ssafy.a706.backend.shop.service.ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobProvider;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;
import ssafy.a706.backend.shop.service.AiItemJobService;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * GPU가 가져가지 않은 job을 fal이 넘겨받는 규칙.
 *
 * <p>여기서 못박는 것 — <b>PENDING만 뺏는다</b>(PROCESSING을 뺏으면 같은 job을 둘이 만들게 된다),
 * <b>모드를 지킨다</b>, <b>실패하면 반드시 fail로 이어져 환불된다</b>. 마지막이 특히 중요하다:
 * 여기서 예외를 흘리면 job이 PROCESSING에 갇혀 유저 포인트가 5분간 묶인다.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiFalDispatcherTest {

    private static final long JOB_ID = 7L;

    @Mock private AiItemJobRepository aiItemJobRepository;
    @Mock private AiItemJobService aiItemJobService;
    @Mock private FalImageClient falImageClient;
    @Mock private AiItemImagePostProcessor postProcessor;
    @Mock private FalProperties properties;

    @InjectMocks private AiFalDispatcher dispatcher;

    private AiItemJob job;

    @BeforeEach
    void setUp() {
        job = AiItemJob.builder()
                .userId(1L)
                .name("낙서")
                .category(ItemCategory.STICKER)
                .sketchBase64("c2tldGNo")
                .status(AiJobStatus.PENDING)
                .pointsCharged(1500)
                .build();
        ReflectionTestUtils.setField(job, "id", JOB_ID);

        given(falImageClient.available()).willReturn(true);
        given(properties.handoverSeconds()).willReturn(20);
        given(properties.dailyLimit()).willReturn(0);
        given(aiItemJobRepository.findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), any()))
                .willReturn(List.of(job));
        given(aiItemJobService.claimForFal(anyLong())).willReturn(true);
        given(postProcessor.toTransparentItem(anyString())).willAnswer(i -> i.getArgument(0));
        // 스위퍼 정리 기준과 같은 값(application.yaml 기본 5분)
        ReflectionTestUtils.setField(dispatcher, "maxAgeMinutes", 5);
        dispatcher.startExecutor();
    }

    private void mode(AiProviderMode mode) {
        ReflectionTestUtils.setField(dispatcher, "mode", mode);
    }

    @Test
    @DisplayName("GPU 모드에서는 fal을 아예 부르지 않는다")
    void gpuModeDoesNothing() {
        mode(AiProviderMode.GPU);

        dispatcher.dispatchPending();

        verify(aiItemJobRepository, never()).findAllByStatusAndCreatedAtBefore(any(), any());
        verify(falImageClient, never()).edit(any(), anyString());
    }

    @Test
    @DisplayName("키가 없으면 모드와 무관하게 아무것도 하지 않는다 — 부를 곳이 없다")
    void withoutKeyDoesNothing() {
        mode(AiProviderMode.FAL);
        given(falImageClient.available()).willReturn(false);

        dispatcher.dispatchPending();

        verify(aiItemJobRepository, never()).findAllByStatusAndCreatedAtBefore(any(), any());
    }

    @Test
    @DisplayName("FAL 모드는 기다리지 않고 즉시 가져간다")
    void falModeTakesImmediately() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");

        dispatcher.dispatchPending();

        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(aiItemJobRepository).findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), cutoff.capture());
        // 대기 0초 — cutoff가 "지금"이라 방금 만든 job도 후보가 된다
        assertThat(cutoff.getValue()).isAfter(LocalDateTime.now().minusSeconds(2));
    }

    @Test
    @DisplayName("AUTO 모드는 설정한 시간만큼 GPU에게 먼저 기회를 준다")
    void autoModeWaitsForGpu() {
        mode(AiProviderMode.AUTO);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");

        dispatcher.dispatchPending();

        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(aiItemJobRepository).findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), cutoff.capture());
        assertThat(cutoff.getValue()).isBefore(LocalDateTime.now().minusSeconds(19));
    }

    @Test
    @DisplayName("그 사이 워커가 먼저 가져갔으면(claim 0) 조용히 넘어간다")
    void skipsWhenWorkerWonTheRace() {
        mode(AiProviderMode.FAL);
        given(aiItemJobService.claimForFal(anyLong())).willReturn(false);

        dispatcher.dispatchPending();

        verify(falImageClient, never()).edit(any(), anyString());
    }

    @Test
    @DisplayName("성공하면 GPU 워커와 같은 complete 경로로 마무리한다")
    void successGoesThroughComplete() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");

        dispatcher.dispatchPending();

        verify(aiItemJobService, timeout(2000)).complete(JOB_ID, "cmVzdWx0");
        verify(aiItemJobService, never()).fail(anyLong(), anyString());
    }

    @Test
    @DisplayName("생성이 실패하면 fail로 이어진다 — 여기서 새면 포인트가 묶인다")
    void generationFailureRefunds() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willThrow(new FalGenerationException("boom"));

        dispatcher.dispatchPending();

        verify(aiItemJobService, timeout(2000)).fail(eq(JOB_ID), anyString());
    }

    @Test
    @DisplayName("업로드·DB 같은 우리 쪽 실패도 fail로 이어진다")
    void completeFailureAlsoRefunds() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");
        given(aiItemJobService.complete(anyLong(), anyString())).willThrow(new IllegalStateException("storage down"));

        dispatcher.dispatchPending();

        verify(aiItemJobService, timeout(2000)).fail(eq(JOB_ID), anyString());
    }

    @Test
    @DisplayName("너무 오래된 job은 넘겨받지 않는다 — 결과를 볼 사람이 없고 크레딧만 나간다")
    void skipsStaleJobs() {
        mode(AiProviderMode.FAL);
        // 스위퍼 정리 기준(5분)보다 오래된 job — 곧 FAILED로 환불될 대상이다
        ReflectionTestUtils.setField(job, "createdAt", LocalDateTime.now().minusMinutes(30));

        dispatcher.dispatchPending();

        verify(aiItemJobService, never()).claimForFal(anyLong());
        verify(falImageClient, never()).edit(any(), anyString());
    }

    @Test
    @DisplayName("배경 제거가 실패해도 fail로 이어진다 — 흰 배경 그림을 저장하지 않는다")
    void postProcessFailureRefunds() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");
        given(postProcessor.toTransparentItem(anyString()))
                .willThrow(new FalGenerationException("이미지가 아님"));

        dispatcher.dispatchPending();

        verify(aiItemJobService, timeout(2000)).fail(eq(JOB_ID), anyString());
        verify(aiItemJobService, never()).complete(anyLong(), anyString());
    }

    @Test
    @DisplayName("저장되는 건 후처리를 거친 그림이다 — 원본이 그대로 들어가면 안 된다")
    void savesPostProcessedImage() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("raw");
        given(postProcessor.toTransparentItem("raw")).willReturn("cut-out");

        dispatcher.dispatchPending();

        verify(aiItemJobService, timeout(2000)).complete(JOB_ID, "cut-out");
    }

    @Test
    @DisplayName("일일 상한에 닿으면 더 가져가지 않는다 — 크레딧이 조용히 소진되지 않게")
    void stopsAtDailyLimit() {
        mode(AiProviderMode.FAL);
        given(properties.dailyLimit()).willReturn(10);
        given(aiItemJobRepository.countByProviderAndCreatedAtAfter(eq(AiJobProvider.FAL), any())).willReturn(10L);

        dispatcher.dispatchPending();

        verify(aiItemJobService, never()).claimForFal(anyLong());
        verify(falImageClient, never()).edit(any(), anyString());
    }

    @Test
    @DisplayName("상한이 0이면 무제한 — 카운트를 세지도 않는다")
    void zeroLimitMeansUnlimited() {
        mode(AiProviderMode.FAL);
        given(falImageClient.edit(any(), anyString())).willReturn("cmVzdWx0");

        dispatcher.dispatchPending();

        verify(aiItemJobRepository, never()).countByProviderAndCreatedAtAfter(any(), any());
        verify(aiItemJobService).claimForFal(JOB_ID);
    }
}
