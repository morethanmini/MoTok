package ssafy.a706.backend.shop.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.shop.controller.dto.AdminPointHistoryListResponse;
import ssafy.a706.backend.shop.model.PointDirection;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.shop.repository.dto.PointFlowSum;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 관리자 포인트 내역 조회 (-106 후속) — "누가 얼마를 받아 갔고 얼마를 썼나".
 *
 * <p>회원 본인용 조회({@code UserController#pointHistory})와 서비스를 나눈 이유는
 * <b>대상이 다르기 때문</b>이다. 본인 조회는 userId가 토큰에서 나와 필터가 필요 없고, 이쪽은
 * 대상·방향이 모두 질의 파라미터다. 한 메서드로 합치면 "userId가 null이면 전체"라는 분기가
 * 인증 경로 안으로 들어와, 파라미터 하나 흘리면 남의 내역이 열린다.</p>
 *
 * <p>읽기 전용이다. 관리자가 포인트를 지급·회수하는 기능은 없다 — 있다면 point_history가
 * 게임·상점 결과의 기록이 아니라 편집 가능한 장부가 되고, 부정 정산을 사후에 판별할 수 없다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PointHistoryAdminService {

    /** 한 번에 읽을 수 있는 상한 — 전체 조회(userId 없음)가 가능해서 상한이 없으면 테이블을 통째로 뜬다. */
    private static final int MAX_SIZE = 100;

    private final PointHistoryRepository pointHistoryRepository;
    private final UserRepository userRepository;

    public AdminPointHistoryListResponse search(Long userId, PointDirection direction,
                                                PointHistoryType type, int page, int size) {
        Pageable pageable = PageRequest.of(
                Math.max(0, page),
                Math.max(1, Math.min(MAX_SIZE, size)),
                Sort.by(Sort.Direction.DESC, "id"));

        Page<PointHistory> result = pointHistoryRepository.search(
                userId,
                direction == PointDirection.EARN,
                direction == PointDirection.SPEND,
                type,
                pageable);

        // 닉네임은 한 번에 모아 읽는다 — 행마다 조회하면 페이지 크기만큼 쿼리가 나간다.
        Map<Long, String> nicknames = nicknamesOf(result.getContent());

        List<AdminPointHistoryListResponse.Entry> entries = result.getContent().stream()
                .map(h -> new AdminPointHistoryListResponse.Entry(
                        h.getId(), h.getUserId(), nicknames.get(h.getUserId()),
                        h.getAmount(), h.getType(), h.getRefId(),
                        h.getBalanceAfter(), h.getCreatedAt()))
                .toList();

        return new AdminPointHistoryListResponse(
                entries, result.getNumber(), result.getSize(),
                result.getTotalElements(), result.getTotalPages(),
                summaryOf(userId));
    }

    private Map<Long, String> nicknamesOf(List<PointHistory> histories) {
        List<Long> userIds = histories.stream().map(PointHistory::getUserId).distinct().toList();
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, User::getNickname));
    }

    /**
     * 대상 회원의 전체 적립·사용 합계와 현재 잔액.
     *
     * <p>합계는 <b>필터를 무시</b>한다 — "적립만" 필터를 걸었다고 사용 합계가 0이 되면, 필터는
     * 목록을 좁히는 도구인데 요약까지 함께 좁혀져 두 숫자를 비교할 수 없다.</p>
     *
     * <p>회원을 지정하지 않았으면 null이다. 전체 사용자의 포인트를 합친 값은 운영 지표로도
     * 쓸 데가 없고(발행 총량은 이 화면의 질문이 아니다) 오해만 만든다.</p>
     */
    private AdminPointHistoryListResponse.Summary summaryOf(Long userId) {
        if (userId == null) {
            return null;
        }
        PointFlowSum flow = pointHistoryRepository.sumFlowOf(userId);
        if (flow == null) {
            flow = PointFlowSum.ZERO;
        }
        Integer balance = userRepository.findById(userId).map(User::getPointBalance).orElse(null);
        return new AdminPointHistoryListResponse.Summary(flow.earned(), flow.spent(), balance);
    }
}
