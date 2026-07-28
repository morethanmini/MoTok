package ssafy.a706.backend.friend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import ssafy.a706.backend.global.entity.BaseTimeEntity;

import java.time.LocalDateTime;

/**
 * ERD v0.2 FRIENDSHIP 테이블.
 *
 * <p>requester/addressee는 <b>방향</b>을 보존한다 — 누가 보냈는지가 화면에 그대로 노출되므로
 * (FriendRequestItem.requesterNickname/addresseeNickname) 작은 id를 requester로 몰아넣는 식의
 * 정규화를 쓰지 않는다. 그래서 A→B와 B→A가 동시에 PENDING으로 존재할 수 있고,
 * 한쪽이 수락될 때 반대 방향 PENDING을 지우는 건 서비스 책임이다.</p>
 *
 * <p>UNIQUE(requester_id, addressee_id)는 <b>같은 방향</b> 중복 요청만 막는다. 서비스가 미리 검사하지 않고
 * 이 제약의 위반을 409로 바꾸는 쪽을 택했다(check-then-act 경합 회피 — ShopService.purchase와 같은 방식).</p>
 *
 * <p>user FK 제약은 걸지 않고 id 값만 들고 있다. 조회 시 UserRepository로 닉네임을 붙이며,
 * 탈퇴·정지 계정은 그 시점에 걸러낸다.</p>
 */
@Entity
@Table(
        name = "friendships",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_friendship_requester_addressee",
                columnNames = {"requester_id", "addressee_id"}
        ),
        // 친구 조회는 (requester = 나 OR addressee = 나)를 OR로 묶는다. UNIQUE 제약이 requester로
        // 시작하는 복합 인덱스라 앞 분기만 그 인덱스를 타고, addressee 분기는 받쳐 줄 인덱스가 없어
        // 풀스캔으로 떨어진다. 12초 폴링에서는 티가 안 났지만 프레즌스 전이마다 도는 push 경로(-149)
        // 에서는 그대로 병목이 되므로 양쪽 방향에 인덱스를 세운다.
        indexes = {
                @Index(name = "idx_friendship_addressee_status", columnList = "addressee_id, status"),
                @Index(name = "idx_friendship_requester_status", columnList = "requester_id, status")
        }
)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Friendship extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "requester_id", nullable = false)
    private Long requesterId;

    @Column(name = "addressee_id", nullable = false)
    private Long addresseeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private FriendshipStatus status;

    /** 수락 시각. PENDING인 동안은 null이다(거절은 행 삭제라 여기 남지 않는다). */
    @Column(name = "responded_at")
    private LocalDateTime respondedAt;

    private Friendship(Long requesterId, Long addresseeId) {
        this.requesterId = requesterId;
        this.addresseeId = addresseeId;
        this.status = FriendshipStatus.PENDING;
    }

    public static Friendship request(Long requesterId, Long addresseeId) {
        return new Friendship(requesterId, addresseeId);
    }

    public void accept() {
        this.status = FriendshipStatus.ACCEPTED;
        this.respondedAt = LocalDateTime.now();
    }

    public boolean isPending() {
        return status == FriendshipStatus.PENDING;
    }

    /** 이 관계에서 상대방의 userId. 친구 목록은 방향과 무관하게 '나 말고 다른 쪽'을 봐야 한다. */
    public Long counterpartOf(Long userId) {
        return requesterId.equals(userId) ? addresseeId : requesterId;
    }
}
