package ssafy.a706.backend.storage;

import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 업로드 정책의 <b>단일 출처</b> — 허용 MIME · 최대 용량 · key prefix · 요구 권한을 한 곳에 모은다.
 *
 * <p>기능마다 S3 코드를 흩뿌리면 "아바타는 2MB인데 아이템은 왜 5MB지" 같은 불일치가 생기고,
 * 정책이 세 군데로 갈라진 뒤에는 되돌리기 어렵다. 새 용도가 생기면 여기에 줄 하나만 추가한다.</p>
 *
 * <p><b>presignable</b> — 클라이언트가 presigned URL을 받아 직접 올릴 수 있는지.
 * AI 아이템은 <b>서버가 이미지를 생성</b>하므로(사용자 업로드가 아님) 서버가 직접 PUT한다.
 * 그래도 enum에 두는 이유는 key prefix·MIME 정책이 필요한 건 동일하기 때문이다 —
 * 정책은 공유하고 진입 경로만 다르다.</p>
 */
public enum UploadPurpose {

    /** 프로필 아바타 — 본인 경로에만 올릴 수 있다. */
    AVATAR("public/avatars/", true, true, false,
            Set.of("image/png", "image/jpeg", "image/webp"), 2 * 1024 * 1024),

    /** AI 생성 아이템 이미지 — 서버 생성물이라 presign 대상이 아니다. */
    AI_ITEM("public/items/", true, false, false,
            Set.of("image/png", "image/webp"), 2 * 1024 * 1024),

    /** 리듬게임 음원 — 사용자별 경로가 아니고 관리자만 올린다. */
    SONG("public/songs/", false, true, true,
            Set.of("audio/mpeg", "audio/mp4", "audio/ogg"), 20 * 1024 * 1024);

    /**
     * MIME → 확장자. <b>클라이언트가 보낸 파일명은 쓰지 않는다</b> —
     * 파일명에는 {@code ../}나 제어문자가 섞일 수 있고, 확장자와 실제 타입이 다를 수도 있다.
     * 서명에 포함되는 contentType이 유일한 신뢰 가능한 출처다.
     */
    private static final Map<String, String> EXTENSIONS = Map.of(
            "image/png", "png",
            "image/jpeg", "jpg",
            "image/webp", "webp",
            "audio/mpeg", "mp3",
            "audio/mp4", "m4a",
            "audio/ogg", "ogg"
    );

    private final String prefix;
    private final boolean userScoped;
    private final boolean presignable;
    private final boolean adminOnly;
    private final Set<String> allowedContentTypes;
    private final long maxBytes;

    UploadPurpose(String prefix, boolean userScoped, boolean presignable, boolean adminOnly,
                  Set<String> allowedContentTypes, long maxBytes) {
        this.prefix = prefix;
        this.userScoped = userScoped;
        this.presignable = presignable;
        this.adminOnly = adminOnly;
        this.allowedContentTypes = allowedContentTypes;
        this.maxBytes = maxBytes;
    }

    public boolean isPresignable() {
        return presignable;
    }

    public boolean isAdminOnly() {
        return adminOnly;
    }

    public long maxBytes() {
        return maxBytes;
    }

    /**
     * 이 사용자가 이 용도로 쓸 수 있는 key prefix.
     * userScoped면 {@code public/avatars/{userId}/}, 아니면 {@code public/songs/}.
     */
    public String prefixFor(Long userId) {
        return userScoped ? prefix + userId + "/" : prefix;
    }

    /**
     * 업로드할 오브젝트 key를 <b>서버가</b> 만든다.
     *
     * <p>클라이언트가 key를 정하게 하면 {@code public/avatars/999/x.png}를 요청해
     * <b>남의 아바타를 덮어쓸 수 있다.</b> 파일명도 서버가 UUID로 정하므로 경로 조작 여지가 없다.</p>
     */
    public String newKey(Long userId, String contentType) {
        String ext = EXTENSIONS.get(contentType);
        if (ext == null) {
            throw new BusinessException(ErrorCode.UPLOAD_UNSUPPORTED_TYPE);
        }
        return prefixFor(userId) + UUID.randomUUID() + "." + ext;
    }

    /**
     * 업로드가 끝난 뒤 클라이언트가 알려 준 key가 <b>본인 것인지</b> 확인한다.
     * 이걸 빼면 남의 key나 아무 문자열이나 자기 프로필에 박을 수 있다.
     */
    public boolean owns(String key, Long userId) {
        return key != null && key.startsWith(prefixFor(userId));
    }

    /** 허용 MIME·용량 검사. contentType/contentLength는 서명에 포함되므로 S3도 같은 값을 강제한다. */
    public void validate(String contentType, long contentLength) {
        if (contentType == null || !allowedContentTypes.contains(contentType)) {
            throw new BusinessException(ErrorCode.UPLOAD_UNSUPPORTED_TYPE);
        }
        if (contentLength <= 0 || contentLength > maxBytes) {
            throw new BusinessException(ErrorCode.UPLOAD_TOO_LARGE);
        }
    }
}
