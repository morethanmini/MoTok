package ssafy.a706.backend.auth.controller.dto;

import java.time.Duration;

/**
 * 토큰 발급 결과 — 응답 본문(TokenResponse)과 쿠키로 나갈 Refresh 토큰을 갈라서 넘긴다.
 * 서비스는 "무엇을 발급했는지"만 정하고, 그걸 헤더에 실을지는 컨트롤러가 판단한다.
 *
 * @param refreshToken null이면 <b>쿠키를 건드리지 않는다</b> — 회전이 일어나지 않은 갱신(grace)이라
 *                     브라우저가 이미 들고 있는 새 쿠키를 옛 값으로 되돌리면 안 되기 때문이다.
 */
public record IssuedTokens(
        TokenResponse body,
        String refreshToken,
        Duration refreshTtl,
        boolean persistent
) {
    /** 회전 없이 액세스 토큰만 새로 준 경우. */
    public static IssuedTokens accessOnly(TokenResponse body) {
        return new IssuedTokens(body, null, null, false);
    }
}
