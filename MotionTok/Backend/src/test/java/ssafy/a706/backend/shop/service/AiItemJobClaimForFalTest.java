package ssafy.a706.backend.shop.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobProvider;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * fal 인계 claim이 <b>트랜잭션 없는 호출자</b>에서도 동작하는지.
 *
 * <p>이걸 통합 테스트로 두는 이유 — 디스패처는 {@code @Scheduled} 메서드라 트랜잭션이 없고,
 * {@code @Modifying} 쿼리는 활성 트랜잭션 없이는 flush에서 {@code TransactionRequiredException}으로
 * 죽는다. 목으로 짠 단위 테스트는 이걸 절대 못 잡는다(실제로 운영에서 먼저 터졌다).</p>
 *
 * <p><b>이 테스트에 {@code @Transactional}을 붙이면 안 된다.</b> 붙이는 순간 테스트가 트랜잭션을
 * 열어 주어 서비스의 애노테이션이 빠져 있어도 통과한다 — 잡으려는 결함을 정확히 가린다.</p>
 */
@SpringBootTest
@TestPropertySource(properties = "app.shop.ai-provider=GPU")
class AiItemJobClaimForFalTest {

    @Autowired
    private AiItemJobService aiItemJobService;

    @Autowired
    private AiItemJobRepository aiItemJobRepository;

    private Long jobId;

    @AfterEach
    void cleanUp() {
        if (jobId != null) {
            aiItemJobRepository.deleteById(jobId);
        }
    }

    private Long givenPendingJob() {
        AiItemJob job = aiItemJobRepository.save(AiItemJob.builder()
                .userId(-1L)
                .name("테스트")
                .category(ItemCategory.STICKER)
                .sketchBase64("c2tldGNo")
                .status(AiJobStatus.PENDING)
                .pointsCharged(0)
                .build());
        jobId = job.getId();
        return jobId;
    }

    @Test
    @DisplayName("트랜잭션 없는 호출자에서도 PENDING을 가져오고 provider를 FAL로 남긴다")
    void claimsWithoutAmbientTransaction() {
        Long id = givenPendingJob();

        boolean claimed = aiItemJobService.claimForFal(id);

        assertThat(claimed).isTrue();
        AiItemJob after = aiItemJobRepository.findById(id).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(AiJobStatus.PROCESSING);
        assertThat(after.getProvider()).isEqualTo(AiJobProvider.FAL);
    }

    @Test
    @DisplayName("이미 가져간 job은 두 번 가져오지 않는다 — 워커와 경합해도 하나만 이긴다")
    void secondClaimFails() {
        Long id = givenPendingJob();

        assertThat(aiItemJobService.claimForFal(id)).isTrue();
        assertThat(aiItemJobService.claimForFal(id)).isFalse();
    }
}
