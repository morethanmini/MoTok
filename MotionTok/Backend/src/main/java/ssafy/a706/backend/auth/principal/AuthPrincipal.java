package ssafy.a706.backend.auth.principal;

import org.springframework.security.core.AuthenticatedPrincipal;

/**
 * 인증 주체 공통 인터페이스. 회원(MemberPrincipal)과 게스트(GuestPrincipal)가 구현한다.
 * - userId: 회원은 로그인 아이디, 게스트는 guest-xxxx 식별자
 * - displayName: 화면 표시명(닉네임)
 */
public interface AuthPrincipal extends AuthenticatedPrincipal {

    String userId();

    String displayName();

    boolean isGuest();

    /**
     * STOMP user destination(/user/queue/*) 라우팅 키.
     * Authentication.getName()이 이 값을 쓰므로 participantId(userId)와 반드시 일치해야 한다.
     * 이게 없으면 getName()이 record의 toString()으로 떨어져 개인 메시지 라우팅이 조용히 실패한다.
     * (전달 경로 상세는 signal/SignalService 주석 참고)
     */
    @Override
    default String getName() {
        return userId();
    }
}
