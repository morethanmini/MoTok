package ssafy.a706.backend.auth.principal;

public record MemberPrincipal(String userId, String displayName) implements AuthPrincipal {

    @Override
    public boolean isGuest() {
        return false;
    }
}
