package ssafy.a706.backend.storage;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;

/**
 * S3Client(서버 측 조작) · S3Presigner(브라우저 직접 업로드용 URL 서명) 빈.
 *
 * <p>로컬(MinIO)과 운영(AWS)의 차이는 전부 설정으로 흡수한다 — 자바 코드는 한 줄도 갈리지 않는다.
 * endpoint가 비어 있으면 SDK가 리전으로 실제 AWS 엔드포인트를 계산하고,
 * 값이 있으면 그 주소(MinIO)로 붙는다.</p>
 *
 * <p>SDK 2.30+ 는 PutObject에 체크섬 헤더를 기본으로 붙인다. 구버전 MinIO가 이 헤더를 거부하면
 * 환경변수 {@code AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED} 로 전역 완화한다 —
 * S3Presigner.Builder에는 이 설정을 주는 메서드가 없어서(region·credentials·endpoint·
 * serviceConfiguration 뿐) 코드로는 Presigner 쪽을 못 건드리기 때문이다.
 * docker-compose의 MinIO는 최근 릴리스로 고정해 뒀으므로 기본값으로 동작한다.</p>
 */
@Slf4j
@Configuration
public class S3Config {

    /**
     * MinIO는 {@code host/버킷/키}(path-style), AWS는 {@code 버킷.host/키}(virtual-hosted)를 쓴다.
     * 이 플래그를 Client와 Presigner <b>양쪽에 똑같이</b> 줘야 한다 —
     * 한쪽만 주면 서버가 올린 객체와 브라우저가 올린 객체의 주소가 달라진다.
     */
    private S3Configuration serviceConfiguration(StorageProperties props) {
        return S3Configuration.builder()
                .pathStyleAccessEnabled(props.pathStyle())
                .build();
    }

    /**
     * 정적 키가 있으면 그것을, 없으면 기본 체인(EC2 IAM 역할·환경변수·~/.aws)을 쓴다.
     * 운영에서 EC2에 역할을 붙이면 키를 아예 두지 않아도 되고, 그러면 유출될 장기 자격증명이 없다.
     */
    private AwsCredentialsProvider credentialsProvider(StorageProperties props) {
        if (props.hasStaticCredentials()) {
            return StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(props.accessKey(), props.secretKey()));
        }
        return DefaultCredentialsProvider.create();
    }

    @Bean
    public S3Client s3Client(StorageProperties props) {
        if (props.isConfigured()) {
            log.info("S3 client: mode={} region={} bucket={} pathStyle={}",
                    props.isAws() ? "AWS" : "custom-endpoint(" + props.endpoint() + ")",
                    props.region(), props.bucket(), props.pathStyle());
        } else {
            // 기동은 시키되 눈에 띄게 남긴다 — 조용히 넘어가면 배포 후 업로드가 안 되는 걸
            // 사용자 신고로 알게 된다. S3_BUCKET / S3_PUBLIC_BASE_URL 을 CI 변수에 등록할 것.
            log.warn("S3 미설정 — 업로드 기능이 비활성화됩니다 (bucket='{}', publicBaseUrl='{}')",
                    props.bucket(), props.publicBaseUrl());
        }

        S3ClientBuilder builder = S3Client.builder()
                .region(Region.of(props.region()))
                .credentialsProvider(credentialsProvider(props))
                .serviceConfiguration(serviceConfiguration(props));

        if (!props.isAws()) {
            builder.endpointOverride(URI.create(props.endpoint()));
        }
        return builder.build();
    }

    /** presigned URL 서명 전용. 서명 주체가 같아야 하므로 리전·자격증명·주소방식을 Client와 동일하게 준다. */
    @Bean
    public S3Presigner s3Presigner(StorageProperties props) {
        S3Presigner.Builder builder = S3Presigner.builder()
                .region(Region.of(props.region()))
                .credentialsProvider(credentialsProvider(props))
                .serviceConfiguration(serviceConfiguration(props));

        if (!props.isAws()) {
            builder.endpointOverride(URI.create(props.endpoint()));
        }
        return builder.build();
    }
}
