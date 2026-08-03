/**
 * 꾸미기 저장 요청의 모양 — 숫자 네 개가 빠짐없이 실려야 한다.
 *
 * 백엔드 `Placement`는 x·y·scale·intensity가 primitive double이고, Jackson 3은 record의 빠진
 * 프로퍼티를 null로 본다(FAIL_ON_NULL_FOR_PRIMITIVES 기본 켜짐). 그래서 필드 하나가 빠지면
 * 본문 전체가 400으로 거절돼 **아이템을 새로 장착한 뒤의 저장만 조용히 실패**했다 —
 * 새로고침하면 서버 응답이 그 필드를 채워 주니 다시 되고, 그래서 간헐적인 고장으로 보였다.
 *
 * 서버가 어차피 clamp하는데 프론트에서도 채우는 이유: 이건 값의 정확도가 아니라 **본문이 파싱
 * 가능한가**의 문제라, 한쪽만 고쳐 두면 다른 쪽이 되돌아갈 때 같은 증상이 다시 난다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecorationConfig, InventoryItem } from '@/api'

const { getInventory, getDecoration, setEquipped, saveDecoration } = vi.hoisted(() => ({
  getInventory: vi.fn(),
  getDecoration: vi.fn(),
  setEquipped: vi.fn(),
  saveDecoration: vi.fn(),
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    usersApi: { getInventory, getDecoration, setEquipped, saveDecoration },
  }
})

const { useDecoration } = await import('@/composables/useDecoration')

const item = (itemId: number, category: InventoryItem['category'], equipped = false): InventoryItem => ({
  itemId,
  name: `item-${itemId}`,
  category,
  imageUrl: category === 'EFFECT' ? '/assets/item/effect/soft_glow.svg' : `/assets/item/sticker/${itemId}.png`,
  equipped,
  acquiredAt: '2026-08-01T00:00:00Z',
})

/** 저장 요청에 실린 배치 목록 */
function sentItems() {
  const body = saveDecoration.mock.calls.at(-1)?.[0] as DecorationConfig
  return body.config.items
}

beforeEach(() => {
  vi.clearAllMocks()
  getDecoration.mockResolvedValue({ config: { version: 1, items: [] } })
  // 서버는 보낸 것을 그대로 돌려준다고 본다 — 여기서 검증하는 건 보내는 쪽이다.
  saveDecoration.mockImplementation((body: DecorationConfig) => Promise.resolve(body))
})

describe('꾸미기 저장 요청', () => {
  it('새로 장착한 스티커도 intensity를 포함해 보낸다', async () => {
    getInventory.mockResolvedValue([item(3, 'STICKER')])
    setEquipped.mockResolvedValue(item(3, 'STICKER', true))

    const decor = useDecoration()
    await decor.load()
    await decor.setEquipped(3, true)
    expect(await decor.save()).toBe(true)

    // 네 숫자가 모두 있어야 한다 — 하나라도 빠지면 서버가 본문 전체를 거절한다.
    expect(sentItems()[0]).toEqual({
      itemId: 3,
      anchor: 'FIXED',
      x: 0.78,
      y: 0.2,
      scale: 0.22,
      intensity: 0,
    })
  })

  it('효과는 세기를 싣고 좌표·크기는 0으로 보낸다', async () => {
    getInventory.mockResolvedValue([item(9, 'EFFECT')])
    setEquipped.mockResolvedValue(item(9, 'EFFECT', true))

    const decor = useDecoration()
    await decor.load()
    await decor.setEquipped(9, true)
    decor.setIntensity(9, 0.8)
    await decor.save()

    expect(sentItems()[0]).toEqual({
      itemId: 9,
      anchor: 'FRAME',
      x: 0,
      y: 0,
      scale: 0,
      intensity: 0.8,
    })
  })

  it('NaN 좌표가 섞여도 유한한 수로 보낸다 — JSON에서 null이 되면 400이다', async () => {
    getInventory.mockResolvedValue([item(3, 'STICKER')])
    setEquipped.mockResolvedValue(item(3, 'STICKER', true))

    const decor = useDecoration()
    await decor.load()
    await decor.setEquipped(3, true)
    decor.move(3, Number.NaN, Number.NaN)
    decor.setScale(3, Number.NaN)
    await decor.save()

    const sent = sentItems()[0]
    expect(Number.isFinite(sent.x)).toBe(true)
    expect(Number.isFinite(sent.y)).toBe(true)
    expect(Number.isFinite(sent.scale)).toBe(true)
    expect(Number.isFinite(sent.intensity ?? Number.NaN)).toBe(true)
  })

  it('스티커와 효과가 섞여 있어도 모든 칸이 완전하다', async () => {
    getInventory.mockResolvedValue([item(3, 'STICKER'), item(9, 'EFFECT')])
    setEquipped.mockImplementation((itemId: number) =>
      Promise.resolve(item(itemId, itemId === 9 ? 'EFFECT' : 'STICKER', true)),
    )

    const decor = useDecoration()
    await decor.load()
    await decor.setEquipped(3, true)
    await decor.setEquipped(9, true)
    await decor.save()

    expect(sentItems()).toHaveLength(2)
    for (const p of sentItems()) {
      for (const key of ['x', 'y', 'scale', 'intensity'] as const) {
        expect(Number.isFinite(p[key] ?? Number.NaN)).toBe(true)
      }
    }
  })
})
