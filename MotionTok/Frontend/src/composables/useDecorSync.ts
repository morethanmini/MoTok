/**
 * 방 안 참가자들의 꾸미기 배치를 서로 맞춘다(LiveKit 데이터 채널).
 * 남의 꾸미기를 묻는 API가 없어서 각자 자기 배치를 알린다 — 내가 들어갈 때 방 전체에 한 번,
 * 남이 들어올 때 그 사람에게 한 번, 내 배치가 바뀔 때마다 다시.
 *
 *   const sync = useDecorSync(lk, () => ({ sprites: decor.sprites.value, effect: decor.cameraEffect.value }))
 *   await lk.connect(...); sync.broadcast()
 *   sync.spritesOf(identity)   // 그 참가자 타일에 얹을 스프라이트
 *   sync.effectOf(identity)    // 그 참가자 영상에 걸 프레임 효과
 */
import { onScopeDispose, ref, watch } from 'vue'
import {
  DECOR_TOPIC,
  encodeDecorMessage,
  parseDecorMessage,
  type DecorState,
} from '@/features/decor/decorSync'
import { preloadSprites, type StickerSprite } from '@/features/decor/sticker'
import type { CameraEffect } from '@/features/decor/cameraEffect'

/** useLiveKitRoom에서 이 컴포저블이 쓰는 부분만 뽑은 형태. */
export interface DecorTransport {
  sendData: (payload: string, identities?: string[], topic?: string) => void | Promise<void>
  onData: (cb: (payload: string, from: string, topic?: string) => void) => () => void
  onParticipantJoin: (cb: (identity: string) => void) => () => void
  onParticipantLeave: (cb: (identity: string) => void) => () => void
}

export function useDecorSync(transport: DecorTransport, myDecor: () => DecorState) {
  /** identity → 그 참가자가 알려 준 꾸미기 상태 */
  const remote = ref<Record<string, DecorState>>({})
  /** 콕 집어 보낸 상대 — 아래 답장이 무한 왕복하지 않게 한다. */
  const told = new Set<string>()

  /** to를 주면 그 사람에게만 보낸다. */
  function broadcast(to?: string[]): void {
    to?.forEach((identity) => told.add(identity))
    void transport.sendData(encodeDecorMessage(myDecor()), to, DECOR_TOPIC)
  }

  const stopData = transport.onData((payload, from, topic) => {
    if (topic !== DECOR_TOPIC) return
    const state = parseDecorMessage(payload)
    if (!state) return
    preloadSprites(state.sprites)
    remote.value = { ...remote.value, [from]: state }
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

  // sprites는 바뀔 때마다 새 배열이고 effect도 새 객체라 얕은 감시로 충분하다.
  // (세기 슬라이더를 끌면 effect 객체가 매번 새로 만들어져 그때마다 알린다)
  const stopWatch = watch(myDecor, () => broadcast(), { deep: false })

  onScopeDispose(() => {
    stopData()
    stopJoin()
    stopLeave()
    stopWatch()
  })

  /** 그 참가자 타일에 얹을 스프라이트 — 아직 못 받았으면 빈 배열. */
  function spritesOf(identity: string): StickerSprite[] {
    return remote.value[identity]?.sprites ?? []
  }

  /** 그 참가자 영상에 걸 프레임 효과 — 없거나 아직 못 받았으면 null. */
  function effectOf(identity: string): CameraEffect | null {
    return remote.value[identity]?.effect ?? null
  }

  return { remote, spritesOf, effectOf, broadcast }
}
