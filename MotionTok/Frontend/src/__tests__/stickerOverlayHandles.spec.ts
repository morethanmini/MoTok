/**
 * 스티커 선택 상자의 손잡이 — 삭제(✕)와 크기(⤡).
 *
 * 여기서 고정하는 건 <b>지울 대상이 없는 화면에는 ✕가 없다</b>는 것이다. 상점 미리보기는
 * 보유하지도 않은 아이템을 잠깐 걸어 보는 창이라 지울 것이 없는데, 그 자리에 ✕가 붙어 있으면
 * 눌러도 아무 일이 없는 버튼이 된다 — 화면이 고장 난 것으로 읽힌다.
 *
 * 크기 손잡이는 반대로 미리보기에도 있어야 한다(크기를 맞춰 보는 게 미리보기의 목적이다).
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StickerOverlay from '@/features/decor/StickerOverlay.vue'
import type { StickerSprite } from '@/features/decor/sticker'

const SPRITE: StickerSprite = {
  itemId: 3,
  anchor: 'FIXED',
  x: 0.5,
  y: 0.5,
  scale: 0.2,
  imageUrl: '/assets/item/sticker/heart_1.png',
}

const mountOverlay = (props: Record<string, unknown> = {}) =>
  mount(StickerOverlay, {
    props: { sprites: [SPRITE], editable: true, selectedId: SPRITE.itemId, ...props },
  })

describe('StickerOverlay 손잡이', () => {
  it('편집 화면에는 삭제·크기 손잡이가 모두 있다', () => {
    const wrapper = mountOverlay()
    expect(wrapper.find('.handle.remove').exists()).toBe(true)
    expect(wrapper.find('.handle.resize').exists()).toBe(true)
  })

  it('removable=false면 삭제 손잡이는 없고 크기 손잡이는 남는다', () => {
    const wrapper = mountOverlay({ removable: false })
    expect(wrapper.find('.handle.remove').exists()).toBe(false)
    expect(wrapper.find('.handle.resize').exists()).toBe(true)
  })

  it('삭제를 누르면 그 아이템 id를 실어 보낸다', async () => {
    const wrapper = mountOverlay()
    await wrapper.find('.handle.remove').trigger('click')
    expect(wrapper.emitted('remove')?.[0]).toEqual([SPRITE.itemId])
  })

  it('편집 화면이 아니면 선택 상자 자체가 없다 — 남의 타일에 손잡이가 붙으면 안 된다', () => {
    const wrapper = mountOverlay({ editable: false })
    expect(wrapper.find('.select-box').exists()).toBe(false)
    expect(wrapper.find('.sticker').exists()).toBe(true)
  })
})
