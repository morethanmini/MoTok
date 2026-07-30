package ssafy.a706.backend.user.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.crypto.password.PasswordEncoder;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.oauth.repository.OauthAccountRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.storage.StorageService;
import ssafy.a706.backend.storage.UploadPurpose;
import ssafy.a706.backend.user.controller.dto.UpdateAvatarRequest;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 프로필 사진 확정 규칙.
 *
 * <p>업로드가 서버를 거치지 않으므로 이 서비스가 <b>마지막 방어선</b>이다. 여기서 지키는 것:
 * 소유권·존재 확인을 반드시 통과시킬 것, 확인에 실패하면 아무것도 저장하지 말 것,
 * 그리고 이전 사진 정리가 본 흐름을 망가뜨리지 않을 것.</p>
 */
class UserAvatarServiceTest {

    private static final long USER_ID = 7L;
    private static final String KEY = "public/avatars/7/abc.png";
    private static final String URL = "http://localhost:9000/motok-local/" + KEY;

    private final UserRepository userRepository = mock(UserRepository.class);
    private final StorageService storageService = mock(StorageService.class);

    private final UserService service = new UserService(
            userRepository,
            mock(PointHistoryRepository.class),
            mock(PasswordEncoder.class),
            mock(ssafy.a706.backend.auth.session.SessionTerminator.class),
            mock(OauthAccountRepository.class),
            mock(OauthClientResolver.class),
            mock(RejoinPolicy.class),
            storageService,
            mock(ssafy.a706.backend.conntime.service.ConnectTimeService.class));

