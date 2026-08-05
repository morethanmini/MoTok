package ssafy.a706.backend.decor.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.decor.controller.dto.DecorConfigPayload;
import ssafy.a706.backend.decor.controller.dto.DecorationResponse;
import ssafy.a706.backend.decor.controller.dto.InventoryItemResponse;
import ssafy.a706.backend.decor.model.DecorAnchor;
import ssafy.a706.backend.decor.model.DecorSetting;
import ssafy.a706.backend.decor.repository.DecorSettingRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.shop.model.ItemCategory;
import ssafy.a706.backend.shop.repository.UserItemRepository;
import ssafy.a706.backend.shop.repository.dto.OwnedItemRow;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 인벤토리(보유 아이템) 조회와 화면 꾸미기 설정(-56 후속).
 *
 * 장착 여부를 따로 저장하지 않고 decor_setting.config의 배치 목록에서 파생한다 —
 * "장착했다"는 곧 "화면 어딘가에 붙어 있다"는 뜻이라, 둘을 나눠 두면 장착됐는데 좌표가 없거나
 * 좌표는 있는데 장착이 풀린 모순 상태가 생긴다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DecorService {

    /** 새로 장착했을 때의 기본 위치 — 오른쪽 위(얼굴을 가리지 않는 자리). 이후 사용자가 옮긴다. */
    private static final double DEFAULT_X = 0.78;
    private static final double DEFAULT_Y = 0.20;
    private static final double DEFAULT_SCALE = 0.22;

    /**
     * 분류별 동시 장착 한도.
     * 스티커는 여러 개를 흩어 붙이는 물건이라 5개까지, 가면·효과·배경은 화면 전체를 차지해
     * 두 개를 겹치면 뭘 골랐는지 알 수 없으므로 1개다.
     */
    private static final Map<ItemCategory, Integer> EQUIP_LIMIT = Map.of(
            ItemCategory.STICKER, 5,
            ItemCategory.MASK, 1,
            ItemCategory.EFFECT, 1,
            ItemCategory.BACKGROUND, 1);

    /** config가 무한정 커지는 걸 막는 전체 상한 — 분류별 한도의 합이다. */
    private static final int MAX_PLACEMENTS =
            EQUIP_LIMIT.values().stream().mapToInt(Integer::intValue).sum();

    private static final double MIN_SCALE = 0.05;
    private static final double MAX_SCALE = 1.0;

    /**
     * 프레임 전체 효과(FRAME)의 기본 세기. 처음 장착했을 때 "걸렸다"는 게 보여야 하되
     * 과하지 않은 지점이다 — 0이면 장착해도 아무 변화가 없어 고장으로 읽힌다.
     */
    private static final double DEFAULT_INTENSITY = 0.5;

    private final UserItemRepository userItemRepository;
    private final DecorSettingRepository decorSettingRepository;
    private final ObjectMapper objectMapper;

    /** GET /users/me/inventory — 보유 아이템 + 장착 여부. */
    public List<InventoryItemResponse> listInventory(Long userId) {
        Set<Long> equipped = equippedItemIds(readConfig(userId));
        return userItemRepository.findOwnedItems(userId).stream()
                .map(row -> toResponse(row, equipped.contains(row.itemId())))
                .toList();
    }

    /**
     * PATCH /users/me/inventory/{itemId} — 장착/해제.
     * 장착은 배치 목록에 기본 위치로 추가하고(이미 있으면 위치 유지), 해제는 목록에서 뺀다.
     */
    @Transactional
    public InventoryItemResponse setEquipped(Long userId, Long itemId, boolean equipped) {
        OwnedItemRow row = userItemRepository.findOwnedItems(userId).stream()
                .filter(r -> r.itemId().equals(itemId))
                .findFirst()
                // 보유하지 않은 아이템은 장착 대상이 아니다(존재 여부까지 구분해 알려 줄 이유가 없다).
                .orElseThrow(() -> new BusinessException(ErrorCode.ITEM_NOT_FOUND));

        List<DecorConfigPayload.Placement> next = new ArrayList<>(readConfig(userId).safeItems());
        boolean already = next.stream().anyMatch(p -> p.itemId().equals(itemId));

        if (equipped && !already) {
            // 분류별 한도 — 어떤 분류가 몇 개 붙어 있는지는 보유 목록의 category로 센다.
            Map<Long, ItemCategory> categoryOf = categoryByItemId(userId);
            ItemCategory category = row.category();
            long equippedInCategory = next.stream()
                    .filter(p -> categoryOf.get(p.itemId()) == category)
                    .count();
            if (equippedInCategory >= EQUIP_LIMIT.getOrDefault(category, 1)) {
                throw new BusinessException(ErrorCode.DECOR_EQUIP_LIMIT);
            }
            next.add(newPlacement(itemId, category));
        } else if (!equipped) {
            next.removeIf(p -> p.itemId().equals(itemId));
        }

        writeConfig(userId, new DecorConfigPayload(DecorConfigPayload.CURRENT_VERSION, next));
        return toResponse(row, equipped);
    }

    /** GET /users/me/decoration */
    public DecorationResponse getDecoration(Long userId) {
        DecorSetting setting = decorSettingRepository.findById(userId).orElse(null);
        return setting == null
                ? new DecorationResponse(DecorConfigPayload.empty(), null)
                : new DecorationResponse(parse(setting.getConfig()), setting.getUpdatedAt());
    }

    /**
     * PUT /users/me/decoration — 배치 저장(전체 교체).
     * 보내온 값을 그대로 믿지 않고 보유 아이템만 남기고 좌표·크기를 유효 범위로 자른다.
     */
    @Transactional
    public DecorationResponse saveDecoration(Long userId, DecorConfigPayload requested) {
        Map<Long, ItemCategory> categoryOf = categoryByItemId(userId);

        // 같은 아이템이 여러 번 오면 마지막 것만 남긴다(한 아이템은 화면에 하나).
        Map<Long, DecorConfigPayload.Placement> sanitized = new LinkedHashMap<>();
        for (DecorConfigPayload.Placement p : requested.safeItems()) {
            if (p == null || p.itemId() == null || !categoryOf.containsKey(p.itemId())) {
                continue; // 보유하지 않은 아이템
            }
            // 앵커는 클라이언트 말을 듣지 않고 분류에서 정한다(anchorOf 주석 참고).
            DecorAnchor anchor = anchorOf(categoryOf.get(p.itemId()));
            sanitized.put(p.itemId(), switch (anchor) {
                // 효과·배경은 붙는 자리가 없고 세기만 갖는다 — 저장 형태가 같아 함께 다룬다.
                case FRAME, BACKGROUND -> new DecorConfigPayload.Placement(
                        p.itemId(), anchor, 0, 0, 0, clamp(p.intensity(), 0, 1));
                // 가면의 좌표·크기는 클라이언트가 얼굴에서 매 프레임 다시 잡는다 — 저장하지 않는다.
                case FACE -> new DecorConfigPayload.Placement(
                        p.itemId(), DecorAnchor.FACE, 0, 0, 0, 0);
                default -> new DecorConfigPayload.Placement(
                        p.itemId(),
                        anchor,
                        clamp(p.x(), 0, 1),
                        clamp(p.y(), 0, 1),
                        clamp(p.scale(), MIN_SCALE, MAX_SCALE),
                        0);
            });
        }

        // 분류별 한도 초과는 잘라 내지 않고 거절한다 — 조용히 몇 개를 버리면
        // 저장은 성공했는데 화면에서 스티커가 사라진 것처럼 보인다.
        Map<ItemCategory, Long> countByCategory = sanitized.keySet().stream()
                .collect(Collectors.groupingBy(categoryOf::get, Collectors.counting()));
        for (Map.Entry<ItemCategory, Long> entry : countByCategory.entrySet()) {
            if (entry.getValue() > EQUIP_LIMIT.getOrDefault(entry.getKey(), 1)) {
                throw new BusinessException(ErrorCode.DECOR_EQUIP_LIMIT);
            }
        }

        DecorConfigPayload payload =
                new DecorConfigPayload(DecorConfigPayload.CURRENT_VERSION, List.copyOf(sanitized.values()));
        DecorSetting saved = writeConfig(userId, payload);
        return new DecorationResponse(payload, saved.getUpdatedAt());
    }

    // ── 내부 ────────────────────────────────────────────────

    /**
     * 새로 장착한 아이템의 배치 — <b>앵커는 분류가 정한다</b>.
     *
     * <p>스티커만 화면 좌표를 쓴다. 효과는 프레임 전체에 걸려 붙는 자리가 없고, 가면은
     * 클라이언트가 매 프레임 얼굴에서 자리·크기를 계산하므로 저장할 좌표가 없다 — 둘 다
     * 0을 넣어 "여기 있는 숫자는 의미가 없다"를 분명히 한다. 가면에 스티커 기본 좌표
     * (0.78, 0.20)를 넣어 두면 추적이 붙기 전 화면에서 오른쪽 위에 떠 버린다.</p>
     */
    private DecorConfigPayload.Placement newPlacement(Long itemId, ItemCategory category) {
        return switch (category) {
            case EFFECT -> new DecorConfigPayload.Placement(
                    itemId, DecorAnchor.FRAME, 0, 0, 0, DEFAULT_INTENSITY);
            case BACKGROUND -> new DecorConfigPayload.Placement(
                    itemId, DecorAnchor.BACKGROUND, 0, 0, 0, DEFAULT_INTENSITY);
            case MASK -> new DecorConfigPayload.Placement(
                    itemId, DecorAnchor.FACE, 0, 0, 0, 0);
            default -> new DecorConfigPayload.Placement(
                    itemId, DecorAnchor.FIXED, DEFAULT_X, DEFAULT_Y, DEFAULT_SCALE, 0);
        };
    }

    /**
     * 분류가 정하는 앵커. 클라이언트가 보내온 값을 그대로 믿지 않는다 —
     * 가면을 FIXED로 보내오면 얼굴을 따라가야 할 그림이 화면 한구석에 못 박히고,
     * 스티커를 FACE로 보내오면 남의 얼굴 위로 올라간다.
     * 스티커(그 외)만 클라이언트가 보낸 좌표를 쓴다.
     */
    private static DecorAnchor anchorOf(ItemCategory category) {
        return switch (category) {
            case EFFECT -> DecorAnchor.FRAME;
            case BACKGROUND -> DecorAnchor.BACKGROUND;
            case MASK -> DecorAnchor.FACE;
            default -> DecorAnchor.FIXED;
        };
    }

    /** 보유 아이템 id → 분류. 한도 검사는 "무엇을 몇 개 붙였나"라 분류를 알아야 한다. */
    private Map<Long, ItemCategory> categoryByItemId(Long userId) {
        return userItemRepository.findOwnedItems(userId).stream()
                .collect(Collectors.toMap(OwnedItemRow::itemId, OwnedItemRow::category, (a, b) -> a));
    }

    private DecorConfigPayload readConfig(Long userId) {
        return decorSettingRepository.findById(userId)
                .map(s -> parse(s.getConfig()))
                .orElseGet(DecorConfigPayload::empty);
    }

    private DecorSetting writeConfig(Long userId, DecorConfigPayload payload) {
        String json = objectMapper.writeValueAsString(payload);
        DecorSetting setting = decorSettingRepository.findById(userId).orElse(null);
        if (setting == null) {
            return decorSettingRepository.save(new DecorSetting(userId, json));
        }
        setting.updateConfig(json);
        return setting;
    }

    /**
     * 저장된 JSON 파싱. 형식이 깨졌으면(수동 수정·과거 버전) 빈 설정으로 되돌린다 —
     * 꾸미기 설정 하나 때문에 인벤토리 화면 전체가 500이 되는 게 더 나쁘다.
     */
    private DecorConfigPayload parse(String json) {
        try {
            DecorConfigPayload parsed = objectMapper.readValue(json, DecorConfigPayload.class);
            return parsed == null ? DecorConfigPayload.empty() : parsed;
        } catch (RuntimeException e) {
            return DecorConfigPayload.empty();
        }
    }

    private static Set<Long> equippedItemIds(DecorConfigPayload config) {
        return config.safeItems().stream()
                .filter(p -> p != null && p.itemId() != null)
                .map(DecorConfigPayload.Placement::itemId)
                .collect(Collectors.toSet());
    }

    private static InventoryItemResponse toResponse(OwnedItemRow row, boolean equipped) {
        return new InventoryItemResponse(
                row.itemId(), row.name(), row.category(), row.imageUrl(), equipped, row.acquiredAt());
    }

    private static double clamp(double value, double min, double max) {
        if (Double.isNaN(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
    }
}
