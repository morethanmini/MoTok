package ssafy.a706.backend.auth.password;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * 비밀번호 재설정 링크 메일 발송.
 * spring.mail.host가 비어 있으면 발송 대신 링크를 로그로 출력한다(로컬 개발용). 운영에서는 MAIL_HOST 필수.
 * (가입 인증 메일 VerificationMailSender와 동일한 패턴)
 */
@Slf4j
@Component
public class PasswordResetMailSender {

    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final String mailHost;
    private final String from;

    public PasswordResetMailSender(ObjectProvider<JavaMailSender> mailSenderProvider,
                                   @Value("${spring.mail.host:}") String mailHost,
                                   @Value("${app.email-verification.from}") String from) {
        this.mailSenderProvider = mailSenderProvider;
        this.mailHost = mailHost;
        this.from = from;
    }

    public void send(String email, String resetLink) {
        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (sender == null || mailHost == null || mailHost.isBlank()) {
            log.warn("[메일 미설정] {} 비밀번호 재설정 링크 = {} (SMTP 미설정이라 실제 발송하지 않음)", email, resetLink);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("[모톡] 비밀번호 재설정");
        message.setText("""
                모톡 비밀번호 재설정 안내입니다.

                아래 링크에서 새 비밀번호를 설정해 주세요. (30분 안에 유효합니다)
                %s

                본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.
                """.formatted(resetLink));
        sender.send(message);
        log.info("비밀번호 재설정 메일 발송 완료: {}", email);
    }
}
