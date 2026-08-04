import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import {
  DECOR_FACE_TOPIC,
  DECOR_TOPIC,
  FACE_FRAME_STALE_MS,
  MAX_SPRITES,
  encodeDecorMessage,
  encodeFaceMessage,
  parseDecorMessage,
  parseFaceMessage,
  type DecorState,
} from '@/features/decor/decorSync'
import { useDecorSync, type DecorTransport } from '@/composables/useDecorSync'
import type { StickerSprite } from '@/features/decor/sticker'
import type { CameraBackground, CameraEffect } from '@/features/decor/cameraEffect'
import type { FaceAnchor } from '@/features/decor/faceAnchor'

const sprite = (over: Partial<StickerSprite> = {}): StickerSprite => ({
  itemId: 1,
  anchor: 'FIXED',
  x: 0.5,
  y: 0.5,
  scale: 0.2,
  imageUrl: '/assets/item/sticker/heart_1.png',
  ...over,
})

/** 스티커만 있는 상태 — 효과·배경·가면까지 보는 테스트만 그 자리를 채운다. */
const state = (
  sprites: StickerSprite[],
  effect: CameraEffect | null = null,
  faceSprite: StickerSprite | null = null,
  background: CameraBackground | null = null,
): DecorState => ({ sprites, effect, background, faceSprite })

