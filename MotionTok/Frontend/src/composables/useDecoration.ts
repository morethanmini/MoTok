/**
 * 내 보유 아이템 + 장착 배치를 함께 다룬다 (/users/me/inventory, /users/me/decoration).
 *
 * 인벤토리(아이템 이미지)와 꾸미기 설정(좌표)이 서로 다른 API라 둘을 합쳐야 화면에 그릴 수 있다.
 * 인벤토리 편집·입장 전 장치 설정·게임룸이 같은 결과를 쓰도록 병합 규칙을 여기 한 곳에 둔다.
 */
import { computed, ref } from 'vue'
import { ApiError, usersApi, type DecorPlacement, type InventoryItem, type ItemCategory } from '@/api'
import {
  DEFAULT_PLACEMENT,
  clamp01,
  clampScale,
  preloadSprites,
  type StickerSprite,
} from '@/features/decor/sticker'
import {
  DEFAULT_INTENSITY,
  clampIntensity,
  effectKindOf,
  type CameraEffect,
} from '@/features/decor/cameraEffect'

/**
 * 분류별 동시 장착 한도 — 백엔드 DecorService.EQUIP_LIMIT와 같은 값을 유지한다.
 * 여기 값은 버튼을 미리 잠가 주는 용도고, 실제 판정은 서버가 한다(둘이 어긋나면 서버가 이긴다).
 */
export const EQUIP_LIMIT: Record<ItemCategory, number> = {
  STICKER: 5,
  MASK: 1,
  EFFECT: 1,
  BACKGROUND: 1,
}

/**
 * 서버로 보낼 배치 한 칸 — <b>숫자 네 개를 빠짐없이 채운다</b>.
 *
 * 백엔드 Placement는 x·y·scale·intensity가 primitive double이라, 필드가 빠지거나 값이 null이면
 * (자바스크립트 NaN은 JSON에서 null이 된다) Jackson이 본문 전체를 못 읽어 400이 된다 —
 * 스티커 한 칸 때문에 효과 세기까지 저장되지 않는다. 화면 상태를 그대로 싣지 않고 여기서 한 번
 * 채우는 이유: 저장을 부르는 화면이 인벤토리·장치 설정·게임룸 셋이라 각자 챙기면 또 빠진다.
 *
 * 효과의 x·y·scale을 0으로 보내는 건 서버의 정규화(DecorService.saveDecoration)와 같은 규칙이다 —
 * 붙는 자리도 크기도 없는 물건에 의미 없는 좌표를 실어 보내지 않는다.
 */
function toRequestBody(p: DecorPlacement): Required<DecorPlacement> {
  if (p.anchor === 'FRAME') {
    return {
      itemId: p.itemId,
      anchor: 'FRAME',
      x: 0,
      y: 0,
      scale: 0,
      intensity: clampIntensity(p.intensity ?? DEFAULT_INTENSITY),
    }
  }
  return {
    itemId: p.itemId,
    anchor: p.anchor,
    x: clamp01(p.x),
    y: clamp01(p.y),
    scale: clampScale(p.scale),
    intensity: 0,
  }
}

