package ssafy.a706.backend.storage;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 업로드 정책 규칙 고정. presigned 방식은 서버가 막을 수 있는 지점이 한정돼 있어서,
 * 그 지점들이 실제로 막고 있는지를 테스트로 못 박아 둔다.
 */
class UploadPurposeTest {

    @Test
    @DisplayName("key는 서버가 만들고 본인 prefix로 시작한다 — 남의 경로에 쓸 수 없다")
    void keyIsScopedToUser() {
        String key = UploadPurpose.AVATAR.newKey(7L, "image/png");

        assertThat(key).startsWith("public/avatars/7/").endsWith(".png");
        assertThat(UploadPurpose.AVATAR.owns(key, 7L)).isTrue();
        assertThat(UploadPurpose.AVATAR.owns(key, 8L)).isFalse();
    }

    @Test
    @DisplayName("남의 key나 임의 문자열은 소유권 검증을 통과하지 못한다")
    void rejectsForeignKeys() {
        assertThat(UploadPurpose.AVATAR.owns("public/avatars/999/x.png", 7L)).isFalse();
        assertThat(UploadPurpose.AVATAR.owns("../../etc/passwd", 7L)).isFalse();
        assertThat(UploadPurpose.AVATAR.owns("", 7L)).isFalse();
        assertThat(UploadPurpose.AVATAR.owns(null, 7L)).isFalse();
    }

    @Test
    @DisplayName("prefix가 다른 사용자와 겹치지 않는다 — 7 과 77 이 같은 접두어를 공유하면 안 된다")
    void prefixDoesNotBleedBetweenUsers() {
        // 슬래시가 없으면 startsWith("public/avatars/7") 가 사용자 77 의 key 도 통과시킨다.
        String otherKey = UploadPurpose.AVATAR.newKey(77L, "image/png");

        assertThat(UploadPurpose.AVATAR.owns(otherKey, 7L)).isFalse();
    }

    @Test
    @DisplayName("확장자는 클라이언트 파일명이 아니라 contentType에서 뽑는다")
    void extensionComesFromContentType() {
        assertThat(UploadPurpose.AVATAR.newKey(1L, "image/jpeg")).endsWith(".jpg");
        assertThat(UploadPurpose.AVATAR.newKey(1L, "image/webp")).endsWith(".webp");
        assertThat(UploadPurpose.SONG.newKey(1L, "audio/mpeg")).endsWith(".mp3");
    }

    @Test
    @DisplayName("허용하지 않는 MIME은 거부한다")
    void rejectsUnsupportedContentType() {
        assertThatThrownBy(() -> UploadPurpose.AVATAR.validate("image/gif", 1024))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.UPLOAD_UNSUPPORTED_TYPE);

        // 아바타에 음원을 올리려는 시도 — 용도별 허용 목록이 갈려 있어야 막힌다
        assertThatThrownBy(() -> UploadPurpose.AVATAR.validate("audio/mpeg", 1024))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @DisplayName("용량 상한과 0바이트를 거부한다")
    void rejectsBadContentLength() {
        assertThatThrownBy(() -> UploadPurpose.AVATAR.validate("image/png", UploadPurpose.AVATAR.maxBytes() + 1))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.UPLOAD_TOO_LARGE);

        assertThatThrownBy(() -> UploadPurpose.AVATAR.validate("image/png", 0))
                .isInstanceOf(BusinessException.class);

        // 경계값은 통과해야 한다
        UploadPurpose.AVATAR.validate("image/png", UploadPurpose.AVATAR.maxBytes());
    }

    @Test
    @DisplayName("음원은 사용자별 경로가 아니고 관리자 전용이다")
    void songIsAdminOnlyAndNotUserScoped() {
        assertThat(UploadPurpose.SONG.prefixFor(7L)).isEqualTo("public/songs/");
        assertThat(UploadPurpose.SONG.isAdminOnly()).isTrue();
        assertThat(UploadPurpose.AVATAR.isAdminOnly()).isFalse();
    }

    @Test
    @DisplayName("AI 아이템은 서버 생성물이라 클라이언트 presign 대상이 아니다")
    void aiItemIsNotPresignable() {
        assertThat(UploadPurpose.AI_ITEM.isPresignable()).isFalse();
        assertThat(UploadPurpose.AVATAR.isPresignable()).isTrue();
        assertThat(UploadPurpose.SONG.isPresignable()).isTrue();
    }

    @Test
    @DisplayName("모든 용도의 key는 public/ 아래다 — 공개 읽기 정책이 걸린 prefix와 일치해야 한다")
    void allKeysLiveUnderPublicPrefix() {
        for (UploadPurpose purpose : UploadPurpose.values()) {
            assertThat(purpose.prefixFor(1L)).startsWith("public/");
        }
    }
}
