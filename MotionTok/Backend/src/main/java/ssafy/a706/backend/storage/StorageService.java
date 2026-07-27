package ssafy.a706.backend.storage;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.awscore.exception.AwsServiceException;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 오브젝트 스토리지 접근 — presigned URL 발급 · 공개 URL 계산 · 존재 확인 · 삭제.
 *
 * <p><b>presigned 방식에서 서버가 막아야 하는 세 지점</b>(업로드가 서버를 거치지 않으므로
 * 아래를 놓치면 대안이 없다):</p>
 * <ol>
 *   <li><b>key는 서버가 만든다</b> — {@link UploadPurpose#newKey}. 클라이언트가 정하면
 *       {@code public/avatars/999/x.png}로 남의 아바타를 덮어쓴다.</li>
 *   <li><b>contentType·contentLength를 서명에 포함한다</b> — 선언과 다르게 올리면 S3가 거부한다.
 *       서버를 안 거치는데도 MIME·용량 제한이 서는 유일한 방법이다.</li>
 *   <li><b>업로드 후 key 소유권을 검증한다</b> — {@link #confirmOwned}. 안 하면 남의 key나
 *       아무 문자열이나 자기 프로필에 박을 수 있다.</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final S3Client s3;
    private final S3Presigner presigner;
    private final StorageProperties props;

    /**
     * 업로드용 presigned PUT URL 발급.
     *
     * <p>TTL은 짧게 유지한다(기본 3분) — 업로드 URL이 오래 살 이유가 없고, 유출되면 그 시간만큼
     * 남이 그 key에 쓸 수 있다.</p>
     *
     * <p>{@code requiredHeaders}를 함께 돌려주는 이유 — 서명에 포함된 헤더를 브라우저가 <b>그대로</b>
     * 보내지 않으면 S3가 서명 불일치로 거부한다. SDK 버전에 따라 서명 대상 헤더가 달라질 수 있으므로
     * 프론트에 상수로 박지 않고 서버가 알려 준다(하트비트 간격을 서버가 내려주는 것과 같은 이유).</p>
     */
    public PresignResult presignPut(UploadPurpose purpose, Long userId, String contentType, long contentLength) {
        requireConfigured();
        if (!purpose.isPresignable()) {
            // AI 아이템처럼 서버가 생성하는 산출물은 클라이언트 업로드 경로를 열지 않는다.
            throw new BusinessException(ErrorCode.UPLOAD_PURPOSE_NOT_PRESIGNABLE);
        }
        purpose.validate(contentType, contentLength);

        String key = purpose.newKey(userId, contentType);

        PresignedPutObjectRequest presigned = presigner.presignPutObject(
                PutObjectPresignRequest.builder()
                        .signatureDuration(props.presignTtl())
                        .putObjectRequest(PutObjectRequest.builder()
                                .bucket(props.bucket())
                                .key(key)
                                // 이 두 값이 서명에 들어가야 S3가 MIME·용량을 강제한다.
                                .contentType(contentType)
                                .contentLength(contentLength)
                                .build())
                        .build());

        return new PresignResult(
                presigned.url().toString(),
                key,
                publicUrl(key),
                props.presignTtl().toSeconds(),
                flattenHeaders(presigned.signedHeaders()));
    }

    /**
     * 업로드가 끝난 뒤 호출 — key가 본인 것인지, 그리고 객체가 실제로 존재하는지 확인한다.
     *
     * <p>존재 확인(headObject)까지 하는 이유는 <b>깨진 URL을 DB에 저장하지 않기 위해서</b>다.
     * presigned URL만 받아 놓고 실제 PUT을 하지 않아도 클라이언트는 key를 알고 있다.</p>
     *
     * @return DB에 저장할 공개 URL
     */
    public String confirmOwned(UploadPurpose purpose, Long userId, String key) {
        if (!purpose.owns(key, userId)) {
            throw new BusinessException(ErrorCode.UPLOAD_KEY_FORBIDDEN);
        }
        if (!exists(key)) {
            throw new BusinessException(ErrorCode.UPLOAD_OBJECT_NOT_FOUND);
        }
        return publicUrl(key);
    }

    /**
     * 서버가 직접 올린다 — AI 아이템 이미지처럼 <b>서버가 만든</b> 산출물용.
     * presign이 필요 없고(사용자 업로드가 아니므로) CORS와도 무관하다.
     */
    public String putBytes(UploadPurpose purpose, Long userId, String contentType, byte[] body) {
        requireConfigured();
        purpose.validate(contentType, body.length);
        String key = purpose.newKey(userId, contentType);
        try {
            s3.putObject(
                    PutObjectRequest.builder()
                            .bucket(props.bucket())
                            .key(key)
                            .contentType(contentType)
                            .contentLength((long) body.length)
                            .build(),
                    RequestBody.fromBytes(body));
        } catch (SdkException e) {
            log.error("S3 putObject 실패: key={}", key, e);
            throw new BusinessException(ErrorCode.STORAGE_UNAVAILABLE);
        }
        return publicUrl(key);
    }

    public boolean exists(String key) {
        try {
            s3.headObject(HeadObjectRequest.builder().bucket(props.bucket()).key(key).build());
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        } catch (AwsServiceException e) {
            // 404 는 위에서 잡히지만, 구현체에 따라 403 으로 오는 경우도 있어 함께 '없음'으로 본다.
            if (e.statusCode() == 404 || e.statusCode() == 403) {
                return false;
            }
            log.error("S3 headObject 실패: key={}", key, e);
            throw new BusinessException(ErrorCode.STORAGE_UNAVAILABLE);
        }
    }

    /** 아바타 교체 시 이전 객체 정리 등. 실패해도 본 흐름을 막지 않는다(고아 객체는 나중에 정리 가능). */
    public void deleteQuietly(String key) {
        if (key == null || key.isBlank()) {
            return;
        }
        try {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(props.bucket()).key(key).build());
        } catch (RuntimeException e) {
            log.warn("S3 deleteObject 실패(무시): key={}", key, e);
        }
    }

    /**
     * 공개 URL. <b>절대 조립하지 않는다</b> — path-style(MinIO)과 virtual-hosted(AWS)의
     * 주소 구조가 달라서 bucket으로 만들면 한쪽이 깨진다. 설정된 base에 key만 붙인다.
     */
    public String publicUrl(String key) {
        return props.normalizedPublicBaseUrl() + "/" + key;
    }

    /** 공개 URL → key 역변환. 아바타 교체 시 예전 객체를 지우려면 저장된 URL에서 key를 되찾아야 한다. */
    public String keyFromPublicUrl(String url) {
        String base = props.normalizedPublicBaseUrl() + "/";
        return url != null && url.startsWith(base) ? url.substring(base.length()) : null;
    }

    /**
     * S3 설정이 없으면 여기서 끊는다. 설정 없이 진행하면 버킷명이 빈 문자열인 채로 요청이 나가
     * SDK가 이해하기 어려운 예외를 던지고, 로그만 보고는 "CI 변수를 안 넣었다"는 원인에 닿기 어렵다.
     */
    private void requireConfigured() {
        if (!props.isConfigured()) {
            throw new BusinessException(ErrorCode.STORAGE_UNAVAILABLE);
        }
    }

    private static Map<String, String> flattenHeaders(Map<String, List<String>> headers) {
        Map<String, String> flat = new LinkedHashMap<>();
        headers.forEach((name, values) -> {
            if (!values.isEmpty()) {
                flat.put(name, values.get(0));
            }
        });
        // Host는 브라우저가 스스로 넣는 헤더라 fetch()로 설정할 수 없다(설정 시 예외). 빼고 내려준다.
        flat.remove("Host");
        flat.remove("host");
        return flat;
    }

    /** presign 결과. uploadUrl로 PUT하고, 끝나면 key를 서버에 알려 준다. */
    public record PresignResult(
            String uploadUrl,
            String key,
            String publicUrl,
            long expiresInSeconds,
            Map<String, String> requiredHeaders
    ) {
    }
}