    private User user() {
        User u = User.builder().email("me@motok.com").passwordHash("x").nickname("나").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(u));
        return u;
    }

    /** 업로드한 사진을 확정하는 요청. */
    private static UpdateAvatarRequest uploaded(String key) {
        return new UpdateAvatarRequest(key, null);
    }

    /** 기본 프로필 아이콘을 고르는 요청. */
    private static UpdateAvatarRequest preset(String preset) {
        return new UpdateAvatarRequest(null, preset);
    }

    @Test
    @DisplayName("key를 확정하면 서버가 계산한 공개 URL이 저장된다 — 클라이언트가 준 URL이 아니다")
    void savesServerComputedUrl() {
        User u = user();
        given(storageService.confirmOwned(UploadPurpose.AVATAR, USER_ID, KEY)).willReturn(URL);

        UserProfileResponse res = service.updateAvatar(USER_ID, uploaded(KEY));

        assertThat(u.getAvatarUrl()).isEqualTo(URL);
        assertThat(res.avatarUrl()).isEqualTo(URL);
        verify(storageService).confirmOwned(UploadPurpose.AVATAR, USER_ID, KEY);
    }

    @Test
    @DisplayName("소유권·존재 검증에 실패하면 아무것도 저장하지 않는다")
    void doesNotSaveWhenConfirmFails() {
        User u = user();
        willThrow(new BusinessException(ErrorCode.UPLOAD_KEY_FORBIDDEN))
                .given(storageService).confirmOwned(any(), anyLong(), any());

        assertThatThrownBy(() -> service.updateAvatar(USER_ID, uploaded("public/avatars/999/x.png")))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.UPLOAD_KEY_FORBIDDEN);

        assertThat(u.getAvatarUrl()).isNull();
    }

    @Test
    @DisplayName("key가 null이면 기본 아바타로 되돌린다 — 스토리지를 호출하지 않는다")
    void nullKeyResetsToDefault() {
        User u = user();
        u.changeAvatarUrl(URL);

        service.updateAvatar(USER_ID, uploaded(null));

        assertThat(u.getAvatarUrl()).isNull();
        verify(storageService, never()).confirmOwned(any(), anyLong(), any());
    }

    @Test
    @DisplayName("빈 문자열도 null과 같이 다룬다 — 폼에서 빈 값이 올 수 있다")
    void blankKeyResetsToDefault() {
        User u = user();
        u.changeAvatarUrl(URL);

        service.updateAvatar(USER_ID, uploaded("   "));

        assertThat(u.getAvatarUrl()).isNull();
        verify(storageService, never()).confirmOwned(any(), anyLong(), any());
    }

    @Test
    @DisplayName("사진을 바꾸면 이전 객체를 지운다 (트랜잭션이 없으면 즉시)")
    void deletesPreviousObject() {
        User u = user();
        u.changeAvatarUrl(URL);
        String newKey = "public/avatars/7/new.png";
        String newUrl = "http://localhost:9000/motok-local/" + newKey;
        given(storageService.confirmOwned(UploadPurpose.AVATAR, USER_ID, newKey)).willReturn(newUrl);
        given(storageService.keyFromPublicUrl(URL)).willReturn(KEY);

        service.updateAvatar(USER_ID, uploaded(newKey));

        assertThat(u.getAvatarUrl()).isEqualTo(newUrl);
        verify(storageService).deleteQuietly(KEY);
    }

    @Test
    @DisplayName("이전 사진이 없으면 삭제를 시도하지 않는다")
    void noDeleteWhenNoPreviousAvatar() {
        user();
        given(storageService.confirmOwned(UploadPurpose.AVATAR, USER_ID, KEY)).willReturn(URL);
        given(storageService.keyFromPublicUrl(eq(null))).willReturn(null);

        service.updateAvatar(USER_ID, uploaded(KEY));

        verify(storageService, never()).deleteQuietly(any());
    }

    @Test
    @DisplayName("기본 프로필 아이콘은 서버가 정적 경로를 붙여 저장한다 — 스토리지를 거치지 않는다")
    void presetSavesStaticPath() {
        User u = user();

        service.updateAvatar(USER_ID, preset("4_cat"));

        assertThat(u.getAvatarUrl()).isEqualTo("/assets/icons/profile/4_cat.png");
        verify(storageService, never()).confirmOwned(any(), anyLong(), any());
    }

    @Test
    @DisplayName("기본 프로필로 바꿔도 이전에 올린 사진은 S3에서 지운다")
    void presetDeletesPreviousUpload() {
        User u = user();
        u.changeAvatarUrl(URL);
        given(storageService.keyFromPublicUrl(URL)).willReturn(KEY);

        service.updateAvatar(USER_ID, preset("10_bunny"));

        assertThat(u.getAvatarUrl()).isEqualTo("/assets/icons/profile/10_bunny.png");
        verify(storageService).deleteQuietly(KEY);
    }

    /**
     * preset은 그대로 다른 사용자 화면의 img src가 된다(친구 목록). 형식 검사가 방어선이라
     * 경로 탈출·외부 URL이 통과하지 않는지 확인한다.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "../../etc/passwd",
            "4_cat.png",                       // 확장자는 서버가 붙인다
            "https://evil.example.com/x.png",
            "4_cat/../../../secret",
            "<script>",
            "999_toolongnumberprefix",
    })
    @DisplayName("형식에 맞지 않는 preset은 저장하지 않는다")
    void rejectsMalformedPreset(String malformed) {
        User u = user();

        assertThatThrownBy(() -> service.updateAvatar(USER_ID, preset(malformed)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_INPUT);

        assertThat(u.getAvatarUrl()).isNull();
    }

    @Test
    @DisplayName("key와 preset을 동시에 주면 거절한다 — 어느 쪽이 이겼는지 화면에서 알 수 없다")
    void rejectsBothKeyAndPreset() {
        User u = user();

        assertThatThrownBy(() -> service.updateAvatar(USER_ID, new UpdateAvatarRequest(KEY, "4_cat")))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.INVALID_INPUT);

        assertThat(u.getAvatarUrl()).isNull();
        verify(storageService, never()).confirmOwned(any(), anyLong(), any());
    }

    @Test
    @DisplayName("기본 프로필을 지우면 아바타가 없는 상태로 되돌아간다 — 지울 S3 객체도 없다")
    void removingPresetTouchesNoStorage() {
        User u = user();
        u.changeAvatarUrl("/assets/icons/profile/4_cat.png");
        given(storageService.keyFromPublicUrl("/assets/icons/profile/4_cat.png")).willReturn(null);

        service.updateAvatar(USER_ID, uploaded(null));

        assertThat(u.getAvatarUrl()).isNull();
        verify(storageService, never()).deleteQuietly(any());
    }
}
