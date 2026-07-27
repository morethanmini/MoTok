package ssafy.a706.backend.invitation.model;

import java.time.Duration;
import java.time.Instant;

/**
 * 친구에게 보낸 방 초대(-100). Redis에만 산다 — 방 자체가 Redis 데이터라 초대만 RDB에 남길 이유가 없다.
 *
 * <p>inviteCode를 통째로 싣는 이유: 수락한 쪽은 이 코드로 기존
 * {@code POST /v1/live-rooms/join-by-invite-code}를 호출해 들어간다. 초대받아 들어가는 경로라
 * 비밀방이어도 비밀번호를 면제받는데(-25), 그 면제는 이미 그 엔드포인트에 구현돼 있어
 * 새 입장 경로를 만들 필요가 없다.</p>
 */
public record Invitation(
        String invitationId,
        String roomId,
        String roomTitle,
        String inviteCode,
        Long toUserId,
        String fromNickname,
        Instant createdAt
) {

    /**
     * 초대 유효 시간. 짧게 잡는다 — 대기실은 몇 분 안에 게임을 시작하거나 해산하므로,
     * 오래 살아남은 초대는 눌러 봐야 이미 사라졌거나 게임 중인 방으로 데려간다.
     */
    public static final Duration TTL = Duration.ofMinutes(5);

    public Instant expiresAt() {
        return createdAt.plus(TTL);
    }
}
