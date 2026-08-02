package ssafy.a706.backend.shop;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import ssafy.a706.backend.shop.model.Item;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.model.ItemType;
import ssafy.a706.backend.shop.repository.ItemRepository;

import java.util.List;

/**
 * 상점 기본 아이템 시드. 부팅 시 없으면 넣는다(멱등).
 * imageUrl은 프론트 정적 파일 경로다(AVATAR_PRESET_PATH와 같은 방식) — 아이템 이미지는
 * 사용자 업로드가 아니라 배포에 포함된 에셋이라 S3를 거치지 않는다.
 * 판별 키를 imageUrl로 잡은 이유 — Item.id는 IDENTITY라 지정할 수 없고, 이름은 나중에 바뀔 수 있다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ShopItemSeeder implements ApplicationRunner {

    /** 시드 1건. 카테고리별로 행을 추가해 나간다(스티커 4종 · 효과 1종). */
    private record SeedItem(String name, ItemCategory category, int pricePoint, String imageUrl) {}

    private static final String STICKER_PATH = "/assets/item/sticker/";
    private static final String EFFECT_PATH = "/assets/item/effect/";

    private static final List<SeedItem> SEED_ITEMS = List.of(
            new SeedItem("하트 스티커", ItemCategory.STICKER, 150, STICKER_PATH + "heart_1.png"),
            new SeedItem("음표 스티커", ItemCategory.STICKER, 200, STICKER_PATH + "note_1.png"),
            new SeedItem("별 스티커", ItemCategory.STICKER, 250, STICKER_PATH + "star_1.png"),
            new SeedItem("고양이 풍선 스티커", ItemCategory.STICKER, 1500, STICKER_PATH + "cat_balloon.gif"),
            /*
             * 효과는 스티커와 달리 이미지를 영상 위에 얹지 않는다 — 프레임 전체에 CSS로 걸리고
             * imageUrl은 상점·인벤토리 목록의 아이콘으로만 쓴다. 세기는 사용자가 조절한다.
             *
             * 어떤 효과로 그릴지는 이 이미지 파일명으로 프론트가 고른다(cameraEffect.ts).
             * 효과 장착 한도는 1개라 둘을 동시에 걸 수는 없다.
             */
            new SeedItem("뽀샤시 효과", ItemCategory.EFFECT, 300, EFFECT_PATH + "soft_glow.svg"),
            new SeedItem("흑백 효과", ItemCategory.EFFECT, 150, EFFECT_PATH + "grayscale.svg"));

    private final ItemRepository itemRepository;

    @Override
    public void run(ApplicationArguments args) {
        for (SeedItem seed : SEED_ITEMS) {
            if (itemRepository.existsByImageUrl(seed.imageUrl())) {
                continue;
            }
            Item saved = itemRepository.save(Item.builder()
                    .name(seed.name())
                    .category(seed.category())
                    .itemType(ItemType.SHOP)
                    .pricePoint(seed.pricePoint())
                    .imageUrl(seed.imageUrl())
                    .active(true)
                    .build());
            log.info("shop item seeded: id={} {}", saved.getId(), seed.name());
        }
    }
}
