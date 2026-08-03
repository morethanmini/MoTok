import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import {
  DECOR_TOPIC,
  MAX_SPRITES,
  encodeDecorMessage,
  parseDecorMessage,
  type DecorState,
} from '@/features/decor/decorSync'
import { useDecorSync, type DecorTransport } from '@/composables/useDecorSync'
import type { StickerSprite } from '@/features/decor/sticker'
import type { CameraEffect } from '@/features/decor/cameraEffect'

const sprite = (over: Partial<StickerSprite> = {}): StickerSprite => ({
  itemId: 1,
  anchor: 'FIXED',
  x: 0.5,
  y: 0.5,
  scale: 0.2,
  imageUrl: '/assets/item/sticker/heart_1.png',
  ...over,
})

/** 스티커만 있는 상태 — 효과까지 보는 테스트만 effect를 채운다. */
const state = (sprites: StickerSprite[], effect: CameraEffect | null = null): DecorState => ({
  sprites,
  effect,
})

describe('decorSync 메시지', () => {
  it('보낸 배치를 그대로 되돌려 받는다', () => {
    const sprites = [sprite(), sprite({ itemId: 2, imageUrl: 'https://cdn.example.com/a.png' })]
    expect(parseDecorMessage(encodeDecorMessage(state(sprites)))).toEqual(state(sprites))
  })

  it('범위를 벗어난 좌표·크기는 다듬는다', () => {
    const got = parseDecorMessage(encodeDecorMessage(state([sprite({ x: 9, y: -3, scale: 50 })])))
    expect(got?.sprites[0]).toMatchObject({ x: 1, y: 0, scale: 1 })
  })

  it('그릴 수 없는 이미지 주소는 버린다', () => {
    for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.example/a.png', '']) {
      expect(parseDecorMessage(encodeDecorMessage(state([sprite({ imageUrl })])))?.sprites).toEqual([])
    }
  })

  it('장착 한도를 넘는 개수는 잘라낸다', () => {
    const many = Array.from({ length: MAX_SPRITES + 5 }, (_, i) => sprite({ itemId: i }))
    expect(parseDecorMessage(encodeDecorMessage(state(many)))?.sprites).toHaveLength(MAX_SPRITES)
  })

  it('가면은 보내지 않는다 — 내 얼굴 좌표를 남의 화면에 얹으면 엉뚱한 자리에 뜬다', () => {
    const mask = sprite({ itemId: 5, anchor: 'FACE', imageUrl: '/assets/item/mask/mong_mask.png' })
    const got = parseDecorMessage(encodeDecorMessage(state([sprite(), mask])))

    // 스티커는 그대로 가고 가면만 빠진다
    expect(got?.sprites.map((s) => s.itemId)).toEqual([1])
  })

  it('가면만 장착한 상태는 빈 목록으로 나간다 — "다 뗐다"와 같은 모양이어야 한다', () => {
    const mask = sprite({ anchor: 'FACE', imageUrl: '/assets/item/mask/mong_mask.png' })

    expect(parseDecorMessage(encodeDecorMessage(state([mask])))?.sprites).toEqual([])
  })

  it('프레임 효과도 함께 실어 보낸다', () => {
    const fx: CameraEffect = { itemId: 9, kind: 'SOFT_GLOW', intensity: 0.4 }
    const got = parseDecorMessage(encodeDecorMessage(state([sprite()], fx)))
    expect(got?.effect).toEqual(fx)
  })

  it('효과 세기는 0~1로 다듬는다', () => {
    const over = parseDecorMessage(encodeDecorMessage(state([], { itemId: 9, kind: 'SOFT_GLOW' as const, intensity: 5 })))
    expect(over?.effect?.intensity).toBe(1)
    const under = parseDecorMessage(encodeDecorMessage(state([], { itemId: 9, kind: 'SOFT_GLOW' as const, intensity: -2 })))
    expect(under?.effect?.intensity).toBe(0)
  })

  it('효과를 뗐으면 null로 알린다 — "껐다"도 전해져야 한다', () => {
    expect(parseDecorMessage(encodeDecorMessage(state([sprite()], null)))?.effect).toBeNull()
  })

  it('효과를 모르는 옛 클라이언트 메시지도 그대로 읽는다 — 버전을 올리지 않은 이유', () => {
    // effect 필드가 아예 없는 v1 메시지(스티커만 보내던 시절)
    const legacy = JSON.stringify({ v: 1, sprites: [sprite()] })
    const got = parseDecorMessage(legacy)
    expect(got?.sprites).toHaveLength(1)
    expect(got?.effect).toBeNull()
  })

  it('망가진 효과는 버리고 스티커는 살린다', () => {
    const broken = [
      { itemId: 'x', kind: 'SOFT_GLOW', intensity: 0.5 },
      { itemId: 9, intensity: 0.5 }, // 종류 없음(옛 형식)
      { itemId: 9, kind: 'NEON', intensity: 0.5 }, // 우리가 모르는 종류
      { itemId: 9, kind: 'SOFT_GLOW' }, // 세기 없음
      'nope',
      3,
    ]
    for (const effect of broken) {
      const got = parseDecorMessage(JSON.stringify({ v: 1, sprites: [sprite()], effect }))
      expect(got?.sprites).toHaveLength(1)
      expect(got?.effect).toBeNull()
    }
  })

  it('규약이 안 맞는 메시지는 null', () => {
    expect(parseDecorMessage('not json')).toBeNull()
    expect(parseDecorMessage(JSON.stringify({ v: 99, sprites: [] }))).toBeNull()
    expect(parseDecorMessage(JSON.stringify({ v: 1 }))).toBeNull()
  })
})

