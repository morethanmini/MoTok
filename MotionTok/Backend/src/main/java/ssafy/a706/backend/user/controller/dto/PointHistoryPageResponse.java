package ssafy.a706.backend.user.controller.dto;

import org.springframework.data.domain.Page;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;

import java.time.LocalDateTime;
import java.util.List;

/**
 * GET /users/me/points/history — 명세 PointHistoryPage.
 * 페이지 메타를 평평하게 펴지 않고 page 객체로 감싸는 형태가 명세 규정이다(§2).
 */
public record PointHistoryPageResponse(List<Entry> content, PageMeta page) {

    public record Entry(
            Long id,
            int amount,
            PointHistoryType type,
            int balanceAfter,
            Long refId,
            LocalDateTime createdAt
    ) {
        static Entry from(PointHistory history) {
            return new Entry(history.getId(), history.getAmount(), history.getType(),
                    history.getBalanceAfter(), history.getRefId(), history.getCreatedAt());
        }
    }

    public record PageMeta(int page, int size, long totalElements, int totalPages) {}

    public static PointHistoryPageResponse from(Page<PointHistory> result) {
        return new PointHistoryPageResponse(
                result.getContent().stream().map(Entry::from).toList(),
                new PageMeta(result.getNumber(), result.getSize(),
                        result.getTotalElements(), result.getTotalPages()));
    }
}
