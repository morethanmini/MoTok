package ssafy.a706.backend.presence.controller.dto;

import ssafy.a706.backend.presence.model.PresenceState;

import java.util.List;

/**
 * GET /v1/admin/online-users 응답 — 지금 접속 중인 사람들.
 *
 * <p>페이지가 없다. 이 목록의 수명은 60초(프레즌스 TTL)라, 2페이지를 넘기는 사이에 1페이지가
 * 이미 다른 사람들이 된다. 한 번에 주고 화면이 스크롤로 훑게 두는 편이 정직하다.</p>
 *
 * @param users    접속자(userId 오름차순)
 * @param capped   상한에 걸려 잘렸는가 — true면 "지금 이만큼만 보여 주는 중"이라고 밝혀야 한다
 */
public record AdminOnlineUserResponse(List<Entry> users, boolean capped) {

    /**
     * @param state       ONLINE(방 밖) · IN_ROOM(방 안)
     * @param roomId      방 안일 때만 값이 있다
     * @param secondsAgo  마지막 하트비트로부터 지난 시간(초). 시각 대신 경과를 주는 이유 —
     *                    "몇 초 전"은 시간대와 무관하게 읽히고, 60초를 넘기면 곧 사라질 항목이라는 뜻이다
     */
    public record Entry(Long userId, String nickname, PresenceState state, String roomId, long secondsAgo) {
    }
}
