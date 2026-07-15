package ssafy.a706.backend.auth.principal;

public record GuestPrincipal(String userId, String displayName) implements AuthPrincipal {

    @Override
    public boolean isGuest() {
        return true;
    }
}