const mask = (over: Partial<StickerSprite> = {}): StickerSprite => ({
  itemId: 5,
  anchor: 'FACE',
  x: 0,
  y: 0,
  scale: 0,
  imageUrl: '/assets/item/mask/mong_mask.png',
  ...over,
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

  it('가면은 sprites가 아니라 face로 나간다 — 옛 클라이언트가 구석에 붙이지 않게', () => {
    const got = parseDecorMessage(encodeDecorMessage(state([sprite()], null, mask())))

    expect(got?.sprites.map((s) => s.itemId)).toEqual([1]) // 스티커만
    expect(got?.faceSprite).toEqual(mask())
  })

  it('가면 메시지에는 좌표가 없다 — 자리는 앵커가 정한다', () => {
    const sent = JSON.parse(encodeDecorMessage(state([], null, mask({ x: 0.9, y: 0.9, scale: 0.5 }))))

    expect(Object.keys(sent.face)).toEqual(['itemId', 'imageUrl'])
    // sprites 에 섞여 나가면 이 필드를 모르는 클라이언트가 FIXED 스티커로 그린다
    expect(sent.sprites).toEqual([])
  })

  it('가면을 벗으면 face가 null — "안 썼다"가 전해져야 한다', () => {
    expect(parseDecorMessage(encodeDecorMessage(state([sprite()])))?.faceSprite).toBeNull()
  })

  it('가면을 모르는 옛 클라이언트 메시지도 그대로 읽는다', () => {
    const legacy = JSON.stringify({ v: 1, sprites: [sprite()], effect: null })
    const got = parseDecorMessage(legacy)

    expect(got?.sprites).toHaveLength(1)
    expect(got?.faceSprite).toBeNull()
  })

  it('그릴 수 없는 가면 주소는 버린다 — 스티커와 같은 기준', () => {
    for (const imageUrl of ['javascript:alert(1)', '//evil.example/a.png', '']) {
      const got = parseDecorMessage(encodeDecorMessage(state([], null, mask({ imageUrl }))))
      expect(got?.faceSprite).toBeNull()
    }
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
    expect(got?.background).toBeNull()
  })

  it('배경도 함께 실어 보낸다', () => {
    const bg: CameraBackground = { itemId: 12, kind: 'SPOTLIGHT', intensity: 0.6 }
    const got = parseDecorMessage(encodeDecorMessage(state([sprite()], null, null, bg)))
    expect(got?.background).toEqual(bg)
  })

  /*
   * 효과와 배경은 분류가 다른 칸이라 <b>동시에</b> 걸릴 수 있다. 한 필드로 합쳐 보내면
   * 둘 중 하나가 조용히 사라지는데, 그건 안 보이는 쪽이 무엇인지 알아채기 어렵다.
   */
  it('효과와 배경을 함께 걸어도 둘 다 전해진다', () => {
    const fx: CameraEffect = { itemId: 9, kind: 'SOFT_GLOW', intensity: 0.4 }
    const bg: CameraBackground = { itemId: 12, kind: 'SPOTLIGHT', intensity: 0.6 }
    const got = parseDecorMessage(encodeDecorMessage(state([], fx, null, bg)))
    expect(got?.effect).toEqual(fx)
    expect(got?.background).toEqual(bg)
  })

  /*
   * 종류 목록을 섞으면 배경이 효과 자리에 들어와 videoFilter로 흘러간다(어두운 배경이
   * 프레임 전체에 균일하게 걸려 얼굴까지 어두워진다). 서로를 모르는지 못박는다.
   */
  it('효과 자리에 온 배경 종류는 버린다 — 그 반대도 마찬가지', () => {
    const asEffect = JSON.stringify({
      v: 1,
      sprites: [],
      effect: { itemId: 9, kind: 'SPOTLIGHT', intensity: 0.5 },
    })
    expect(parseDecorMessage(asEffect)?.effect).toBeNull()

    const asBackground = JSON.stringify({
      v: 1,
      sprites: [],
      background: { itemId: 9, kind: 'SOFT_GLOW', intensity: 0.5 },
    })
    expect(parseDecorMessage(asBackground)?.background).toBeNull()
  })

  it('배경 세기도 0~1로 다듬는다', () => {
    const over = state([], null, null, { itemId: 12, kind: 'SPOTLIGHT' as const, intensity: 9 })
    expect(parseDecorMessage(encodeDecorMessage(over))?.background?.intensity).toBe(1)
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

describe('얼굴 앵커 메시지', () => {
  const anchor: FaceAnchor = { x: 0.51234567, y: 0.48765432, scale: 0.4123456, rotation: 0.1234567 }

  it('왕복해도 눈에 보이는 차이가 없다 — 자릿수는 초당 30번의 대역폭이다', () => {
    const got = parseFaceMessage(encodeFaceMessage(anchor))!

    // 1024px 폭에서 1e-4 는 0.1px 미만이다
    expect(got.x).toBeCloseTo(anchor.x, 4)
    expect(got.y).toBeCloseTo(anchor.y, 4)
    expect(got.scale).toBeCloseTo(anchor.scale, 4)
    expect(got.rotation).toBeCloseTo(anchor.rotation, 4)
  })

  it('벗었다는 알림과 망가진 메시지가 같은 null — 둘 다 결론이 "그리지 않는다"다', () => {
    expect(parseFaceMessage(encodeFaceMessage(null))).toBeNull()
    expect(parseFaceMessage('not json')).toBeNull()
    expect(parseFaceMessage(JSON.stringify({ v: 99, face: { x: 0.5, y: 0.5, s: 0.4, r: 0 } }))).toBeNull()
    expect(parseFaceMessage(JSON.stringify({ v: 1, face: { x: 'a', y: 0.5, s: 0.4, r: 0 } }))).toBeNull()
  })

  it('남이 보낸 값을 그대로 믿지 않는다 — 화면을 덮는 크기나 뒤집힌 각도는 버린다', () => {
    const at = (face: Record<string, number>) => parseFaceMessage(JSON.stringify({ v: 1, face }))

    expect(at({ x: 0.5, y: 0.5, s: 99, r: 0 })).toBeNull() // 화면을 통째로 덮는다
    expect(at({ x: 0.5, y: 0.5, s: 0, r: 0 })).toBeNull() // 크기가 없다
    expect(at({ x: 0.5, y: 0.5, s: 0.4, r: 99 })).toBeNull() // 한 바퀴 넘게 돈 각도
    // 범위를 벗어난 좌표는 버리지 않고 자른다(스티커와 같은 규칙)
    expect(at({ x: 9, y: -3, s: 0.4, r: 0 })).toMatchObject({ x: 1, y: 0 })
  })
})

/** 참가자 한 명분 가짜 전송 — 보낸 목록을 그대로 들고 있고, 수신은 손으로 흘려 넣는다. */
function fakeTransport() {
  const sent: { payload: string; to?: string[]; topic?: string; reliable?: boolean }[] = []
  let data: ((payload: string, from: string, topic?: string) => void) | undefined
  let join: ((identity: string) => void) | undefined
  let leave: ((identity: string) => void) | undefined
  const transport: DecorTransport = {
    sendData: (payload, to, topic, reliable) => void sent.push({ payload, to, topic, reliable }),
    onData: (cb) => ((data = cb), () => (data = undefined)),
    onParticipantJoin: (cb) => ((join = cb), () => (join = undefined)),
    onParticipantLeave: (cb) => ((leave = cb), () => (leave = undefined)),
  }
  return {
    transport,
    sent,
    /** 상태 토픽으로 보낸 것만 — 앵커까지 섞이면 개수 검사가 흔들린다. */
    stateSent: () => sent.filter((s) => s.topic === DECOR_TOPIC),
    faceSent: () => sent.filter((s) => s.topic === DECOR_FACE_TOPIC),
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

/**
 * 남의 가면 — 그림(상태 메시지)과 자리(앵커 토픽)가 <b>둘 다</b> 있어야 그린다.
 * 그림만 있으면 어디에 얹을지 모르고, 자리만 있으면 무엇을 얹을지 모른다.
 */
describe('useDecorSync 가면', () => {
  const anchor: FaceAnchor = { x: 0.5, y: 0.5, scale: 0.4, rotation: 0 }
  const faceMsg = (a: FaceAnchor | null = anchor) => encodeFaceMessage(a)

  it('그림과 앵커가 다 와야 가면을 얹는다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    // 그림만 — 자리를 모르니 그리지 않는다
    t.receive(encodeDecorMessage(state([sprite()], null, mask())), '7')
    expect(sync.spritesOf('7').map((s) => s.itemId)).toEqual([1])
    expect(sync.faceOf('7')).toBeNull()

    t.receive(faceMsg(), '7', DECOR_FACE_TOPIC)
    expect(sync.spritesOf('7').map((s) => s.itemId)).toEqual([1, 5])
    expect(sync.faceOf('7')).toEqual(anchor)
    scope.stop()
  })

  it('앵커만 오면 그릴 게 없다 — 무엇을 얹을지 모른다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    t.receive(faceMsg(), '7', DECOR_FACE_TOPIC)
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('벗었다는 알림이 오면 유예를 기다리지 않고 지운다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    t.receive(encodeDecorMessage(state([], null, mask())), '7')
    t.receive(faceMsg(), '7', DECOR_FACE_TOPIC)
    expect(sync.faceOf('7')).not.toBeNull()

    t.receive(faceMsg(null), '7', DECOR_FACE_TOPIC)
    expect(sync.faceOf('7')).toBeNull()
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('앵커가 끊기면 걷어낸다 — 상대 얼굴이 움직이는데 가면이 허공에 남으면 안 된다', () => {
    vi.useFakeTimers()
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    t.receive(encodeDecorMessage(state([], null, mask())), '7')
    t.receive(faceMsg(), '7', DECOR_FACE_TOPIC)
    expect(sync.faceOf('7')).not.toBeNull()

    // 탭이 백그라운드로 밀리거나 네트워크가 끊기면 「벗었다」조차 오지 않는다
    vi.advanceTimersByTime(FACE_FRAME_STALE_MS + 300)
    expect(sync.faceOf('7')).toBeNull()
    expect(sync.spritesOf('7')).toEqual([])

    scope.stop()
    vi.useRealTimers()
  })

  it('나간 사람의 앵커도 함께 지운다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => state([])))!

    t.receive(faceMsg(), '7', DECOR_FACE_TOPIC)
    t.leaves('7')
    expect(sync.faceOf('7')).toBeNull()
    scope.stop()
  })

  it('내 앵커는 유실 허용으로, 상태와 다른 토픽으로 보낸다', async () => {
    const t = fakeTransport()
    const mine = ref<FaceAnchor | null>(null)
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => state([]), () => mine.value))

    mine.value = anchor
    await vi.waitFor(() => expect(t.faceSent()).toHaveLength(1))
    expect(t.faceSent()[0]).toMatchObject({ topic: DECOR_FACE_TOPIC, reliable: false })
    expect(t.stateSent()).toHaveLength(0) // 상태 메시지를 건드리지 않는다
    scope.stop()
  })

  it('벗은 순간은 상한을 무시하고 한 번 보낸다 — 상대가 유예를 기다리지 않게', async () => {
    const t = fakeTransport()
    const mine = ref<FaceAnchor | null>(anchor)
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => state([]), () => mine.value))

    mine.value = { ...anchor, x: 0.6 }
    await vi.waitFor(() => expect(t.faceSent()).toHaveLength(1))

    // 곧바로 벗는다 — 상한(33ms) 안이지만 이건 나가야 한다
    mine.value = null
    await vi.waitFor(() => expect(t.faceSent()).toHaveLength(2))
    expect(parseFaceMessage(t.faceSent()[1]!.payload)).toBeNull()

    // 계속 없는 상태로 두면 더 보내지 않는다
    mine.value = null
    await Promise.resolve()
    expect(t.faceSent()).toHaveLength(2)
    scope.stop()
  })
})
