package ssafy.a706.backend.storage.controller.dto;

import ssafy.a706.backend.storage.StorageService;

import java.util.Map;

/**
 * presigned URL 응답.
 *
 * <p>클라이언트 흐름:</p>
 * <ol>
 *   <li>{@code uploadUrl}로 {@code PUT} — body는 파일 원본, 헤더는 {@code requiredHeaders} 그대로</li>
 *   <li>성공하면 {@code key}를 해당 도메인 API에 알려 준다(예: {@code PATCH /users/me/avatar})</li>
 * </ol>
 *
 * <p>{@code requiredHeaders}를 서버가 내려주는 이유 — 서명된 헤더를 브라우저가 그대로 보내지 않으면
 * 서명 불일치로 거부된다. SDK 버전에 따라 서명 대상이 달라질 수 있어 프론트에 상수로 박지 않는다.</p>
 *
 * <p>{@code publicUrl}은 업로드가 <b>성공했을 때</b> 그 객체가 갖게 될 주소다. 미리 알려 주는 건
 * 낙관적 프리뷰용이고, DB에 저장되는 값은 서버가 소유권·존재를 확인한 뒤 다시 계산한다.</p>
 */
public record PresignUploadResponse(
        String uploadUrl,
        String key,
        String publicUrl,
        long expiresInSeconds,
        Map<String, String> requiredHeaders
) {

    public static PresignUploadResponse from(StorageService.PresignResult r) {
        return new PresignUploadResponse(
                r.uploadUrl(), r.key(), r.publicUrl(), r.expiresInSeconds(), r.requiredHeaders());
    }
}
