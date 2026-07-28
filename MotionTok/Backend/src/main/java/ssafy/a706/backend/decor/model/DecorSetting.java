package ssafy.a706.backend.decor.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * ERD v0.2 DECOR_SETTING — 사용자별 화면 꾸미기 설정(USER와 1:1).
 * config에는 "무엇을 장착했는지 + 어디에 붙였는지"가 함께 들어간다(장착 목록을 따로 두지 않는 이유 —
 * 장착과 배치가 항상 같이 바뀌어서, 나뉘어 있으면 둘이 어긋난 상태가 생긴다).
 * 컬럼 타입은 프로젝트 관례를 따라 TEXT + Jackson 직렬화다(ChatReport.contextJson과 동일).
 */
@Entity
@Table(name = "decor_setting")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DecorSetting {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "config", nullable = false, columnDefinition = "TEXT")
    private String config;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public DecorSetting(Long userId, String config) {
        this.userId = userId;
        this.config = config;
        this.updatedAt = LocalDateTime.now();
    }

    public void updateConfig(String config) {
        this.config = config;
        this.updatedAt = LocalDateTime.now();
    }
}
