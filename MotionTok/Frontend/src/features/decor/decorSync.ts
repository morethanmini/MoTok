/**
 * 참가자끼리 꾸미기 배치를 주고받는 메시지 규약(LiveKit 데이터 채널).
 * 남의 브라우저가 보낸 값이라 개수·좌표·주소를 모두 다듬어서 받는다.
 */
import { clamp01, clampScale, type StickerSprite } from './sticker'
import { clampIntensity, type CameraEffect, type EffectKind } from './cameraEffect'

export const DECOR_TOPIC = 'decor'

const PROTOCOL_VERSION = 1

/** 스프라이트 수 상한 — 서버 장착 한도 합계(스티커 5 + 가면·효과·배경 각 1). */
export const MAX_SPRITES = 8

/** 백엔드 item.image_url 컬럼과 같은 값. */
const MAX_URL_LENGTH = 512

/** http·https 절대 주소나 같은 오리진 절대 경로만 통과시킨다. */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return null
  if (value.startsWith('//')) return null // 프로토콜 상대 주소 — 스킴 검사를 우회한다
  if (value.startsWith('/')) return value
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function sanitize(raw: unknown): StickerSprite | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const itemId = Number(s.itemId)
  if (!Number.isFinite(itemId)) return null
  const imageUrl = safeImageUrl(s.imageUrl)
  if (!imageUrl) return null
  const x = Number(s.x)
  const y = Number(s.y)
  const scale = Number(s.scale)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null
  return {
    itemId,
    // 지금 그릴 수 있는 앵커는 화면 고정뿐이다.
    anchor: 'FIXED',
    x: clamp01(x),
    y: clamp01(y),
    scale: clampScale(scale),
    imageUrl,
  }
}

/** 참가자가 알려 오는 꾸미기 상태 — 그림으로 얹는 스티커와 프레임 전체 효과. */
export interface DecorState {
  sprites: StickerSprite[]
  /** 걸려 있는 프레임 효과(뽀샤시). 없으면 null — "껐다"도 알려야 한다. */
  effect: CameraEffect | null
}

/**
 * 장착이 없으면 빈 배열·null로 보낸다 — "다 뗐다"도 알려야 한다.
 *
 * <p>효과가 늘었는데도 프로토콜 버전을 올리지 않는다. 올리면 옛 클라이언트가 메시지 전체를
 * 버려(`v` 불일치) 스티커까지 안 보이게 된다. `effect`는 없으면 없는 대로 읽히는 추가 필드라
 * 양쪽 모두 서로의 메시지를 계속 이해한다.</p>
 */
export function encodeDecorMessage(state: DecorState): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    sprites: state.sprites.slice(0, MAX_SPRITES).map((s) => ({
      itemId: s.itemId,
      x: s.x,
      y: s.y,
      scale: s.scale,
      imageUrl: s.imageUrl,
    })),
    effect: state.effect
      ? {
          itemId: state.effect.itemId,
          // 종류도 함께 보낸다 — 받는 쪽은 그 아이템을 보유하지 않아 그림에서 알아낼 수가 없다.
          kind: state.effect.kind,
          intensity: state.effect.intensity,
        }
      : null,
  })
}

/** 우리가 그릴 줄 아는 종류인지. 남의 브라우저가 보낸 문자열이라 그대로 믿지 않는다. */
const KNOWN_KINDS: EffectKind[] = ['SOFT_GLOW', 'GRAYSCALE']

/** 남이 보낸 효과 — 종류와 세기를 다듬는다. 모르는 종류면 통째로 버린다(엉뚱하게 그리지 않는다). */
function sanitizeEffect(raw: unknown): CameraEffect | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const itemId = Number(e.itemId)
  const intensity = Number(e.intensity)
  if (!Number.isFinite(itemId) || !Number.isFinite(intensity)) return null
  const kind = KNOWN_KINDS.find((k) => k === e.kind)
  if (!kind) return null
  return { itemId, kind, intensity: clampIntensity(intensity) }
}

/** 받은 메시지를 그릴 수 있는 상태로 바꾼다. 규약이 안 맞으면 null(무시). */
export function parseDecorMessage(raw: string): DecorState | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const { v, sprites, effect } = body as { v?: unknown; sprites?: unknown; effect?: unknown }
  if (v !== PROTOCOL_VERSION || !Array.isArray(sprites)) return null
  return {
    sprites: sprites.slice(0, MAX_SPRITES).flatMap((s) => {
      const sprite = sanitize(s)
      return sprite ? [sprite] : []
    }),
    // 효과를 모르는 옛 클라이언트의 메시지에는 이 필드가 없다 — 없으면 효과 없음이다.
    effect: sanitizeEffect(effect),
  }
}
