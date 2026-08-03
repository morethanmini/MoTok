package ssafy.a706.backend.shop.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import ssafy.a706.backend.shop.controller.dto.ItemResponse;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;
import ssafy.a706.backend.shop.repository.ItemRepository;
import ssafy.a706.backend.shop.repository.PointHistoryRepository;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 상점 목록은 <b>분류 → id</b> 순으로 나간다.
 *
 * <p>정렬이 없으면 SQL은 순서를 보장하지 않으므로 실행 계획이 바뀔 때 조회마다 카드가 재배열된다
 * (게임 목록에서 같은 일이 났다 — S15P11A706-177). 상점은 목록이 곧 화면이라 그게 그대로
 * "순서가 튄다"로 보인다.</p>
 *
 * <p><b>분류 순서가 알파벳순이 아니라는 게 이 테스트의 핵심이다.</b> category는
 * {@code @Enumerated(STRING)}이라 DB 정렬은 BACKGROUND·EFFECT·MASK·STICKER가 되는데,
 * 화면 분류 탭은 가면·효과·스티커·배경 순이다. 그래서 {@code Sort.by("category","id")}는
 * <b>맞는 것처럼 보이면서 틀린다</b> — 누가 "DB에서 정렬하는 게 낫다"며 그리로 바꾸면 여기서 걸린다.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ShopItemOrderTest {

    private static final Long USER_ID = 1L;

    @Mock private ItemRepository itemRepository;
    @Mock private UserItemRepository userItemRepository;
    @Mock private PointHistoryRepository pointHistoryRepository;
    @Mock private UserRepository userRepository;

    @InjectMocks private ShopService shopService;

    @BeforeEach
    void setUp() {
        when(userItemRepository.findItemIdsByUserId(USER_ID)).thenReturn(Set.of());
    }

    /** id는 IDENTITY라 빌더로 못 넣는다 — 정렬 대상이므로 반사로 채운다. */
    private Item item(long id, String name, ItemCategory category) {
        Item saved = Item.builder()
                .name(name)
                .category(category)
                .itemType(ItemType.SHOP)
                .pricePoint(100)
                .imageUrl("/assets/item/" + id + ".png")
                .active(true)
                .build();
        ReflectionTestUtils.setField(saved, "id", id);
        return saved;
    }

    private List<String> namesFrom(List<Item> stored) {
        when(itemRepository.findAllByItemTypeAndActiveTrue(any())).thenReturn(stored);
        return shopService.listItems(USER_ID, null).stream().map(ItemResponse::name).toList();
    }

    @Test
    @DisplayName("분류는 화면 탭 순서(가면·효과·스티커·배경), 같은 분류 안에서는 id 오름차순")
    void ordersByCategoryThenId() {
        // DB가 아무 순서로 주더라도 (id는 시더가 넣는 순서 — 뽀샤시가 흑백보다 먼저다)
        List<String> names = namesFrom(List.of(
                item(9, "고양이 풍선 스티커", ItemCategory.STICKER),
                item(4, "우주 배경", ItemCategory.BACKGROUND),
                item(3, "흑백 효과", ItemCategory.EFFECT),
                item(7, "몽이 가면", ItemCategory.MASK),
                item(1, "하트 스티커", ItemCategory.STICKER),
                item(2, "뽀샤시 효과", ItemCategory.EFFECT)));

        assertThat(names).containsExactly(
                "몽이 가면", // MASK
                "뽀샤시 효과", "흑백 효과", // EFFECT — 들어온 순서(흑백 먼저)와 달리 id 오름차순
                "하트 스티커", "고양이 풍선 스티커", // STICKER
                "우주 배경"); // BACKGROUND
    }

    @Test
    @DisplayName("분류 정렬은 이름 알파벳순이 아니다 — DB 정렬로 바꾸면 이 순서가 깨진다")
    void categoryOrderIsNotAlphabetical() {
        List<String> names = namesFrom(List.of(
                item(1, "배경", ItemCategory.BACKGROUND),
                item(2, "가면", ItemCategory.MASK)));

        // 알파벳순이면 BACKGROUND 가 먼저다. 화면 순서는 가면이 먼저다.
        assertThat(names).containsExactly("가면", "배경");
    }

    @Test
    @DisplayName("들어온 순서가 달라도 같은 결과 — 조회마다 순서가 튀지 않는다")
    void orderIsStableRegardlessOfRowOrder() {
        List<Item> items = List.of(
                item(5, "A", ItemCategory.STICKER),
                item(2, "B", ItemCategory.MASK),
                item(8, "C", ItemCategory.EFFECT));

        List<String> forward = namesFrom(items);
        List<String> reversed = namesFrom(items.reversed());

        assertThat(forward).isEqualTo(reversed).containsExactly("B", "C", "A");
    }
}
