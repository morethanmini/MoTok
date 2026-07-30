package ssafy.a706.backend;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

import java.util.TimeZone;

@SpringBootApplication
@ConfigurationPropertiesScan
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }

    /**
     * 앱의 기본 시간대를 한국시간으로 고정한다.
     *
     * <p>저장되는 시각은 전부 {@code LocalDateTime.now()}(=JVM 기본 존)이고 DB 연결은 이미
     * {@code serverTimezone=Asia/Seoul}로 못 박혀 있다. 그런데 배포 컨테이너(eclipse-temurin)의
     * 기본 존은 <b>UTC</b>라, 고정하지 않으면 로컬(KST)에서 쓴 값과 서버에서 쓴 값이 9시간
     * 어긋난 채 같은 컬럼에 섞인다 — 포인트 내역·신고 일시가 9시간 전으로 보이던 원인이다.</p>
     *
     * <p>배포 설정(compose의 {@code TZ})에만 맡기지 않는 이유는, 그 설정을 빠뜨린 채 뜬 인스턴스가
     * 조용히 UTC로 기록해도 아무 데서도 드러나지 않기 때문이다. 여기서 고정하면 어디서 돌든 같다.</p>
     */
    @PostConstruct
    void fixDefaultTimeZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"));
    }

}
