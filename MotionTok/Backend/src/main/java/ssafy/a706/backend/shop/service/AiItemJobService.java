package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateRequest;
import ssafy.a706.backend.shop.controller.dto.AiItemJobCreateResponse;
import ssafy.a706.backend.shop.controller.dto.AiItemJobStatusResponse;
import ssafy.a706.backend.shop.controller.dto.AiItemSaveResponse;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobCompleteResponse;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobResponse;
import ssafy.a706.backend.shop.model.AiItemJob;
import ssafy.a706.backend.shop.model.AiJobStatus;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemType;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.model.UserItem;
import ssafy.a706.backend.shop.repository.AiItemJobRepository;
import ssafy.a706.backend.shop.repository.ItemRepository;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.storage.UploadPurpose;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Base64;
import java.util.Optional;

/**
 * AI 아이템 생성 큐 (-102). GPU 워커는 외부에서 호출할 수 없어 폴링 구조로 간다 —
 * 프론트는 작업을 큐에 쌓고 상태를 조회만 하고, 실제 생성·완료 처리는 워커가
 * /api/internal/ai-jobs/* 를 폴링해 수행한다.
 *
 * <p>포인트 정책: 결제 1건(1,500P)당 최대 2회 생성(최초 + 재생성 1회). 차감은 최초 생성
 * 요청 시 1회뿐이고, 재생성은 parentJobId로 같은 결제 건임을 밝혀 추가 차감 없이 진행한다.
 * 재생성 한도는 서버가 {@link AiItemJobRepository#existsByParentJobId}와 parent_job_id
 * UNIQUE 제약으로 이중 검증한다 — 프론트 상태만 믿으면 새로고침 등으로 우회될 수 있다.</p>
 *
 * <p>오픈 이벤트(app.shop.ai-item-free-event=true) 중엔 {@link #createPaidJob}의 charge가
 * 0이 되어 최초 생성 차감이 스킵된다 — 재생성 한도는 이벤트 여부와 무관하게 그대로 적용된다
 * (GPU 자원 보호 목적이라 무료여도 풀지 않는다).</p>
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
    private final UserRepository userRepository;
    private final PointHistoryRepository pointHistoryRepository;
    private final StorageService storageService;

    /** AI 아이템 생성 1회 결제 비용(포인트). application.yaml app.shop.ai-item-cost. */
    @Value("${app.shop.ai-item-cost}")
    private int aiItemCost;

    /**
     * 오픈 이벤트 중엔 true — 이 최초 생성 건의 포인트 검증/차감/PointHistory 기록을 전부
     * 건너뛴다(pointsCharged=0으로 저장). application.yaml app.shop.ai-item-free-event.
     * 재생성 횟수 제한(createRetryJob)과 parentJobId 검증은 이 값과 무관하게 그대로 적용된다 —
     * GPU 자원 보호 목적이라 무료 이벤트여도 풀지 않는다.
     */
    @Value("${app.shop.ai-item-free-event:false}")
    private boolean aiItemFreeEvent;

    /**
     * POST /shop/ai-items — 인증된 유저의 PENDING 작업 생성.
     * parentJobId가 없으면 새 결제(포인트 차감), 있으면 그 결제 건의 재생성(차감 없음)이다.
     */
    @Transactional
    public AiItemJobCreateResponse createJob(Long userId, AiItemJobCreateRequest request) {
        byte[] sketchBytes = decodeBase64(request.sketchBase64());
        if (sketchBytes.length > MAX_SKETCH_BYTES) {
            throw new BusinessException(ErrorCode.AI_ITEM_SKETCH_TOO_LARGE);
        }

        AiItemJob job = request.parentJobId() == null
                ? createPaidJob(userId, request)
                : createRetryJob(userId, request);

        return new AiItemJobCreateResponse(job.getId(), job.getStatus());
    }

    /**
     * 새 결제 건 — 잔액 확인·차감(부족 시 400) 후 job을 만들고 차감분을 pointsCharged로 남긴다.
     * 오픈 이벤트(aiItemFreeEvent=true) 중엔 charge가 0이 되어 검증/차감/PointHistory 기록을
     * 전부 건너뛴다 — 분기는 이 메서드 안에만 두고 다른 곳(재생성 제한, 환불 등)엔 손대지 않는다.
     */
    private AiItemJob createPaidJob(Long userId, AiItemJobCreateRequest request) {
        int charge = aiItemFreeEvent ? 0 : aiItemCost;

        if (charge > 0 && userRepository.deductPointsIfSufficient(userId, charge) == 0) {
            throw new BusinessException(ErrorCode.AI_ITEM_INSUFFICIENT_POINT);
        }

        AiItemJob job = aiItemJobRepository.save(AiItemJob.builder()
                .userId(userId)
                .name(request.name())
                .category(request.category())
                .sketchBase64(request.sketchBase64())
                .status(AiJobStatus.PENDING)
                .pointsCharged(charge)
                .build());

        if (charge > 0) {
            int balanceAfter = userRepository.findById(userId).orElseThrow().getPointBalance();
            pointHistoryRepository.save(PointHistory.builder()
                    .userId(userId)
                    .amount(-charge)
                    .type(PointHistoryType.AI_GENERATE)
                    .refId(job.getId())
                    .balanceAfter(balanceAfter)
                    .build());
        }

        return job;
    }

    /**
     * 재생성 — parentJobId가 가리키는 job이 본인 것인지(403), 이미 최상위 결제 job인지(부모의
     * 부모가 있으면 재생성의 재생성이므로 400), 이미 재생성이 만들어졌는지(선체크 400) 확인한다.
     * UNIQUE(parent_job_id) 위반은 동시 요청에 대한 최종 방어선이다(ShopService.purchase와 같은 패턴).
     */
    private AiItemJob createRetryJob(Long userId, AiItemJobCreateRequest request) {
        AiItemJob parent = aiItemJobRepository.findById(request.parentJobId())
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
        if (!parent.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.AI_JOB_FORBIDDEN);
        }
        if (parent.getParentJobId() != null) {
            throw new BusinessException(ErrorCode.AI_ITEM_RETRY_LIMIT_EXCEEDED);
        }
        if (aiItemJobRepository.existsByParentJobId(parent.getId())) {
            throw new BusinessException(ErrorCode.AI_ITEM_RETRY_LIMIT_EXCEEDED);
        }

        try {
            return aiItemJobRepository.save(AiItemJob.builder()
                    .userId(userId)
                    .name(request.name())
                    .category(request.category())
                    .sketchBase64(request.sketchBase64())
                    .status(AiJobStatus.PENDING)
                    .pointsCharged(0)
                    .parentJobId(parent.getId())
                    .build());
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(ErrorCode.AI_ITEM_RETRY_LIMIT_EXCEEDED);
        }
    }

    /** GET /shop/ai-items/{jobId} — 본인 작업만 조회 가능. imageUrl은 저장 여부와 무관하게 job이 직접 들고 있다. */
    public AiItemJobStatusResponse getJob(Long userId, Long jobId) {
        AiItemJob job = aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
        if (!job.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.AI_JOB_FORBIDDEN);
        }

        return new AiItemJobStatusResponse(
                job.getId(), job.getStatus(), job.getItemId(), job.getImageUrl(), job.getErrorMessage());
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
     * POST /internal/ai-jobs/{jobId}/complete — 이미지 업로드 → job.imageUrl 기록 → job DONE.
     * Item 생성·UserItem 지급은 더 이상 여기서 하지 않는다 — 유저가 결과를 보고
     * "저장하기"(POST /shop/ai-items/{jobId}/save)를 눌러야 인벤토리에 들어간다("생성 → 확인 → 저장").
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

        if (aiItemJobRepository.completeWithImage(jobId, imageUrl) == 0) {
            throw new BusinessException(ErrorCode.AI_JOB_INVALID_STATE);
        }

        return new InternalAiJobCompleteResponse(jobId, imageUrl);
    }

    /**
     * POST /shop/ai-items/{jobId}/save — 생성 결과를 확인한 유저가 저장을 확정하면 그제서야
     * Item을 만들고 지급한다. 이미 저장된 job(job.itemId != null)이면 새로 만들지 않고 기존
     * 결과를 그대로 돌려준다(멱등). DONE이 아닌 job은 저장할 결과가 없으므로 400.
     *
     * <p>동시 저장 요청 방지: Item을 먼저 만들고 {@link AiItemJobRepository#attachItem}으로
     * job에 원자적으로 연결한다. 연결에 실패하면(먼저 저장된 요청이 이미 있음) 방금 만든 Item은
     * 아무에게도 지급하지 않고 버리고, 먼저 성공한 쪽의 결과를 돌려준다 — 중복 지급 방지가
     * 핵심이라 고아 Item 하나가 남는 건 감수한다.</p>
     */
    @Transactional
    public AiItemSaveResponse save(Long userId, Long jobId) {
        AiItemJob job = aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
        if (!job.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.AI_JOB_FORBIDDEN);
        }
        if (job.getItemId() != null) {
            return new AiItemSaveResponse(job.getItemId(), job.getImageUrl());
        }
        if (job.getStatus() != AiJobStatus.DONE) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "아직 생성이 완료되지 않은 작업입니다.");
        }

        Item item = itemRepository.save(Item.builder()
                .name(job.getName())
                .category(job.getCategory())
                .itemType(ItemType.AI_CUSTOM)
                .pricePoint(null)
                .imageUrl(job.getImageUrl())
                .creatorId(job.getUserId())
                .active(true)
                .build());

        if (aiItemJobRepository.attachItem(jobId, item.getId()) == 0) {
            AiItemJob winner = aiItemJobRepository.findById(jobId)
                    .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));
            return new AiItemSaveResponse(winner.getItemId(), job.getImageUrl());
        }

        userItemRepository.save(UserItem.builder().userId(userId).itemId(item.getId()).build());
        return new AiItemSaveResponse(item.getId(), job.getImageUrl());
    }

    /**
     * POST /internal/ai-jobs/{jobId}/fail — job을 FAILED로 바꾸고 errorMessage 기록.
     * pointsCharged가 있으면(이 job이 결제를 차감한 job이면) 그만큼 환불한다.
     *
     * <p>중복 환불 방지: {@link AiItemJobRepository#fail}은 PROCESSING → FAILED 조건부 UPDATE라
     * 정확히 한 번만 성공한다(이미 FAILED/DONE인 job에 재호출하면 영향행 0 → AI_JOB_INVALID_STATE).
     * 그래서 별도의 "환불 완료" 플래그 없이, 이 UPDATE가 실제로 성공했을 때만 환불하면 충분하다.</p>
     */
    @Transactional
    public void fail(Long jobId, String message) {
        AiItemJob job = aiItemJobRepository.findById(jobId)
                .orElseThrow(() -> new BusinessException(ErrorCode.AI_JOB_NOT_FOUND));

        if (aiItemJobRepository.fail(jobId, message) == 0) {
            throw new BusinessException(ErrorCode.AI_JOB_INVALID_STATE);
        }

        if (job.getPointsCharged() != null && job.getPointsCharged() > 0) {
            refundPoints(job.getUserId(), job.getId(), job.getPointsCharged());
        }
    }

    private void refundPoints(Long userId, Long jobId, int amount) {
        userRepository.addPoints(userId, amount);
        int balanceAfter = userRepository.findById(userId).orElseThrow().getPointBalance();
        pointHistoryRepository.save(PointHistory.builder()
                .userId(userId)
                .amount(amount)
                .type(PointHistoryType.AI_GENERATE_REFUND)
                .refId(jobId)
                .balanceAfter(balanceAfter)
                .build());
    }

    private byte[] decodeBase64(String base64) {
        try {
            return Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "잘못된 base64 인코딩입니다.");
        }
    }
}
