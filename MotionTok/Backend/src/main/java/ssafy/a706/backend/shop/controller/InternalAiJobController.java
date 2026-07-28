package ssafy.a706.backend.shop.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobCompleteRequest;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobCompleteResponse;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobFailRequest;
import ssafy.a706.backend.shop.controller.dto.InternalAiJobResponse;
import ssafy.a706.backend.shop.service.AiItemJobService;

/**
 * GPU 워커 전용 폴링 API (-102). GPU 서버는 외부에서 호출할 수 없어 워커가 이쪽으로 주기적으로
 * 물어보는 구조다. 사용자 인증(JWT)이 아니라 공유 시크릿(X-Internal-Key)으로 보호한다 —
 * SecurityConfig는 이 경로를 permitAll로 열어 두고, 실제 방어는 InternalApiKeyFilter가 한다.
 */
@RestController
@RequestMapping("/api/internal/ai-jobs")
@RequiredArgsConstructor
public class InternalAiJobController {

    private final AiItemJobService aiItemJobService;

    /** GET /internal/ai-jobs/next — 대기 중인 작업이 없으면 204. */
    @GetMapping("/next")
    public ResponseEntity<InternalAiJobResponse> next() {
        return aiItemJobService.claimNext()
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** POST /internal/ai-jobs/{jobId}/complete — 이미지 업로드·Item 생성·지급까지 한 번에 처리. */
    @PostMapping("/{jobId}/complete")
    public InternalAiJobCompleteResponse complete(@PathVariable Long jobId,
                                                  @Valid @RequestBody InternalAiJobCompleteRequest request) {
        return aiItemJobService.complete(jobId, request.imageBase64());
    }

    /** POST /internal/ai-jobs/{jobId}/fail — job을 FAILED로 기록. */
    @PostMapping("/{jobId}/fail")
    public void fail(@PathVariable Long jobId, @Valid @RequestBody InternalAiJobFailRequest request) {
        aiItemJobService.fail(jobId, request.message());
    }
}
