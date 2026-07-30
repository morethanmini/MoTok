package ssafy.a706.backend.report;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.report.dto.ReportedUserResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 신고 유저 목록 (-105) — 누적 신고 횟수순.
 *
 * <p>두 신고 도메인에 걸쳐 있어 어느 한쪽 서비스에 두지 않았다. {@code UserReportService}에 넣으면
 * 채팅 신고를 알아야 하고, 반대도 같다.</p>
 *
 * <h4>왜 메모리에서 합산하나</h4>
 * 사용자 신고와 채팅 신고는 <b>별개 테이블</b>이라 한 번의 group by로 합계를 낼 수 없다.
 * UNION 네이티브 쿼리로 DB에 맡길 수도 있지만, 관리자 화면 한 곳에서만 쓰는 조회이고 상한이
 * 작아(기본 20명, 최대 100) 각 테이블 집계를 받아 합치는 편이 읽기 쉽다. 목록이 커지면
 * 신고 시점에 카운터를 증가시키는 집계 테이블로 바꾸는 것이 다음 단계다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ReportedUserQueryService {

    /** 사용자당 보여 줄 최근 사유 개수. */
    private static final int RECENT_REASONS = 3;
    /** 목록 상한 — 무한정 스캔을 막는다. */
    private static final int MAX_LIMIT = 100;

    private final UserReportRepository userReportRepository;
    private final ChatReportRepository chatReportRepository;
    private final UserRepository userRepository;

    /**
     * 누적 신고 횟수 상위 사용자.
     *
     * <p>각 테이블에서 상위 {@code limit}명씩 받아 합산한다. <b>한계</b> — 한쪽에서만 상위권인
     * 사용자는 합계 순위가 밀릴 수 있다(다른 쪽 집계에 안 잡혀 그쪽 건수가 0으로 더해진다).
     * 정확한 전체 순위가 필요해지면 UNION 쿼리나 집계 테이블로 옮긴다.</p>
     *
     * <p>탈퇴 계정은 제외한다 — 제재할 대상이 아니고, 닉네임이 tombstone으로 치환돼 있어
     * 목록에 띄워도 누구인지 알 수 없다.</p>
     */
    public List<ReportedUserResponse> topReportedUsers(int limit) {
        int size = Math.min(Math.max(limit, 1), MAX_LIMIT);
        PageRequest page = PageRequest.of(0, size);

        Map<Long, Long> totals = new HashMap<>();
        userReportRepository.countGroupedByReportedUser(page)
                .forEach(c -> totals.merge(c.userId(), c.count(), Long::sum));
        chatReportRepository.countGroupedByReportedUser(page)
                .forEach(c -> totals.merge(c.userId(), c.count(), Long::sum));
        if (totals.isEmpty()) {
            return List.of();
        }

        // 합산 후 다시 정렬해 상위 size명만 남긴다 — 두 집계의 순위가 서로 다르기 때문이다.
        List<Long> topIds = totals.entrySet().stream()
                .sorted(Map.Entry.<Long, Long>comparingByValue().reversed())
                .limit(size)
                .map(Map.Entry::getKey)
                .toList();

        Map<Long, User> users = userRepository.findAllById(topIds).stream()
                .filter(u -> u.getStatus() != UserStatus.DELETED)
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, List<String>> reasons = recentReasonsOf(topIds);

        return topIds.stream()
                .filter(users::containsKey)
                .map(id -> new ReportedUserResponse(
                        id,
                        users.get(id).getNickname(),
                        totals.get(id),
                        reasons.getOrDefault(id, List.of())))
                .toList();
    }

    /**
     * 사용자별 최근 사유 최대 {@value #RECENT_REASONS}개.
     *
     * <p>두 테이블에서 최신순으로 넉넉히 받아 사용자별로 앞에서 잘라 채운다. 사용자당 정확히 N개를
     * 뽑는 건 윈도우 함수가 필요해 JPQL로는 안 되고, 사용자마다 한 번씩 조회하면 목록 크기만큼
     * 쿼리가 늘어난다. <b>한계</b> — 특정 사용자에게 신고가 몰리면 상한에 걸려 다른 사용자의 사유가
     * 비어 올 수 있다. 사유는 참고 값이고 건수가 본문이라 그대로 둔다.</p>
     */
    private Map<Long, List<String>> recentReasonsOf(List<Long> userIds) {
        PageRequest window = PageRequest.of(0, userIds.size() * RECENT_REASONS * 2);
        Map<Long, List<String>> byUser = new LinkedHashMap<>();

        record Recent(Long userId, Long id, String reason) {
        }
        List<Recent> merged = new ArrayList<>();
        userReportRepository.findByReportedUserIdInOrderByIdDesc(userIds, window)
                .forEach(r -> merged.add(new Recent(r.getReportedUserId(), r.getId(), r.getReason().name())));
        chatReportRepository.findByReportedUserIdInOrderByIdDesc(userIds, window)
                .forEach(r -> merged.add(new Recent(r.getReportedUserId(), r.getId(), r.getReason().name())));
        // 두 테이블의 id는 서로 다른 시퀀스지만 같은 테이블 안에서는 최신순이 보장된다.
        // 섞은 뒤 id 역순으로 정렬하는 것은 근사이고, 사유 3개를 고르는 데는 충분하다.
        merged.sort(Comparator.comparing(Recent::id).reversed());

        for (Recent recent : merged) {
            List<String> list = byUser.computeIfAbsent(recent.userId(), k -> new ArrayList<>());
            if (list.size() < RECENT_REASONS) {
                list.add(recent.reason());
            }
        }
        return byUser;
    }
}
