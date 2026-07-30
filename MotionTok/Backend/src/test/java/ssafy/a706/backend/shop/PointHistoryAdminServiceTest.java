package ssafy.a706.backend.shop;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.shop.controller.dto.AdminPointHistoryListResponse;
import ssafy.a706.backend.shop.model.PointDirection;
import ssafy.a706.backend.shop.model.PointHistory;
import ssafy.a706.backend.shop.model.PointHistoryType;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.shop.repository.dto.PointFlowSum;
import ssafy.a706.backend.shop.service.PointHistoryAdminService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 관리자 포인트 내역 조회(-106 후속) 단위 테스트.
 * 시나리오: 방향 필터 → 쿼리 플래그 / 닉네임 일괄 조회 / 요약은 회원 지정 시에만 / size 상한.
 */
@ExtendWith(MockitoExtension.class)
class PointHistoryAdminServiceTest {

    private static final long USER_ID = 42L;

    @Mock PointHistoryRepository pointHistoryRepository;
    @Mock UserRepository userRepository;

    @InjectMocks PointHistoryAdminService service;

    private PointHistory history(long id, long userId, int amount, PointHistoryType type) {
        PointHistory h = PointHistory.builder()
                .userId(userId).amount(amount).type(type).balanceAfter(1_000).build();
        ReflectionTestUtils.setField(h, "id", id);
        return h;
    }

    private User user(long id, String nickname, int balance) {
        User user = User.builder().nickname(nickname).build();
        ReflectionTestUtils.setField(user, "id", id);
        ReflectionTestUtils.setField(user, "pointBalance", balance);
        return user;
    }

    private void givenPage(List<PointHistory> content) {
        when(pointHistoryRepository.search(any(), anyBoolean(), anyBoolean(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(content, PageRequest.of(0, 20), content.size()));
    }

    /**
     * 방향은 amount의 부호로만 표현되므로(테이블에 컬럼이 없다) 서비스가 enum을 쿼리 플래그로
     * 옮긴다. 이게 어긋나면 "쓴 내역"을 골랐는데 적립이 섞여 나온다.
     */
    @Test
    void 방향_필터를_쿼리_플래그로_옮긴다() {
        givenPage(List.of());

        service.search(null, PointDirection.SPEND, null, 0, 20);

        verify(pointHistoryRepository).search(eq(null), eq(false), eq(true), eq(null), any(Pageable.class));
    }

    @Test
    void 방향을_주지_않으면_양쪽_다_통과시킨다() {
        givenPage(List.of());

        service.search(null, null, null, 0, 20);

        verify(pointHistoryRepository).search(eq(null), eq(false), eq(false), eq(null), any(Pageable.class));
    }

    /** 닉네임은 행마다 조회하지 않는다 — 페이지 크기만큼 쿼리가 나가면 목록이 20번 왕복한다. */
    @Test
    void 닉네임은_한_번에_모아_읽는다() {
        givenPage(List.of(
                history(1L, USER_ID, 300, PointHistoryType.GAME_REWARD),
                history(2L, USER_ID, -120, PointHistoryType.SHOP_PURCHASE),
                history(3L, 7L, 500, PointHistoryType.GAME_REWARD)));
        when(pointHistoryRepository.sumFlowOf(USER_ID)).thenReturn(new PointFlowSum(300, 120));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user(USER_ID, "민지", 180)));
        when(userRepository.findAllById(any()))
                .thenReturn(List.of(user(USER_ID, "민지", 180), user(7L, "Alex", 500)));

        AdminPointHistoryListResponse response = service.search(USER_ID, null, null, 0, 20);

        ArgumentCaptor<Iterable<Long>> ids = ArgumentCaptor.captor();
        verify(userRepository).findAllById(ids.capture());
        assertThat(ids.getValue()).containsExactly(USER_ID, 7L); // 중복 제거, 등장 순서

        assertThat(response.histories()).hasSize(3);
        assertThat(response.histories().get(0).nickname()).isEqualTo("민지");
        assertThat(response.histories().get(2).nickname()).isEqualTo("Alex");
    }

    /**
     * 요약은 <b>필터를 무시한 전체 합계</b>다. '적립만' 필터에 사용 합계까지 0이 되면
     * 두 숫자를 나란히 비교할 수 없어 요약이 존재할 이유가 사라진다.
     */
    @Test
    void 요약은_방향_필터와_무관하게_전체_합계다() {
        givenPage(List.of(history(1L, USER_ID, 300, PointHistoryType.GAME_REWARD)));
        when(pointHistoryRepository.sumFlowOf(USER_ID)).thenReturn(new PointFlowSum(1_500, 1_320));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user(USER_ID, "민지", 180)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(USER_ID, "민지", 180)));

        AdminPointHistoryListResponse response = service.search(USER_ID, PointDirection.EARN, null, 0, 20);

        assertThat(response.summary().earned()).isEqualTo(1_500);
        assertThat(response.summary().spent()).isEqualTo(1_320); // 필터가 EARN인데도 그대로
        assertThat(response.summary().currentBalance()).isEqualTo(180);
    }

    /** 여러 사람의 포인트를 합친 숫자는 아무 질문에도 답하지 않는다 — 아예 계산하지 않는다. */
    @Test
    void 회원을_지정하지_않으면_요약이_없다() {
        givenPage(List.of(history(1L, USER_ID, 300, PointHistoryType.GAME_REWARD)));
        when(userRepository.findAllById(any())).thenReturn(List.of(user(USER_ID, "민지", 180)));

        AdminPointHistoryListResponse response = service.search(null, null, null, 0, 20);

        assertThat(response.summary()).isNull();
        verify(pointHistoryRepository, never()).sumFlowOf(any());
    }

    /** 전체 조회가 가능한 엔드포인트라 상한이 없으면 테이블을 통째로 뜬다. */
    @Test
    void size는_100으로_잘리고_page는_음수를_허용하지_않는다() {
        givenPage(List.of());

        service.search(null, null, null, -3, 5_000);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.captor();
        verify(pointHistoryRepository)
                .search(any(), anyBoolean(), anyBoolean(), any(), pageable.capture());
        assertThat(pageable.getValue().getPageSize()).isEqualTo(100);
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getSort()).isEqualTo(Sort.by(Sort.Direction.DESC, "id"));
    }

    /** 내역이 없는 회원은 합계 쿼리가 null을 줄 수 있다(집계 대상 0행) — 0으로 접는다. */
    @Test
    void 합계가_null이면_0으로_접는다() {
        givenPage(List.of());
        when(pointHistoryRepository.sumFlowOf(USER_ID)).thenReturn(null);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.empty());

        AdminPointHistoryListResponse response = service.search(USER_ID, null, null, 0, 20);

        assertThat(response.summary().earned()).isZero();
        assertThat(response.summary().spent()).isZero();
        assertThat(response.summary().currentBalance()).isNull();
    }

    @Test
    void 빈_페이지면_닉네임_조회를_생략한다() {
        Page<PointHistory> empty = new PageImpl<>(List.of(), PageRequest.of(0, 20), 0);
        when(pointHistoryRepository.search(any(), anyBoolean(), anyBoolean(), any(), any(Pageable.class)))
                .thenReturn(empty);

        service.search(null, null, null, 0, 20);

        verify(userRepository, never()).findAllById(any());
    }
}
