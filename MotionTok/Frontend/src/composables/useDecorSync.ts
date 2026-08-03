/**
 * 방 안 참가자들의 꾸미기 배치를 서로 맞춘다(LiveKit 데이터 채널).
 * 남의 꾸미기를 묻는 API가 없어서 각자 자기 배치를 알린다 — 내가 들어갈 때 방 전체에 한 번,
 * 남이 들어올 때 그 사람에게 한 번, 내 배치가 바뀔 때마다 다시.
 *
 *   const sync = useDecorSync(lk, () => ({ ... }), () => face.anchor.value)
 *   await lk.connect(...); sync.broadcast()
 *   sync.spritesOf(identity)   // 그 참가자 타일에 얹을 스프라이트(가면 포함)
 *   sync.effectOf(identity)    // 그 참가자 영상에 걸 프레임 효과
 *   sync.faceOf(identity)      // 그 참가자 얼굴 앵커(가면을 얹을 자리)
 *
 * <b>두 종류의 메시지를 나눠 보낸다.</b> 상태(스티커·효과·어떤 가면)는 바뀔 때 한 번, 신뢰
 * 전송. 얼굴 앵커는 매 프레임, 유실 허용. 섞으면 초당 30번을 신뢰 전송으로 보내게 되어
 * 채널을 낭비하고 스티커 갱신이 그 뒤에 줄을 선다(decorSync.ts 의 토픽 주석 참고).
 */
import { onScopeDispose, ref, watch } from 'vue'
import {
  DECOR_FACE_TOPIC,
  DECOR_TOPIC,
  FACE_FRAME_STALE_MS,
  FACE_SEND_INTERVAL_MS,
  encodeDecorMessage,
  encodeFaceMessage,
  parseDecorMessage,
  parseFaceMessage,
  type DecorState,
} from '@/features/decor/decorSync'
import { preloadSprites, type StickerSprite } from '@/features/decor/sticker'
import type { CameraEffect } from '@/features/decor/cameraEffect'
import type { FaceAnchor } from '@/features/decor/faceAnchor'

/** useLiveKitRoom에서 이 컴포저블이 쓰는 부분만 뽑은 형태. */
export interface DecorTransport {
  sendData: (
    payload: string,
    identities?: string[],
    topic?: string,
    reliable?: boolean,
  ) => void | Promise<void>
  onData: (cb: (payload: string, from: string, topic?: string) => void) => () => void
  onParticipantJoin: (cb: (identity: string) => void) => () => void
  onParticipantLeave: (cb: (identity: string) => void) => () => void
}

/** 낡은 앵커를 걷어내는 주기 — 유예(500ms)보다 촘촘해야 지연이 유예에 가깝게 유지된다. */
const PRUNE_INTERVAL_MS = 200