/** 참가자 한 명분 가짜 전송 — 보낸 목록을 그대로 들고 있고, 수신은 손으로 흘려 넣는다. */
function fakeTransport() {
  const sent: { payload: string; to?: string[] }[] = []
  let data: ((payload: string, from: string, topic?: string) => void) | undefined
  let join: ((identity: string) => void) | undefined
  let leave: ((identity: string) => void) | undefined
  const transport: DecorTransport = {
    sendData: (payload, to) => void sent.push({ payload, to }),
    onData: (cb) => ((data = cb), () => (data = undefined)),
    onParticipantJoin: (cb) => ((join = cb), () => (join = undefined)),
    onParticipantLeave: (cb) => ((leave = cb), () => (leave = undefined)),
  }
  return {
    transport,
    sent,
    receive: (payload: string, from: string, topic = DECOR_TOPIC) => data?.(payload, from, topic),
    joins: (identity: string) => join?.(identity),
    leaves: (identity: string) => leave?.(identity),
  }
}

describe('useDecorSync', () => {
  it('받은 배치를 그 참가자 것으로 들고 있다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    expect(sync.spritesOf('7')).toEqual([])
    t.receive(encodeDecorMessage(state([sprite()])), '7')
    expect(sync.spritesOf('7')).toEqual([sprite()])

    t.leaves('7')
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('다른 토픽 메시지는 무시한다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    t.receive(encodeDecorMessage(state([sprite()])), '7', 'chat')
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('새로 들어온 사람에게는 그 사람에게만 보낸다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => state([sprite()])))

    t.joins('9')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]?.to).toEqual(['9'])
    expect(parseDecorMessage(t.sent[0]!.payload)).toEqual(state([sprite()]))
    scope.stop()
  })

  it('아직 알린 적 없는 사람에게서 받으면 답장하고, 그 뒤로는 왕복하지 않는다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => state([sprite()])))

    t.receive(encodeDecorMessage(state([])), '7')
    expect(t.sent.map((s) => s.to)).toEqual([['7']])

    t.receive(encodeDecorMessage(state([])), '7')
    expect(t.sent).toHaveLength(1)
    scope.stop()
  })

  it('이미 알린 사람에게는 답장하지 않는다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([sprite()])))!

    t.joins('7')
    t.receive(encodeDecorMessage(state([])), '7')
    expect(t.sent).toHaveLength(1)
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('그 참가자 영상에 걸 효과를 따로 꺼내 준다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    expect(sync.effectOf('7')).toBeNull()
    t.receive(encodeDecorMessage(state([], { itemId: 9, kind: 'SOFT_GLOW' as const, intensity: 0.3 })), '7')
    expect(sync.effectOf('7')).toEqual({ itemId: 9, kind: 'SOFT_GLOW' as const, intensity: 0.3 })

    // 그 사람이 효과를 떼면 곧바로 사라진다
    t.receive(encodeDecorMessage(state([])), '7')
    expect(sync.effectOf('7')).toBeNull()

    t.leaves('7')
    expect(sync.effectOf('7')).toBeNull()
    scope.stop()
  })

  it('세기만 바뀌어도 방 전체에 다시 보낸다 — 슬라이더를 끌면 상대 화면도 따라와야 한다', async () => {
    const t = fakeTransport()
    const mine = ref<DecorState>(state([], { itemId: 9, kind: 'SOFT_GLOW' as const, intensity: 0.2 }))
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => mine.value))

    mine.value = state([], { itemId: 9, kind: 'SOFT_GLOW' as const, intensity: 0.8 })
    await vi.waitFor(() => expect(t.sent).toHaveLength(1))
    expect(parseDecorMessage(t.sent[0]!.payload)?.effect?.intensity).toBe(0.8)
    scope.stop()
  })

  it('내 배치가 바뀌면 방 전체에 다시 보낸다', async () => {
    const t = fakeTransport()
    const mine = ref<DecorState>(state([]))
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => mine.value))

    mine.value = state([sprite()])
    await vi.waitFor(() => expect(t.sent).toHaveLength(1))
    expect(t.sent[0]?.to).toBeUndefined()
    scope.stop()
  })
})
