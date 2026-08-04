package ssafy.a706.backend.decor;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import ssafy.a706.backend.decor.controller.dto.DecorConfigPayload;
import ssafy.a706.backend.decor.controller.dto.DecorationResponse;
import ssafy.a706.backend.decor.model.DecorAnchor;
import ssafy.a706.backend.decor.model.DecorSetting;
import ssafy.a706.backend.decor.repository.DecorSettingRepository;
import ssafy.a706.backend.decor.service.DecorService;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.shop.repository.dto.OwnedItemRow;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 배치의 <b>앵커는 분류가 정한다</b> — 클라이언트가 보낸 값을 그대로 쓰지 않는다.
 *
 * <p>가면이 {@code FIXED}로 저장되면 얼굴을 따라가야 할 그림이 스티커 기본 좌표
 * (0.78, 0.20)에 못 박혀 오른쪽 위 구석에 뜬다. 장착 직후에는 프론트가 로컬로 FACE를 넣어
 * 두어 멀쩡해 보이다가 <b>새로고침한 뒤에야</b> 어긋나므로, 눈으로 잡기 어려운 자리다.</p>
 *
 * <p>반대 방향도 막는다 — 스티커를 FACE로 보내오면 남의 얼굴 위로 올라간다.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DecorAnchorByCategoryTest {

    private static final Long USER_ID = 7L;
    private static final Long MASK_ID = 1L;
    private static final Long STICKER_ID = 2L;
    private static final Long EFFECT_ID = 3L;

    @Mock private UserItemRepository userItemRepository;
    @Mock private DecorSettingRepository decorSettingRepository;

    private DecorService decorService;
    private String storedConfig;

    @BeforeEach
    void setUp() {
        // 매퍼는 목이 아니라 진짜다 — config가 JSON 문자열로 오가므로 직렬화까지 거쳐야
        // 실제로 저장되는 값을 볼 수 있다(@InjectMocks로는 목이 아닌 것을 넣지 못한다).
        ObjectMapper objectMapper = JsonMapper.builder().build();
        decorService = new DecorService(userItemRepository, decorSettingRepository, objectMapper);
        storedConfig = null;
        when(userItemRepository.findOwnedItems(USER_ID)).thenReturn(List.of(
                row(MASK_ID, "고양이 가면", ItemCategory.MASK),
                row(STICKER_ID, "하트 스티커", ItemCategory.STICKER),
                row(EFFECT_ID, "뽀샤시 효과", ItemCategory.EFFECT)));
        when(decorSettingRepository.findById(USER_ID))
                .thenAnswer(i -> Optional.ofNullable(storedConfig).map(c -> new DecorSetting(USER_ID, c)));
        when(decorSettingRepository.save(any(DecorSetting.class))).thenAnswer(i -> {
            DecorSetting setting = i.getArgument(0);
            storedConfig = setting.getConfig();
            return setting;
        });
    }

    private OwnedItemRow row(Long itemId, String name, ItemCategory category) {
        return new OwnedItemRow(itemId, name, category, "/assets/x.png", LocalDateTime.now());
    }

    private DecorConfigPayload.Placement equipAndRead(Long itemId) {
        decorService.setEquipped(USER_ID, itemId, true);
        return decorService.getDecoration(USER_ID).config().safeItems().stream()
                .filter(p -> p.itemId().equals(itemId))
                .findFirst()
                .orElseThrow();
    }

    @Test
    @DisplayName("가면을 장착하면 FACE로 붙는다 — 좌표는 매 프레임 얼굴에서 잡으므로 저장하지 않는다")
    void maskGetsFaceAnchor() {
        DecorConfigPayload.Placement mask = equipAndRead(MASK_ID);

        assertThat(mask.anchor()).isEqualTo(DecorAnchor.FACE);
        // 스티커 기본 좌표가 들어가면 추적이 붙기 전 화면에서 오른쪽 위에 떠 버린다
        assertThat(mask.x()).isZero();
        assertThat(mask.y()).isZero();
        assertThat(mask.scale()).isZero();
    }

    @Test
    @DisplayName("스티커는 그대로 FIXED에 기본 좌표 — 가면 규칙이 스티커를 건드리지 않는다")
    void stickerKeepsFixedAnchor() {
        DecorConfigPayload.Placement sticker = equipAndRead(STICKER_ID);

        assertThat(sticker.anchor()).isEqualTo(DecorAnchor.FIXED);
        assertThat(sticker.x()).isPositive();
        assertThat(sticker.scale()).isPositive();
    }

    @Test
    @DisplayName("효과는 그대로 FRAME에 기본 세기")
    void effectKeepsFrameAnchor() {
        DecorConfigPayload.Placement effect = equipAndRead(EFFECT_ID);

        assertThat(effect.anchor()).isEqualTo(DecorAnchor.FRAME);
        assertThat(effect.intensity()).isPositive();
    }

    @Test
    @DisplayName("저장할 때 가면을 FIXED로 보내와도 FACE로 되돌린다 — 앵커는 분류가 정한다")
    void saveOverridesClientAnchorForMask() {
        DecorationResponse saved = decorService.saveDecoration(USER_ID, new DecorConfigPayload(1, List.of(
                new DecorConfigPayload.Placement(MASK_ID, DecorAnchor.FIXED, 0.78, 0.2, 0.22, 0),
                // 반대 방향도 — 스티커가 FACE로 오면 남의 얼굴 위로 올라간다
                new DecorConfigPayload.Placement(STICKER_ID, DecorAnchor.FACE, 0.3, 0.4, 0.2, 0))));

        assertThat(saved.config().safeItems())
                .extracting(DecorConfigPayload.Placement::itemId, DecorConfigPayload.Placement::anchor)
                .containsExactly(
                        Tuple.tuple(MASK_ID, DecorAnchor.FACE),
                        Tuple.tuple(STICKER_ID, DecorAnchor.FIXED));

        // 가면의 좌표는 버린다. 스티커 좌표는 보낸 대로 남는다.
        DecorConfigPayload.Placement mask = saved.config().safeItems().get(0);
        assertThat(mask.x()).isZero();
        assertThat(mask.scale()).isZero();
        assertThat(saved.config().safeItems().get(1).x()).isEqualTo(0.3);
    }
}
