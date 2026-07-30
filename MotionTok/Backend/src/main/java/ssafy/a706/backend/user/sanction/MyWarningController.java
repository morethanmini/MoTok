package ssafy.a706.backend.user.sanction;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.user.sanction.dto.WarningNoticeResponse;

import java.util.List;

/**
 * 내가 받은 경고 — 제재 도메인에서 <b>당사자가 부르는 유일한</b> 엔드포인트다.
 *
 * <p>정지·영구정지에는 이런 경로가 없다. 그쪽은 접근 자체가 막혀 조회에 닿지 못하고, 안내는
 * 403 응답과 웹소켓 종료 프레임이 대신한다. 경고만 접근을 허용한 채 전달해야 하므로 창구가 필요하다.</p>
 *
 * <p><b>왜 조회가 필요한가.</b> 개인 큐 푸시는 그 순간 접속 중이 아니면 조용히 폐기된다
 * ({@code UserNotifier} 주석). 경고는 읽히는 것이 곧 제재의 실행이라 놓치면 아무 일도 없던 것과
 * 같으므로, 클라이언트가 로그인·재연결마다 이 스냅샷으로 못 받은 것을 메운다.</p>
 *
 * <p>회원 전용이다 — 게스트는 RDB에 계정이 없어 제재 대상이 아니다(SecurityConfig가 막는다).</p>
 *
 * <p><b>응답을 ApiResponse로 감싸지 않는다.</b> {@code /api/users/**}는 raw DTO 규약이고
 * {@code /api/v1/**}만 래핑한다 — 같은 prefix 안에서 규약이 갈리면 프론트가 경로마다
 * 클라이언트를 골라야 한다(http.ts 상단 주석).</p>
 */
@RestController
@RequestMapping("/api/users/me/warnings")
@RequiredArgsConstructor
public class MyWarningController {

    private final UserSanctionService userSanctionService;

    /** GET /users/me/warnings — 아직 확인하지 않은 경고(오래된 것부터). 없으면 빈 배열. */
    @GetMapping
    public List<WarningNoticeResponse> unacknowledged(@AuthenticationPrincipal MemberPrincipal member) {
        return userSanctionService.unacknowledgedWarnings(member.id());
    }

    /**
     * POST /users/me/warnings/{warningId}/ack — 확인 처리.
     *
     * <p>멱등이다 — 여러 탭에서 눌러도 처음 확인 시각을 유지한다. 없는 id나 남의 경고는 404이고,
     * 그 둘을 구분해 알려 주지 않는다(존재 여부를 캐낼 여지를 없앤다).</p>
     */
    @PostMapping("/{warningId}/ack")
    public void acknowledge(@AuthenticationPrincipal MemberPrincipal member,
                            @PathVariable Long warningId) {
        userSanctionService.acknowledgeWarning(member.id(), warningId);
    }
}
