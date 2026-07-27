package ssafy.a706.backend.storage;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * application.yaml의 storage.* — S3(또는 S3 호환) 스토리지 접속 정보.
 *
 * <p><b>endpoint가 비어 있으면 실제 AWS</b>, 값이 있으면 MinIO 등 호환 서버로 붙는다.
 * livekit/openvidu가 URL만 갈아끼워 같은 코드로 도는 것과 같은 사상이고,
 * turn.secret이 비면 STUN-only로 degrade하는 것과 같은 "설정 유무로 모드 결정" 패턴이다.</p>
 *
 * <p>publicBaseUrl을 따로 받는 이유 — 로컬(MinIO)은 {@code host/버킷/키}(path-style),
 * AWS는 {@code 버킷.host/키}(virtual-hosted)로 <b>주소 구조 자체가 다르다</b>.
 * bucket 값으로 URL을 조립하면 한쪽에서 반드시 깨지므로 완성된 base를 설정으로 받는다.</p>
 */
@ConfigurationProperties(prefix = "storage")
public record StorageProperties(
        String bucket,
        String region,
        String endpoint,
        boolean pathStyle,
        String accessKey,
        String secretKey,
        String publicBaseUrl,
        Duration presignTtl
) {

    /** endpoint 미설정 = 실제 AWS. */
    public boolean isAws() {
        return endpoint == null || endpoint.isBlank();
    }

    /**
     * 업로드 기능을 쓸 수 있는 상태인지.
     *
     * <p>버킷·공개 URL이 없으면 기동은 하되 업로드만 비활성으로 degrade한다 —
     * CI 변수를 등록하기 전에 배포가 나가도 앱 전체가 죽지 않게 하기 위해서다
     * (LIVEKIT_* 미등록 시 화상만 비활성인 것과 같은 정책).</p>
     */
    public boolean isConfigured() {
        return bucket != null && !bucket.isBlank()
                && publicBaseUrl != null && !publicBaseUrl.isBlank();
    }

    /**
     * 정적 키가 설정돼 있으면 그것을 쓰고, 없으면 DefaultCredentialsProvider(EC2 IAM 역할 등)로 넘긴다.
     * 운영에서 EC2에 IAM 역할을 붙이면 S3_ACCESS_KEY/SECRET_KEY를 아예 두지 않아도 되고,
     * 그러면 유출될 장기 자격증명이 사라진다.
     */
    public boolean hasStaticCredentials() {
        return accessKey != null && !accessKey.isBlank()
                && secretKey != null && !secretKey.isBlank();
    }

    /** 뒤에 슬래시가 있든 없든 같은 URL이 나오게 정규화한다(설정 실수로 // 가 생기는 것 방지). */
    public String normalizedPublicBaseUrl() {
        if (publicBaseUrl == null || publicBaseUrl.isBlank()) {
            return "";
        }
        return publicBaseUrl.endsWith("/")
                ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1)
                : publicBaseUrl;
    }
}