export function useDecoration() {
  const inventory = ref<InventoryItem[]>([])
  const placements = ref<DecorPlacement[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  /** 저장하지 않은 배치 변경이 있는지. 장착/해제는 PATCH로 바로 반영되므로 여기 해당하지 않는다. */
  const dirty = ref(false)

  const imageOf = computed(() => new Map(inventory.value.map((i) => [i.itemId, i.imageUrl])))

  /** 그릴 수 있는 것만 — 이미지가 없거나 그림으로 얹지 않는 앵커는 뺀다. */
  const sprites = computed<StickerSprite[]>(() => {
    const list = placements.value.flatMap((p) => {
      // FACE·HAND는 아직 추적기가 없어 그리지 않는다 — 엉뚱한 자리에 고정되느니 빼는 게 낫다.
      // FRAME(효과)은 그림이 아니라 CSS로 걸린다 — 여기 넣으면 아이콘이 영상에 붙어 버린다.
      if (p.anchor !== 'FIXED') return []
      const imageUrl = imageOf.value.get(p.itemId)
      return imageUrl ? [{ ...p, imageUrl }] : []
    })
    preloadSprites(list)
    return list
  })

  /**
   * 걸려 있는 프레임 효과(뽀샤시). 한도가 1개라 하나만 나온다.
   * 스티커와 달리 이미지가 필요 없다 — 아이템 그림은 목록 아이콘일 뿐이다.
   */
  const cameraEffect = computed<CameraEffect | null>(() => {
    const p = placements.value.find((it) => it.anchor === 'FRAME')
    if (!p) return null
    // 어떤 효과인지는 아이템 그림이 알려 준다 — 모르는 에셋이면 걸지 않는다(엉뚱한 효과보다 낫다).
    const kind = effectKindOf(imageOf.value.get(p.itemId))
    if (!kind) return null
    return { itemId: p.itemId, kind, intensity: clampIntensity(p.intensity ?? DEFAULT_INTENSITY) }
  })

  /** 인벤토리·배치를 함께 읽는다. 실패해도 예외를 던지지 않는다(방 입장 흐름을 막지 않도록). */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [inv, deco] = await Promise.all([usersApi.getInventory(), usersApi.getDecoration()])
      inventory.value = inv
      placements.value = deco.config?.items ?? []
      dirty.value = false
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '보유 아이템을 불러오지 못했어요'
      inventory.value = []
      placements.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 장착/해제. 서버가 장착 여부를 꾸미기 설정에서 파생하므로 PATCH 하나로 양쪽이 바뀐다.
   * 로컬 배치도 서버와 같은 규칙(기본 위치 추가 / 제거)으로 맞춘다. 성공 여부를 돌려준다.
   */
  async function setEquipped(itemId: number, equipped: boolean): Promise<boolean> {
    try {
      const updated = await usersApi.setEquipped(itemId, equipped)
      inventory.value = inventory.value.map((i) => (i.itemId === itemId ? updated : i))
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '장착 상태를 바꾸지 못했어요'
      return false
    }

    if (equipped) {
      if (!placements.value.some((p) => p.itemId === itemId)) {
        // 효과는 붙는 자리가 없다 — 서버도 분류를 보고 FRAME으로 넣으므로 규칙을 맞춘다.
        const isEffect = inventory.value.find((i) => i.itemId === itemId)?.category === 'EFFECT'
        placements.value = [
          ...placements.value,
          isEffect
            ? { itemId, anchor: 'FRAME', x: 0, y: 0, scale: 0, intensity: DEFAULT_INTENSITY }
            : { itemId, anchor: 'FIXED', ...DEFAULT_PLACEMENT, intensity: 0 },
        ]
      }
    } else {
      placements.value = placements.value.filter((p) => p.itemId !== itemId)
    }
    return true
  }

  /** 분류별 현재 장착 수 — 한도 표시·버튼 잠금에 쓴다. */
  const equippedCount = computed(() => {
    const count: Record<string, number> = {}
    for (const item of inventory.value) {
      if (item.equipped) count[item.category] = (count[item.category] ?? 0) + 1
    }
    return count
  })

  /** 지금 이 아이템을 더 장착할 수 있는지(이미 장착 중이면 해제는 언제나 가능). */
  function canEquip(item: InventoryItem): boolean {
    if (item.equipped) return true
    return (equippedCount.value[item.category] ?? 0) < EQUIP_LIMIT[item.category]
  }

  /** 스티커 위치 이동(정규화 좌표). 저장은 별도 — save()를 불러야 서버에 반영된다. */
  function move(itemId: number, x: number, y: number) {
    placements.value = placements.value.map((p) =>
      p.itemId === itemId ? { ...p, x: clamp01(x), y: clamp01(y) } : p,
    )
    dirty.value = true
  }

  /** 스티커 크기 변경(영상 짧은 변 대비 비율). */
  function setScale(itemId: number, scale: number) {
    placements.value = placements.value.map((p) =>
      p.itemId === itemId ? { ...p, scale: clampScale(scale) } : p,
    )
    dirty.value = true
  }

  /** 프레임 효과 세기 변경(0~1) — 스티커의 크기 조절에 대응하는 자리다. */
  function setIntensity(itemId: number, intensity: number) {
    placements.value = placements.value.map((p) =>
      p.itemId === itemId ? { ...p, intensity: clampIntensity(intensity) } : p,
    )
    dirty.value = true
  }

  /**
   * 배치 저장(전체 교체). 서버가 좌표를 다듬어(범위 clamp·미보유 제거) 돌려주므로 응답 기준으로 맞춘다.
   * 저장할 게 없으면 요청하지 않는다.
   */
  async function save(): Promise<boolean> {
    if (saving.value) return false
    saving.value = true
    try {
      const res = await usersApi.saveDecoration({
        config: { version: 1, items: placements.value.map(toRequestBody) },
      })
      placements.value = res.config?.items ?? []
      dirty.value = false
      return true
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '저장하지 못했어요'
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    inventory, placements, sprites, cameraEffect, equippedCount,
    loading, saving, dirty, error,
    load, setEquipped, canEquip, move, setScale, setIntensity, save,
  }
}
