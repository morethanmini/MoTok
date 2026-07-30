/**
 * 방 안 참가자들의 꾸미기 배치를 서로 맞춘다(LiveKit 데이터 채널).
 * 남의 꾸미기를 묻는 API가 없어서 각자 자기 배치를 알린다 — 내가 들어갈 때 방 전체에 한 번,
 * 남이 들어올 때 그 사람에게 한 번, 내 배치가 바뀔 때마다 다시.
 *
 *   const sync = useDecorSync(lk, () => decor.sprites.value)
 *   await lk.connect(...); sync.broadcast()
 *   sync.spritesOf(identity)   // 그 참가자 타일에 얹을 스프라이트
 */
import { onScopeDispose, ref, watch } from 'vue'
import { DECOR_TOPIC, encodeDecorMessage, parseDecorMessage } from '@/features/decor/decorSync'
import type { StickerSprite } from '@/features/decor/sticker'
import { preloadSprites } from '@/features/decor/sticker'

/** useLiveKitRoom에서 이 컴포저블이 쓰는 부분만 뽑은 형태. */
export interface DecorTransport {
  sendData: (payload: string, identities?: string[], topic?: string) => void | Promise<void>
  onData: (cb: (payload: string, from: string, topic?: string) => void) => () => void
  onParticipantJoin: (cb: (identity: string) => void) => () => void
  onParticipantLeave: (cb: (identity: string) => void) => () => void
}

export function useDecorSync(transport: DecorTransport, mySprites: () => StickerSprite[]) {
  /** identity → 그 참가자가 알려 준 배치 */
  const remote = ref<Record<string, StickerSprite[]>>({})
  /** 콕 집어 보낸 상대 — 아래 답장이 무한 왕복하지 않게 한다. */
  const told = new Set<string>()

  /** to를 주면 그 사람에게만 보낸다. */
  function broadcast(to?: string[]): void {
    to?.forEach((identity) => told.add(identity))
    void transport.sendData(encodeDecorMessage(mySprites()), to, DECOR_TOPIC)
  }

  const stopData = transport.onData((payload, from, topic) => {
    if (topic !== DECOR_TOPIC) return
    const sprites = parseDecorMessage(payload)
    if (!sprites) return
    preloadSprites(sprites)
    remote.value = { ...remote.value, [from]: sprites }
    // 아직 이 사람에게 직접 알린 적이 없으면 답장한다 — 입장 때 보낸 알림이 유실돼도 여기서 메꿔진다.
    if (!told.has(from)) broadcast([from])
  })

  const stopJoin = transport.onParticipantJoin((identity) => broadcast([identity]))

  const stopLeave = transport.onParticipantLeave((identity) => {
    told.delete(identity)
    if (!(identity in remote.value)) return
    const next = { ...remote.value }
    delete next[identity]
    remote.value = next
  })

  // sprites는 바뀔 때마다 새 배열이라 얕은 감시로 충분하다.
  const stopWatch = watch(mySprites, () => broadcast())

  onScopeDispose(() => {
    stopData()
    stopJoin()
    stopLeave()
    stopWatch()
  })

  /** 그 참가자 타일에 얹을 스프라이트 — 아직 못 받았으면 빈 배열. */
  function spritesOf(identity: string): StickerSprite[] {
    return remote.value[identity] ?? []
  }

  return { remote, spritesOf, broadcast }
}
