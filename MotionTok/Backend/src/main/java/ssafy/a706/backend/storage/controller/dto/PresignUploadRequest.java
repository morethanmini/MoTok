package ssafy.a706.backend.storage.controller.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import ssafy.a706.backend.storage.UploadPurpose;

/**
 * 업로드용 presigned URL 요청.
 *
 * <p><b>key(파일명)를 받지 않는다</b> — 서버가 purpose와 인증된 userId로 조립한다.
 * 클라이언트가 정하게 하면 남의 경로에 쓸 수 있고, 파일명에 {@code ../}가 섞일 수도 있다.</p>
 *
 * <p>contentType·contentLength는 서명에 포함되므로 <b>선언과 다르게 올리면 S3가 거부한다.</b>
 * 즉 이 값들은 단순 참고용이 아니라 실제 제한으로 동작한다.</p>
 */
public record PresignUploadRequest(
        @NotNull UploadPurpose purpose,
        @NotBlank String contentType,
        @Positive long contentLength
) {
}
