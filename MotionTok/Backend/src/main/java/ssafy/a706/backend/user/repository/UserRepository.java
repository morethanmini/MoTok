package ssafy.a706.backend.user.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ssafy.a706.backend.user.entity.User;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    Optional<User> findByNickname(String nickname);

    boolean existsByEmail(String email);

    boolean existsByNickname(String nickname);

    /** 닉네임 변경 중복 검사용 — 대소문자만 바꾸는 경우(CI 콜레이션) 본인 행이 걸리지 않도록 자신을 제외한다. */
    boolean existsByNicknameAndIdNot(String nickname, Long id);

    /**
     * 포인트 차감을 조건부 UPDATE로 원자 처리한다(check-then-act 대신) — 동시 요청에서 잔액을
     * 두 번 깎는 lost-update를 막는다. 영향받은 row가 0이면 잔액 부족.
     * clearAutomatically=true 필수: 벌크 UPDATE는 영속성 컨텍스트를 거치지 않으므로, 이게 없으면
     * 같은 트랜잭션의 이후 findById가 차감 전 stale User를 돌려줄 수 있다.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE User u SET u.pointBalance = u.pointBalance - :amount WHERE u.id = :id AND u.pointBalance >= :amount")
    int deductPointsIfSufficient(@Param("id") Long id, @Param("amount") int amount);

    /**
     * 포인트 적립(게임 보상). 차감과 같은 이유로 조건부가 아닌 원자 UPDATE다 —
     * 두 게임이 비슷한 시각에 끝나면 읽고-더하고-쓰는 방식은 한쪽 적립이 사라진다(lost update).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE User u SET u.pointBalance = u.pointBalance + :amount WHERE u.id = :id")
    int addPoints(@Param("id") Long id, @Param("amount") int amount);
}
