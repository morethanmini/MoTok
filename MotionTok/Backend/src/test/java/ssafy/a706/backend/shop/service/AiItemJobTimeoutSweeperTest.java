package ssafy.a706.backend.shop.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 방치된 AI 생성 job 정리.
 *
 * <p>여기서 못박는 건 <b>PENDING도 걷힌다</b>는 것이다. 워커가 아예 떠 있지 않으면 job은
 * PROCESSING까지 가지도 못하고 PENDING에 남는데, 예전에는 그걸 아무도 실패로 바꿔 주지 않아
 * 결제한 포인트가 영구히 묶였다(실측으로 확인했다).
 *
 * <p>조회 기준 컬럼이 상태마다 다른 것도 고정한다 — PENDING은 {@code updatedAt}이 NULL이라
 * PROCESSING과 같은 조회를 쓰면 <b>한 건도 잡히지 않는다</b>. 조용히 아무 일도 안 하는 종류의 결함이다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AiItemJobTimeoutSweeperTest {

    @Mock private AiItemJobRepository aiItemJobRepository;
    @Mock private AiItemJobService aiItemJobService;

    @InjectMocks private AiItemJobTimeoutSweeper sweeper;

    private AiItemJob job(long id, AiJobStatus status) {
        AiItemJob job = AiItemJob.builder()
                .userId(1L)
                .name("테스트")
                .category(ItemCategory.STICKER)
                .sketchBase64("c2tldGNo")
                .status(status)
                .pointsCharged(1500)
                .build();
        ReflectionTestUtils.setField(job, "id", id);
        return job;
    }

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(sweeper, "timeoutMinutes", 5);
        given(aiItemJobRepository.findAllByStatusAndUpdatedAtBefore(any(), any())).willReturn(List.of());
        given(aiItemJobRepository.findAllByStatusAndCreatedAtBefore(any(), any())).willReturn(List.of());
        given(aiItemJobService.failPending(anyLong(), anyString())).willReturn(true);
    }

    @Test
    @DisplayName("가져가 놓고 안 끝난 PROCESSING은 fail로 정리한다")
    void sweepsStaleProcessing() {
        given(aiItemJobRepository.findAllByStatusAndUpdatedAtBefore(eq(AiJobStatus.PROCESSING), any()))
                .willReturn(List.of(job(1L, AiJobStatus.PROCESSING)));

        sweeper.sweep();

        verify(aiItemJobService).fail(eq(1L), anyString());
    }

    @Test
    @DisplayName("아무도 가져가지 않은 PENDING도 정리·환불한다 — 예전엔 포인트가 영구히 묶였다")
    void sweepsUnpickedPending() {
        given(aiItemJobRepository.findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), any()))
                .willReturn(List.of(job(2L, AiJobStatus.PENDING)));

        sweeper.sweep();

        verify(aiItemJobService).failPending(eq(2L), anyString());
    }

    @Test
    @DisplayName("PENDING은 생성 시각으로 찾는다 — updatedAt이 NULL이라 그 기준으론 한 건도 안 잡힌다")
    void pendingIsFoundByCreatedAt() {
        sweeper.sweep();

        verify(aiItemJobRepository).findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), any(LocalDateTime.class));
        verify(aiItemJobRepository, never()).findAllByStatusAndUpdatedAtBefore(eq(AiJobStatus.PENDING), any());
    }

    @Test
    @DisplayName("PROCESSING이 없어도 PENDING 정리는 돈다 — 조기 return으로 건너뛰면 안 된다")
    void pendingSweepRunsEvenWithoutProcessing() {
        given(aiItemJobRepository.findAllByStatusAndUpdatedAtBefore(any(), any())).willReturn(List.of());
        given(aiItemJobRepository.findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), any()))
                .willReturn(List.of(job(3L, AiJobStatus.PENDING)));

        sweeper.sweep();

        verify(aiItemJobService).failPending(eq(3L), anyString());
    }

    @Test
    @DisplayName("그 사이 누가 가져갔으면(false) 조용히 넘어간다")
    void skipsWhenAlreadyTaken() {
        given(aiItemJobRepository.findAllByStatusAndCreatedAtBefore(eq(AiJobStatus.PENDING), any()))
                .willReturn(List.of(job(4L, AiJobStatus.PENDING)));
        given(aiItemJobService.failPending(anyLong(), anyString())).willReturn(false);

        sweeper.sweep();

        verify(aiItemJobService).failPending(eq(4L), anyString());
    }
}
