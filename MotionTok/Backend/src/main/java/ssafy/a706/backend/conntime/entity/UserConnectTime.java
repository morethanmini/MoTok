package ssafy.a706.backend.conntime.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 회원별 누적 접속시간(S15P11A706-141 친구 상세) — 접속시간의 <b>유일한 영속 원천</b>.
 *
 * <p>라이브 누적은 Redis {@code conntime:{userId}}(카운터)가 맡고, 오프라인 전환·로그아웃 시점에
 * 여기로 flush된다(ConnectTimeService). users 테이블 컬럼이 아닌 별도 테이블인 이유 —
 * User는 공유 엔티티라 불가침으로 두고, 접속할 때마다 갱신되는 행을 users에서 격리한다.</p>
 *
 * <p>user_id는 users.id 값 그대로의 PK다. FK 제약 없는 Long 참조는 팀 컨벤션
 * (Friendship·Leaderboard와 동일). 배포 시점부터 누적을 시작하며 과거 접속은 소급하지 않는다.</p>
 */
@Entity
@Table(name = "user_connect_times")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserConnectTime {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "total_seconds", nullable = false)
    private long totalSeconds;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public UserConnectTime(Long userId) {
        this.userId = userId;
        this.totalSeconds = 0;
        this.updatedAt = LocalDateTime.now();
    }

    public void addSeconds(long seconds) {
        this.totalSeconds += seconds;
        this.updatedAt = LocalDateTime.now();
    }

    /**
     * 마지막으로 접속을 끝낸 시각(-179 친구 목록의 "N분 전 접속").
     *
     * <p>새 컬럼을 만들지 않고 {@code updated_at}을 그대로 읽는다. 이 행이 갱신되는 경로는
     * {@link #addSeconds}뿐이고 그것을 부르는 곳은 {@code ConnectTimeService.flush} 하나인데,
     * flush는 <b>오프라인이 확인됐을 때만</b> 돈다 — 즉 이 값은 이미 "마지막 접속 종료 시각"이다.</p>
     *
     * <p><b>다른 경로에서 이 행을 저장하면 의미가 조용히 깨진다.</b> 접속과 무관한 갱신을
     * 추가해야 한다면 그때는 별도 컬럼으로 갈라야 한다 — 이 메서드가 그 계약의 표식이다.</p>
     */
    public LocalDateTime lastSeenAt() {
        return updatedAt;
    }
}
