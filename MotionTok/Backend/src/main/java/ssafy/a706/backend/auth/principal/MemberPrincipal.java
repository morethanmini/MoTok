package ssafy.a706.backend.auth.principal;

/**
 * 회원 인증 주체. id는 USER 테이블 PK다.
 * userId()는 방 참가자 키(Redis playerKey u:{id}) 용도로 id의 문자열 표현을 돌려준다.
 */
public record MemberPrincipal(Long id, String displayName) implements AuthPrincipal {

    @Override
    public String userId() {
        return String.valueOf(id);
    }

    @Override
    public boolean isGuest() {
        return false;
    }
}
