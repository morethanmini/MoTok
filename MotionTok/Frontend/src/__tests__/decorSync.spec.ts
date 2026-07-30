import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import {
  DECOR_TOPIC,
  MAX_SPRITES,
  encodeDecorMessage,
  parseDecorMessage,
} from '@/features/decor/decorSync'
import { useDecorSync, type DecorTransport } from '@/composables/useDecorSync'
import type { StickerSprite } from '@/features/decor/sticker'

const sprite = (over: Partial<StickerSprite> = {}): StickerSprite => ({
  itemId: 1,
  anchor: 'FIXED',
  x: 0.5,
  y: 0.5,
  scale: 0.2,
  imageUrl: '/assets/item/sticker/heart_1.png',
  ...over,
})

describe('decorSync 메시지', () => {
  it('보낸 배치를 그대로 되돌려 받는다', () => {
    const sprites = [sprite(), sprite({ itemId: 2, imageUrl: 'https://cdn.example.com/a.png' })]
    expect(parseDecorMessage(encodeDecorMessage(sprites))).toEqual(sprites)
  })

  it('범위를 벗어난 좌표·크기는 다듬는다', () => {
    const [got] = parseDecorMessage(encodeDecorMessage([sprite({ x: 9, y: -3, scale: 50 })])) ?? []
    expect(got).toMatchObject({ x: 1, y: 0, scale: 1 })
  })

  it('그릴 수 없는 이미지 주소는 버린다', () => {
    for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.example/a.png', '']) {
      expect(parseDecorMessage(encodeDecorMessage([sprite({ imageUrl })]))).toEqual([])
    }
  })

  it('장착 한도를 넘는 개수는 잘라낸다', () => {
    const many = Array.from({ length: MAX_SPRITES + 5 }, (_, i) => sprite({ itemId: i }))
    expect(parseDecorMessage(encodeDecorMessage(many))).toHaveLength(MAX_SPRITES)
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
    const sync = scope.run(() => useDecorSync(t.transport, () => []))!

    expect(sync.spritesOf('7')).toEqual([])
    t.receive(encodeDecorMessage([sprite()]), '7')
    expect(sync.spritesOf('7')).toEqual([sprite()])

    t.leaves('7')
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('다른 토픽 메시지는 무시한다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => []))!

    t.receive(encodeDecorMessage([sprite()]), '7', 'chat')
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('새로 들어온 사람에게는 그 사람에게만 보낸다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => [sprite()]))

    t.joins('9')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]?.to).toEqual(['9'])
    expect(parseDecorMessage(t.sent[0]!.payload)).toEqual([sprite()])
    scope.stop()
  })

  it('아직 알린 적 없는 사람에게서 받으면 답장하고, 그 뒤로는 왕복하지 않는다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => [sprite()]))

    t.receive(encodeDecorMessage([]), '7')
    expect(t.sent.map((s) => s.to)).toEqual([['7']])

    t.receive(encodeDecorMessage([]), '7')
    expect(t.sent).toHaveLength(1)
    scope.stop()
  })

  it('이미 알린 사람에게는 답장하지 않는다', () => {
    const t = fakeTransport()
    const scope = effectScope()
    const sync = scope.run(() => useDecorSync(t.transport, () => [sprite()]))!

    t.joins('7')
    t.receive(encodeDecorMessage([]), '7')
    expect(t.sent).toHaveLength(1)
    expect(sync.spritesOf('7')).toEqual([])
    scope.stop()
  })

  it('내 배치가 바뀌면 방 전체에 다시 보낸다', async () => {
    const t = fakeTransport()
    const mine = ref<StickerSprite[]>([])
    const scope = effectScope()
    scope.run(() => useDecorSync(t.transport, () => mine.value))

    mine.value = [sprite()]
    await vi.waitFor(() => expect(t.sent).toHaveLength(1))
    expect(t.sent[0]?.to).toBeUndefined()
    scope.stop()
  })
})
