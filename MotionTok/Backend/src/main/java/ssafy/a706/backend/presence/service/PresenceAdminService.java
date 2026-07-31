package ssafy.a706.backend.presence.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.presence.controller.dto.AdminOnlineUserResponse;
import ssafy.a706.backend.presence.model.PresenceSnapshot;
import ssafy.a706.backend.presence.repository.PresenceRepository;
import ssafy.a706.backend.presence.repository.PresenceRepository.OnlinePresence;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 관리자 접속자 목록 — "지금 누가 붙어 있고, 어디에 있나".
 *
 * <p>친구 목록의 프레즌스 조회({@link PresenceService})와 다른 질문에 답한다. 저쪽은 <b>아는 사람</b>의
 * 상태를 묻고(대상이 정해져 있다), 이쪽은 <b>대상 없이</b> 전부를 훑는다. 그래서 조회 경로도 다르다 —
 * 친구는 id 목록으로 파이프라인 조회, 여기는 키 스캔.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PresenceAdminService {

    /**
     * 한 번에 보여 줄 상한. 이 프로젝트의 동시 접속 규모를 훨씬 넘는 값이다 — 상한은 화면을
     * 좁히려는 게 아니라, 키가 예상 밖으로 불었을 때 응답이 통째로 커지는 걸 막는 안전장치다.
     */
    private static final int MAX_USERS = 500;

    private final PresenceRepository presenceRepository;
    private final UserRepository userRepository;

    public AdminOnlineUserResponse onlineUsers() {
        List<OnlinePresence> online = presenceRepository.scanOnline(MAX_USERS);
        if (online.isEmpty()) {
            return new AdminOnlineUserResponse(List.of(), false);
        }

        // 닉네임은 한 번에 모아 읽는다 — 사람마다 조회하면 접속자 수만큼 쿼리가 나간다.
        Map<Long, String> nicknames = userRepository
                .findAllById(online.stream().map(OnlinePresence::userId).toList())
                .stream()
                .collect(Collectors.toMap(User::getId, User::getNickname));

        long now = System.currentTimeMillis();
        List<AdminOnlineUserResponse.Entry> users = online.stream()
                .sorted(Comparator.comparing(OnlinePresence::userId))
                .map(p -> toEntry(p, nicknames, now))
                .toList();
        return new AdminOnlineUserResponse(users, users.size() >= MAX_USERS);
    }

    private AdminOnlineUserResponse.Entry toEntry(OnlinePresence presence,
                                                  Map<Long, String> nicknames,
                                                  long now) {
        PresenceSnapshot snapshot = PresenceSnapshot.online(presence.roomId());
        // 회원 행이 없는 id(탈퇴 직후 남은 키 등)도 목록에서 빼지 않는다 — 붙어 있는 건 사실이고,
        // 이름 없이 사라지면 "왜 접속자 수와 목록이 다르지"가 된다.
        String nickname = nicknames.getOrDefault(presence.userId(), "#" + presence.userId());
        long secondsAgo = presence.heartbeatAt() == null
                ? 0
                : Math.max(0, (now - presence.heartbeatAt()) / 1000);
        return new AdminOnlineUserResponse.Entry(
                presence.userId(), nickname, snapshot.state(), snapshot.roomId(), secondsAgo);
    }
}
