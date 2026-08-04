package ssafy.a706.backend.global;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.mail.health.MailHealthIndicator;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.mail.javamail.JavaMailSender;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 메일은 종합 {@code /actuator/health} 에 들어가지 않는다.
 *
 * <p>들어가면 두 가지가 따라온다 — SMTP 가 막힌 곳(SSAFY 교육망 등)에서 종합 health 가 늘
 * 503 이 되어 <b>DB·Redis 가 멀쩡한지를 가리고</b>, 지표가 실제로 SMTP 에 접속해 보기 때문에
 * health 를 부를 때마다 5초(connectiontimeout)가 매달린다. 하필 진단이 급한 순간이다.</p>
 *
 * <p>이걸 테스트로 두는 이유 — 껐다는 사실이 <b>속성 이름 한 줄</b>에 걸려 있다.
 * {@code management.health.mail.enabled} 는 부트 4에서 spring-boot-mail 모듈로 옮겨 온
 * 속성이라(전에는 actuator-autoconfigure), 다음 업그레이드에서 이름이 또 바뀌면 설정은 조용히
 * 무시되고 5초 지연이 되돌아온다. 오타로 죽는 것도 같은 방식으로 조용하다.</p>
 */
@SpringBootTest
class MailHealthDisabledTest {

    @Autowired
    private ApplicationContext context;

    @Test
    @DisplayName("메일 health 지표가 등록되지 않는다")
    void mailHealthIndicatorIsAbsent() {
        assertThat(context.getBeansOfType(MailHealthIndicator.class)).isEmpty();
    }

    @Test
    @DisplayName("메일 자체는 살아 있다 — health에서만 뺐다")
    void mailSenderStillExists() {
        assertThat(context.getBeansOfType(JavaMailSender.class)).isNotEmpty();
    }
}
