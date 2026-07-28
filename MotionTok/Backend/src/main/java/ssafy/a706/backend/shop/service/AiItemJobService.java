package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateRequest;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateResponse;
import ssafy.a706.backend.shop.controller.dto.AiItemJobStatusResponse;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobCompleteResponse;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobResponse;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemType;
import ssafy.a706.backend.shop.model.UserItem;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;
import ssafy.a706.backend.shop.repository.ItemRepository;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.storage.UploadPurpose;

import java.util.Base64;
import java.util.Optional;

/**
 * AI 아이템 생성 큐 (-102). GPU 워커는 외부에서 호출할 수 없어 폴링 구조로 간다 —
 * 프론트는 작업을 큐에 쌓고 상태를 조회만 하고, 실제 생성·완료 처리는 워커가
 * /api/internal/ai-jobs/* 를 폴링해 수행한다. 포인트 차감은 이번 범위 밖.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AiItemJobService {

    /** 스케치 업로드 원본 용량 상한 — UploadPurpose.AI_ITEM(생성 결과물, 2MB)과는 별개로 입력 스케치에 적용. */
    private static final int MAX_SKETCH_BYTES = 5 * 1024 * 1024;

    /** 워커는 항상 PNG로 생성 결과를 보낸다(합의된 고정 포맷) — UploadPurpose.AI_ITEM이 png/webp만 허용. */
    private static final String GENERATED_IMAGE_CONTENT_TYPE = "image/png";

    private final AiItemJobRepository aiItemJobRepository;
    private final ItemRepository itemRepository;
    private final UserItemRepository userItemRepository;
    private final StorageService storageService;

    /** POST /shop/ai-items — 인증된 유저의 PENDING 작업 생성. */
    @Transactional
    public AiItemJobCreateResponse createJob(Long userId, AiItemJobCreateRequest request) {
        byte[] sketchBytes = decodeBase64(request.sketchBase64());
        if (sketchBytes.length > MAX_SKETCH_BYTES) {
            throw new BusinessException(ErrorCode.AI_ITEM_SKETCH_TOO_LARGE);
        }

        AiItemJob job = aiItemJobRepository.save(AiItemJob.builder()
                .userId(userId)
                .name(request.name())
                .category(request.category())
                .sketchBase64(request.sketchBase64())
                .status(AiJobStatus.PENDING)
                .build());

        return new AiItemJobCreateResponse(job.getId(), job.getStatus());
    }

    /** GET /shop/ai-items/{jobId} — 본인 작업만 조회 가능. */
    public AiItemJobStatusResponse getJob(Long userId, Long jobId) {
        AiItemJob job = aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
        if (!job.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.AI_JOB_FORBIDDEN);
        }

        String imageUrl = job.getItemId() == null ? null
                : itemRepository.findById(job.getItemId()).map(Item::getImageUrl).orElse(null);

        return new AiItemJobStatusResponse(job.getId(), job.getStatus(), job.getItemId(), imageUrl, job.getErrorMessage());
    }

    /**
     * GET /internal/ai-jobs/next — 가장 오래된 PENDING 1건을 PROCESSING으로 바꿔 반환한다.
     * claim()이 0행이면 다른 워커가 먼저 가져간 것이므로 빈 값을 돌려주고, 다음 폴링에서 재시도한다
     * (재시도 루프를 여기서 돌리지 않는다 — 폴링 주기 자체가 재시도 메커니즘이다).
     */
    @Transactional
    public Optional<InternalAiJobResponse> claimNext() {
        Optional<AiItemJob> candidate = aiItemJobRepository.findFirstByStatusOrderByCreatedAtAsc(AiJobStatus.PENDING);
        if (candidate.isEmpty()) {
            return Optional.empty();
        }

        AiItemJob job = candidate.get();
        if (aiItemJobRepository.claim(job.getId()) == 0) {
            return Optional.empty();
        }

        return Optional.of(new InternalAiJobResponse(job.getId(), job.getCategory(), job.getSketchBase64()));
    }

    /**
     * POST /internal/ai-jobs/{jobId}/complete — 이미지 업로드 → Item 생성 → UserItem 지급 → job DONE.
     * PROCESSING이 아닌 job(중복 호출 등)은 AI_JOB_INVALID_STATE로 막는다.
     */
    @Transactional
    public InternalAiJobCompleteResponse complete(Long jobId, String imageBase64) {
        AiItemJob job = aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
        if (job.getStatus() != AiJobStatus.PROCESSING) {
            throw new BusinessException(ErrorCode.AI_JOB_INVALID_STATE);
        }

        byte[] imageBytes = decodeBase64(imageBase64);
        String imageUrl = storageService.putBytes(
                UploadPurpose.AI_ITEM, job.getUserId(), GENERATED_IMAGE_CONTENT_TYPE, imageBytes);

        Item item = itemRepository.save(Item.builder()
                .name(job.getName())
                .category(job.getCategory())
                .itemType(ItemType.AI_CUSTOM)
                .pricePoint(null)
                .imageUrl(imageUrl)
                .creatorId(job.getUserId())
                .active(true)
                .build());

        userItemRepository.save(UserItem.builder().userId(job.getUserId()).itemId(item.getId()).build());

        if (aiItemJobRepository.complete(jobId, item.getId()) == 0) {
            throw new BusinessException(ErrorCode.AI_JOB_INVALID_STATE);
        }

        return new InternalAiJobCompleteResponse(item.getId(), imageUrl);
    }

    /** POST /internal/ai-jobs/{jobId}/fail — job을 FAILED로 바꾸고 errorMessage 기록. */
    @Transactional
    public void fail(Long jobId, String message) {
        aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));

        if (aiItemJobRepository.fail(jobId, message) == 0) {
            throw new BusinessException(ErrorCode.AI_JOB_INVALID_STATE);
        }
    }

    private byte[] decodeBase64(String base64) {
        try {
            return Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "잘못된 base64 인코딩입니다.");
        }
    }
}
