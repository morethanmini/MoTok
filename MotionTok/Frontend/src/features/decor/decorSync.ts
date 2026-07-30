/**
 * 참가자끼리 꾸미기 배치를 주고받는 메시지 규약(LiveKit 데이터 채널).
 * 남의 브라우저가 보낸 값이라 개수·좌표·주소를 모두 다듬어서 받는다.
 */
import { clamp01, clampScale, type StickerSprite } from './sticker'

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

/** 장착이 없으면 빈 배열로 보낸다 — "다 뗐다"도 알려야 한다. */
export function encodeDecorMessage(sprites: StickerSprite[]): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    sprites: sprites.slice(0, MAX_SPRITES).map((s) => ({
      itemId: s.itemId,
      x: s.x,
      y: s.y,
      scale: s.scale,
      imageUrl: s.imageUrl,
    })),
  })
}

/** 받은 메시지를 그릴 수 있는 스프라이트로 바꾼다. 규약이 안 맞으면 null(무시). */
export function parseDecorMessage(raw: string): StickerSprite[] | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const { v, sprites } = body as { v?: unknown; sprites?: unknown }
  if (v !== PROTOCOL_VERSION || !Array.isArray(sprites)) return null
  return sprites.slice(0, MAX_SPRITES).flatMap((s) => {
    const sprite = sanitize(s)
    return sprite ? [sprite] : []
  })
}
