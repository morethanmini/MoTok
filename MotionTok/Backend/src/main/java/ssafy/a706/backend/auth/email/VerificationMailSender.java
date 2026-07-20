package ssafy.a706.backend.auth.email;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * 인증번호 메일 발송.
 * spring.mail.host가 비어 있으면 메일을 보내지 않고 인증번호를 로그로 출력한다.
 * → 로컬에서 SMTP 계정 없이도 가입 흐름을 그대로 테스트할 수 있다. 운영에서는 MAIL_HOST를 반드시 설정할 것.
 */
@Slf4j
@Component
public class VerificationMailSender {

    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final EmailVerificationProperties properties;
    private final String mailHost;

    public VerificationMailSender(ObjectProvider<JavaMailSender> mailSenderProvider,
                                  EmailVerificationProperties properties,
                                  @Value("${spring.mail.host:}") String mailHost) {
        this.mailSenderProvider = mailSenderProvider;
        this.properties = properties;
        this.mailHost = mailHost;
    }

    public void send(String email, String code) {
        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        // host가 비어 있으면 빈이 있어도 실제 발송은 불가능하므로 로그로 대체한다.
        if (sender == null || mailHost == null || mailHost.isBlank()) {
            log.warn("[메일 미설정] {} 인증번호 = {} (SMTP 미설정이라 실제 발송하지 않음)", email, code);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(properties.from());
        message.setTo(email);
        message.setSubject("[모톡] 회원가입 인증번호");
        message.setText("""
                모톡 회원가입 인증번호입니다.

                인증번호: %s

                %d분 안에 입력해 주세요.
                본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.
                """.formatted(code, properties.codeTtl().toMinutes()));
        sender.send(message);
        log.info("인증번호 메일 발송 완료: {}", email);
    }
}
