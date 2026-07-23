package ssafy.a706.backend.user.withdrawal;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** 탈퇴 후 1주일 재가입 제한 (-111). */
class RejoinPolicyTest {

    private final WithdrawnAccountRepository repository = mock(WithdrawnAccountRepository.class);
    private final RejoinPolicy policy =
            new RejoinPolicy(repository, new WithdrawalProperties(Duration.ofDays(7)));

    @Test
    @DisplayName("쿨다운 기록이 없으면 가입을 막지 않는다")
    void allowsWhenNoRecord() {
        given(repository.findTopByIdentifierHashAndRejoinAvailableAtAfterOrderByRejoinAvailableAtDesc(
                any(), any())).willReturn(Optional.empty());

        assertThatCode(() -> policy.ensureRejoinable("a@b.com", WithdrawnIdentifierType.EMAIL))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("쿨다운이 남아 있으면 409로 막는다")
    void blocksWhileCooldownRemains() {
        LocalDateTime now = LocalDateTime.now();
        given(repository.findTopByIdentifierHashAndRejoinAvailableAtAfterOrderByRejoinAvailableAtDesc(
                any(), any()))
                .willReturn(Optional.of(WithdrawnAccount.of(
                        "hash", WithdrawnIdentifierType.EMAIL, now, now.plusDays(3))));

        assertThatThrownBy(() -> policy.ensureRejoinable("a@b.com", WithdrawnIdentifierType.EMAIL))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("errorCode", ErrorCode.REJOIN_COOLDOWN);
    }

    @Test
    @DisplayName("이메일은 대소문자·공백을 무시하고 같은 식별자로 본다")
    void normalizesEmail() {
        policy.record("  A@B.com ", WithdrawnIdentifierType.EMAIL);
        policy.ensureRejoinable("a@b.com", WithdrawnIdentifierType.EMAIL);

        ArgumentCaptor<WithdrawnAccount> saved = ArgumentCaptor.forClass(WithdrawnAccount.class);
        verify(repository).save(saved.capture());
        verify(repository).findTopByIdentifierHashAndRejoinAvailableAtAfterOrderByRejoinAvailableAtDesc(
                eq(saved.getValue().getIdentifierHash()), any());
    }

    @Test
    @DisplayName("식별자 원문이 아니라 해시로만 저장한다 — 탈퇴로 지운 개인정보를 되살려 두지 않는다")
    void storesHashOnly() {
        policy.record("a@b.com", WithdrawnIdentifierType.EMAIL);

        ArgumentCaptor<WithdrawnAccount> saved = ArgumentCaptor.forClass(WithdrawnAccount.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getIdentifierHash())
                .hasSize(64)
                .doesNotContain("a@b.com");
    }

    @Test
    @DisplayName("쿨다운 기간만큼 뒤로 재가입 가능 시각을 잡는다")
    void setsRejoinAvailableAtByCooldown() {
        policy.record("google:uid-1", WithdrawnIdentifierType.SOCIAL);

        ArgumentCaptor<WithdrawnAccount> saved = ArgumentCaptor.forClass(WithdrawnAccount.class);
        verify(repository).save(saved.capture());
        WithdrawnAccount record = saved.getValue();
        assertThat(record.getIdentifierType()).isEqualTo(WithdrawnIdentifierType.SOCIAL);
        assertThat(Duration.between(record.getWithdrawnAt(), record.getRejoinAvailableAt()).toDays())
                .isEqualTo(7);
    }
}