export function useDecorSync(
  transport: DecorTransport,
  myDecor: () => DecorState,
  myFaceAnchor: () => FaceAnchor | null = () => null,
) {
  /** identity → 그 참가자가 알려 준 꾸미기 상태 */
  const remote = ref<Record<string, DecorState>>({})
  /** identity → 마지막 얼굴 앵커와 받은 시각. 낡으면 걷어낸다. */
  const faces = ref<Record<string, { anchor: FaceAnchor; at: number }>>({})
  /** 콕 집어 보낸 상대 — 아래 답장이 무한 왕복하지 않게 한다. */
  const told = new Set<string>()

  /** to를 주면 그 사람에게만 보낸다. */
  function broadcast(to?: string[]): void {
    to?.forEach((identity) => told.add(identity))
    void transport.sendData(encodeDecorMessage(myDecor()), to, DECOR_TOPIC)
  }

  const stopData = transport.onData((payload, from, topic) => {
    if (topic === DECOR_FACE_TOPIC) {
      const anchor = parseFaceMessage(payload)
      if (anchor) {
        faces.value = { ...faces.value, [from]: { anchor, at: performance.now() } }
      } else if (from in faces.value) {
        // 「벗었다」는 명시적 알림 — 유예를 기다리지 않고 즉시 지운다.
        const next = { ...faces.value }
        delete next[from]
        faces.value = next
      }
      return
    }
    if (topic !== DECOR_TOPIC) return
    const state = parseDecorMessage(payload)
    if (!state) return
    preloadSprites(state.sprites)
    if (state.faceSprite) preloadSprites([state.faceSprite])
    remote.value = { ...remote.value, [from]: state }
    // 아직 이 사람에게 직접 알린 적이 없으면 답장한다 — 입장 때 보낸 알림이 유실돼도 여기서 메꿔진다.
    if (!told.has(from)) broadcast([from])
  })

  const stopJoin = transport.onParticipantJoin((identity) => broadcast([identity]))

  const stopLeave = transport.onParticipantLeave((identity) => {
    told.delete(identity)
    if (identity in faces.value) {
      const nextFaces = { ...faces.value }
      delete nextFaces[identity]
      faces.value = nextFaces
    }
    if (!(identity in remote.value)) return
    const next = { ...remote.value }
    delete next[identity]
    remote.value = next
  })

  // sprites는 바뀔 때마다 새 배열이고 effect도 새 객체라 얕은 감시로 충분하다.
  // (세기 슬라이더를 끌면 effect 객체가 매번 새로 만들어져 그때마다 알린다)
  const stopWatch = watch(myDecor, () => broadcast(), { deep: false })

  /*
   * 얼굴 앵커 송신 — 프레임마다 값이 바뀌므로 상한을 둔다.
   * 벗은 순간(null 전이)은 상한과 무관하게 한 번 보낸다: 상대가 유예(500ms)를 기다리지 않고
   * 곧바로 지우게 하려는 것이고, 그 한 번을 아끼면 벗었는데 가면이 남아 있는 창이 생긴다.
   */
  let lastSentAt = 0
  let lastWasNull = true
  const stopFaceWatch = watch(myFaceAnchor, (anchor) => {
    const now = performance.now()
    const becameNull = !anchor && !lastWasNull
    if (!anchor && lastWasNull) return // 계속 없는 상태 — 보낼 것이 없다
    if (!becameNull && now - lastSentAt < FACE_SEND_INTERVAL_MS) return
    lastSentAt = now
    lastWasNull = !anchor
    void transport.sendData(encodeFaceMessage(anchor), undefined, DECOR_FACE_TOPIC, false)
  })

  const pruneTimer = setInterval(() => {
    const cutoff = performance.now() - FACE_FRAME_STALE_MS
    const stale = Object.keys(faces.value).filter((id) => faces.value[id]!.at < cutoff)
    if (!stale.length) return
    const next = { ...faces.value }
    stale.forEach((id) => delete next[id])
    faces.value = next
  }, PRUNE_INTERVAL_MS)

  onScopeDispose(() => {
    stopData()
    stopJoin()
    stopLeave()
    stopWatch()
    stopFaceWatch()
    clearInterval(pruneTimer)
  })

  /**
   * 그 참가자 타일에 얹을 스프라이트 — 아직 못 받았으면 빈 배열.
   *
   * 가면은 <b>앵커가 살아 있을 때만</b> 끼워 넣는다. 그림만 있고 자리를 모르면 그릴 수 없고,
   * StickerOverlay 도 face 가 없는 FACE 스프라이트는 건너뛰므로 여기서 미리 걸러 두면
   * "왜 안 보이나"를 한 곳에서 판단하게 된다.
   */
  function spritesOf(identity: string): StickerSprite[] {
    const state = remote.value[identity]
    if (!state) return []
    const mask = state.faceSprite && faces.value[identity] ? [state.faceSprite] : []
    return mask.length ? [...state.sprites, ...mask] : state.sprites
  }

  /** 그 참가자 영상에 걸 프레임 효과 — 없거나 아직 못 받았으면 null. */
  function effectOf(identity: string): CameraEffect | null {
    return remote.value[identity]?.effect ?? null
  }

  /** 그 참가자 얼굴 앵커 — 가면을 얹을 자리. 낡거나 없으면 null. */
  function faceOf(identity: string): FaceAnchor | null {
    return faces.value[identity]?.anchor ?? null
  }

  return { remote, spritesOf, effectOf, faceOf, broadcast }
}
