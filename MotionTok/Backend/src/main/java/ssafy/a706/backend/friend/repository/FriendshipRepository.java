package ssafy.a706.backend.friend.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.friend.model.Friendship;
import ssafy.a706.backend.friend.model.FriendshipStatus;

import java.util.List;
import java.util.Optional;

/**
 * 친구 관계는 방향이 있는 행으로 저장되지만 <b>조회는 대부분 방향과 무관</b>하다
 * (내가 requester인지 addressee인지 모르는 채로 "이 사람과 나의 관계"를 찾는다).
 * 그래서 양방향을 OR로 묶는 쿼리를 기본으로 둔다.
 */
public interface FriendshipRepository extends JpaRepository<Friendship, Long> {

    /** 내 친구 목록 — 내가 어느 쪽이든 ACCEPTED인 관계 전부. */
    @Query("""
            SELECT f FROM Friendship f
            WHERE f.status = :status
              AND (f.requesterId = :userId OR f.addresseeId = :userId)
            """)
    List<Friendship> findAllByUserIdAndStatus(@Param("userId") Long userId,
                                             @Param("status") FriendshipStatus status);

    /** 받은 요청(내가 addressee) / 보낸 요청(내가 requester) — direction으로 갈리는 두 목록. */
    List<Friendship> findAllByAddresseeIdAndStatus(Long addresseeId, FriendshipStatus status);

    List<Friendship> findAllByRequesterIdAndStatus(Long requesterId, FriendshipStatus status);

    /**
     * 두 사람 사이의 관계를 방향 무관하게 찾는다. 이미 친구인지, 반대 방향 요청이 떠 있는지 판단할 때 쓴다.
     * A→B와 B→A가 동시에 PENDING일 수 있으므로 단건이 아니라 목록으로 받는다.
     */
    @Query("""
            SELECT f FROM Friendship f
            WHERE (f.requesterId = :a AND f.addresseeId = :b)
               OR (f.requesterId = :b AND f.addresseeId = :a)
            """)
    List<Friendship> findAllBetween(@Param("a") Long a, @Param("b") Long b);

    Optional<Friendship> findByRequesterIdAndAddresseeId(Long requesterId, Long addresseeId);
}
