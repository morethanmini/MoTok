package ssafy.a706.backend.auth.store;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * Refresh 토큰은 Redis에 원문이 아니라 해시로 남는다 —
 * 저장소가 새더라도 그 값만으로는 남의 세션을 되살릴 수 없어야 한다.
 * 회전·재사용 판정 자체는 원자성 때문에 Lua 안에서 도므로, 여기서는 스크립트에 넘기는 값과
 * 반환 코드 → Verdict 매핑을 지킨다.
 */
class RefreshTokenStoreTest {

    private static final long USER_ID = 42L;
    private static final String KEY = "auth:refresh:42";
    private static final String TOKEN = "eyJhbGciOiJIUzI1NiJ9.refresh-v1.signature";
    private static final String NEXT = "eyJhbGciOiJIUzI1NiJ9.refresh-v2.signature";
    private static final Duration TTL = Duration.ofDays(14);

    /** SHA-256 hex 64자 — 원문이 그대로 새어 나가지 않았다는 최소 확인. */
    private static final String HEX_64 = "[0-9a-f]{64}";

    private final HashOperations<String, Object, Object> hashOps = mock(HashOperations.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final RefreshTokenStore store = new RefreshTokenStore(redis);

    @BeforeEach
    void stubOps() {
        given(redis.<Object, Object>opsForHash()).willReturn(hashOps);
    }

    private static final String SESSION_ID = "sid-42-current";

    @Test
    @DisplayName("저장되는 값은 토큰 원문이 아니라 SHA-256 해시다")
    void storesHashInsteadOfRawToken() {
        store.save(USER_ID, TOKEN, TTL, true, SESSION_ID);

        ArgumentCaptor<Object> stored = ArgumentCaptor.forClass(Object.class);
        verify(hashOps).put(eq(KEY), eq("hash"), stored.capture());
        assertThat(stored.getValue().toString()).isNotEqualTo(TOKEN).matches(HEX_64);
    }

    @Test
    @DisplayName("새 세션을 열 때 옛 회전 기록까지 지운다 — 옛 직전 토큰이 grace로 되살아나면 안 된다")
    void dropsPreviousRotationOnFreshLogin() {
        store.save(USER_ID, TOKEN, TTL, false, SESSION_ID);

        verify(redis).delete(KEY);
        verify(hashOps).put(KEY, "persistent", "0");
        verify(hashOps).put(KEY, "sid", SESSION_ID);
        verify(redis).expire(KEY, TTL);
    }

    @Test
    @DisplayName("회전 요청은 원문이 아니라 해시만 스크립트로 넘긴다 — sid는 가드 대조용으로 함께 간다")
    void passesOnlyHashesToScript() {
        stubScript(1L);

        store.rotate(USER_ID, TOKEN, NEXT, TTL, SESSION_ID);

        ArgumentCaptor<Object> arg = ArgumentCaptor.forClass(Object.class);
        verify(redis).execute(any(RedisScript.class), eq(List.of(KEY)),
                arg.capture(), arg.capture(), arg.capture(), arg.capture(), arg.capture(), arg.capture());

        List<Object> passed = arg.getAllValues();
        assertThat(passed.get(0).toString()).isNotEqualTo(TOKEN).matches(HEX_64);
        assertThat(passed.get(1).toString()).isNotEqualTo(NEXT).matches(HEX_64);
        // ARGV[4](grace 만료)는 ARGV[3](현재 시각)보다 딱 GRACE 만큼 뒤여야 한다.
        long now = Long.parseLong(passed.get(2).toString());
        assertThat(Long.parseLong(passed.get(3).toString()) - now)
                .isEqualTo(RefreshTokenStore.GRACE.toMillis());
        assertThat(passed.get(4)).isEqualTo(String.valueOf(TTL.toMillis()));
        assertThat(passed.get(5)).isEqualTo(SESSION_ID);
    }

    @Test
    @DisplayName("sid 없는 구 토큰은 빈 문자열로 넘긴다 — Lua에서 nil 비교가 터지면 안 된다")
    void passesEmptyStringForLegacyTokenWithoutSid() {
        stubScript(0L);

        store.rotate(USER_ID, TOKEN, NEXT, TTL, null);

        ArgumentCaptor<Object> arg = ArgumentCaptor.forClass(Object.class);
        verify(redis).execute(any(RedisScript.class), eq(List.of(KEY)),
                arg.capture(), arg.capture(), arg.capture(), arg.capture(), arg.capture(), arg.capture());
        assertThat(arg.getAllValues().get(5)).isEqualTo("");
    }

    @Test
    @DisplayName("스크립트 반환 코드를 판정으로 옮긴다")
    void mapsScriptCodeToVerdict() {
        assertThat(rotateReturning(0L)).isEqualTo(RefreshTokenStore.Verdict.NONE);
        assertThat(rotateReturning(1L)).isEqualTo(RefreshTokenStore.Verdict.ROTATED);
        assertThat(rotateReturning(2L)).isEqualTo(RefreshTokenStore.Verdict.GRACE);
        assertThat(rotateReturning(3L)).isEqualTo(RefreshTokenStore.Verdict.REUSED);
    }

    @Test
    @DisplayName("키가 없어 스크립트가 아무것도 돌려주지 않으면 세션 없음으로 본다")
    void treatsNullResultAsNone() {
        assertThat(rotateReturning(null)).isEqualTo(RefreshTokenStore.Verdict.NONE);
    }

    @Test
    @DisplayName("rememberMe 여부를 읽어 회전 시 쿠키 수명을 유지한다")
    void readsPersistentFlag() {
        given(hashOps.get(KEY, "persistent")).willReturn("1");
        assertThat(store.isPersistent(USER_ID)).isTrue();

        given(hashOps.get(KEY, "persistent")).willReturn("0");
        assertThat(store.isPersistent(USER_ID)).isFalse();

        given(hashOps.get(KEY, "persistent")).willReturn(null);
        assertThat(store.isPersistent(USER_ID)).isFalse();
    }

    @Test
    @DisplayName("현재 세션의 sid를 읽는다 — 밀어내기·로그아웃이 폐기할 대상을 여기서 찾는다")
    void readsSessionId() {
        given(hashOps.get(KEY, "sid")).willReturn(SESSION_ID);
        assertThat(store.sessionId(USER_ID)).isEqualTo(SESSION_ID);

        given(hashOps.get(KEY, "sid")).willReturn(null);
        assertThat(store.sessionId(USER_ID)).isNull();
    }

    @Test
    @DisplayName("구 포맷(평문 String) 키의 WRONGTYPE은 sid 없음으로 취급한다 — 로그인이 막히면 안 된다")
    void treatsLegacyStringKeyAsMissingSid() {
        given(hashOps.get(KEY, "sid")).willThrow(new RedisSystemException("Error in execution",
                new RuntimeException("WRONGTYPE Operation against a key holding the wrong kind of value")));

        assertThat(store.sessionId(USER_ID)).isNull();
    }

    private void stubScript(Long code) {
        given(redis.execute(any(RedisScript.class), anyList(), any(), any(), any(), any(), any(), any()))
                .willReturn(code);
    }

    private RefreshTokenStore.Verdict rotateReturning(Long code) {
        stubScript(code);
        return store.rotate(USER_ID, TOKEN, NEXT, TTL, SESSION_ID);
    }
}
