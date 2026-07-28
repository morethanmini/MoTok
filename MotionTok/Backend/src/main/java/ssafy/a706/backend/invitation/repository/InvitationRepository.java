package ssafy.a706.backend.invitation.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;
import ssafy.a706.backend.invitation.model.Invitation;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 방 초대(-100) Redis 접근 계층.
 * invitation:{invitationId}(Hash, TTL 5m) · invitations:user:{userId}(Set, TTL 5m)
 *
 * <p>기존 {@code room:invite:{code}}(초대코드 → roomId)와는 다른 키다 — 그쪽은 코드 자체의 수명(24h)을
 * 관리하고, 이쪽은 "누가 누구를 언제 불렀는가"라는 훨씬 짧은 사실을 관리한다.</p>
 *
 * <p>수신자 인덱스(Set)에는 만료된 id가 남을 수 있다. Redis는 Set 원소별 TTL이 없어서인데,
 * 조회할 때 본체가 없는 id를 그 자리에서 지운다 — 방 목록이 죽은 방을 lazy 청소하는 것과 같은 방식이다.</p>
 */
@Repository
@RequiredArgsConstructor
public class InvitationRepository {

    private static final String FIELD_ROOM_ID = "roomId";
    private static final String FIELD_ROOM_TITLE = "roomTitle";
    private static final String FIELD_INVITE_CODE = "inviteCode";
    private static final String FIELD_TO_USER_ID = "toUserId";
    private static final String FIELD_FROM_NICKNAME = "fromNickname";
    private static final String FIELD_CREATED_AT = "createdAt";

    private final StringRedisTemplate redisTemplate;

    public void save(Invitation invitation) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put(FIELD_ROOM_ID, invitation.roomId());
        fields.put(FIELD_ROOM_TITLE, invitation.roomTitle());
        fields.put(FIELD_INVITE_CODE, invitation.inviteCode());
        fields.put(FIELD_TO_USER_ID, String.valueOf(invitation.toUserId()));
        fields.put(FIELD_FROM_NICKNAME, invitation.fromNickname());
        fields.put(FIELD_CREATED_AT, String.valueOf(invitation.createdAt().toEpochMilli()));

        String key = invitationKey(invitation.invitationId());
        redisTemplate.<String, String>opsForHash().putAll(key, fields);
        redisTemplate.expire(key, Invitation.TTL);

        // 인덱스 TTL은 매번 5분으로 밀린다 — 항상 가장 최근 초대의 수명을 덮으므로 산 초대를 잃지 않는다.
        String index = userIndexKey(invitation.toUserId());
        redisTemplate.opsForSet().add(index, invitation.invitationId());
        redisTemplate.expire(index, Invitation.TTL);
    }

    public Optional<Invitation> find(String invitationId) {
        Map<Object, Object> fields = redisTemplate.opsForHash().entries(invitationKey(invitationId));
        return fields.isEmpty() ? Optional.empty() : Optional.of(toInvitation(invitationId, fields));
    }

    /** 수신자가 받은, 아직 만료되지 않은 초대 전체. 만료로 본체가 사라진 id는 인덱스에서 함께 지운다. */
    public List<Invitation> findAllReceived(Long userId) {
        String index = userIndexKey(userId);
        Set<String> ids = redisTemplate.opsForSet().members(index);
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        List<Invitation> alive = new ArrayList<>();
        for (String id : ids) {
            find(id).ifPresentOrElse(alive::add, () -> redisTemplate.opsForSet().remove(index, id));
        }
        return alive;
    }

    public void delete(Invitation invitation) {
        redisTemplate.delete(invitationKey(invitation.invitationId()));
        redisTemplate.opsForSet().remove(userIndexKey(invitation.toUserId()), invitation.invitationId());
    }

    private Invitation toInvitation(String invitationId, Map<Object, Object> fields) {
        return new Invitation(
                invitationId,
                (String) fields.get(FIELD_ROOM_ID),
                (String) fields.get(FIELD_ROOM_TITLE),
                (String) fields.get(FIELD_INVITE_CODE),
                Long.parseLong((String) fields.get(FIELD_TO_USER_ID)),
                (String) fields.get(FIELD_FROM_NICKNAME),
                Instant.ofEpochMilli(Long.parseLong((String) fields.get(FIELD_CREATED_AT)))
        );
    }

    private String invitationKey(String invitationId) {
        return "invitation:" + invitationId;
    }

    private String userIndexKey(Long userId) {
        return "invitations:user:" + userId;
    }
}
