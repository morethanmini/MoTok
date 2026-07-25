package ssafy.a706.backend.report;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.report.dto.ChatReportCreateRequest;
import ssafy.a706.backend.report.dto.ChatReportCreateResponse;

/** 채팅 신고 접수(-132). 관리자 조회·처리는 ChatReportAdminController(-133). */
@RestController
@RequestMapping("/api/v1/chat-reports")
@RequiredArgsConstructor
public class ChatReportController {

    private final ChatReportService chatReportService;

    @PostMapping
    public ResponseEntity<ApiResponse<ChatReportCreateResponse>> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ChatReportCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok("신고 접수 완료", chatReportService.create(request, principal)));
    }
}
