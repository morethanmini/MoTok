package ssafy.a706.backend.report;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.report.dto.UserReportCreateRequest;
import ssafy.a706.backend.report.dto.UserReportCreateResponse;

/**
 * 사용자 신고 접수(-112, 명세 §7 POST /reports).
 *
 * <p>{@code /api/reports}는 래핑 없이 DTO를 그대로 돌려주는 계열이다(§1·§2와 같은 규약).
 * 게스트 차단은 SecurityConfig(/api/reports/** hasRole USER)가 필터 단에서 처리하므로
 * 여기 주체는 항상 회원이다.</p>
 */
@RestController
@RequestMapping("/api/reports")
@RequiredArgsConstructor
public class UserReportController {

    private final UserReportService userReportService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UserReportCreateResponse create(@AuthenticationPrincipal MemberPrincipal principal,
                                           @Valid @RequestBody UserReportCreateRequest request) {
        return userReportService.create(principal.id(), request);
    }
}
