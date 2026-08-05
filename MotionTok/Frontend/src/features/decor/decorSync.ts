/**
 * 참가자끼리 꾸미기 배치를 주고받는 메시지 규약(LiveKit 데이터 채널).
 * 남의 브라우저가 보낸 값이라 개수·좌표·주소를 모두 다듬어서 받는다.
 */
import { clamp01, clampScale, type StickerSprite } from './sticker'
import {
  clampIntensity,
  type BackgroundKind,
  type CameraBackground,
  type CameraEffect,
  type EffectKind,
} from './cameraEffect'
import type { FaceAnchor } from './faceAnchor'

export const DECOR_TOPIC = 'decor'

/**
 * 얼굴 앵커 전용 토픽 — 상태 메시지와 <b>나눠서</b> 보낸다.
 *
 * 스티커·효과는 "바뀔 때 한 번"이고 유실되면 안 되는 상태다. 얼굴 앵커는 <b>매 프레임</b>
 * 바뀌고 유실돼도 다음 프레임이 덮는다. 같은 메시지에 실으면 초당 30번을 신뢰 전송으로
 * 보내게 되어(재전송·순서 보장) 채널을 낭비하고, 스티커 갱신까지 그 뒤에 줄을 선다.
 */
export const DECOR_FACE_TOPIC = 'decor-face'

/** 앵커를 보낼 최소 간격 — 30fps 상한. 가면이 얼굴에 붙어 있어야 해서 더 낮추지 않았다. */
export const FACE_SEND_INTERVAL_MS = 33

/**
 * 마지막 앵커가 이보다 오래됐으면 그리지 않는다.
 *
 * 상대가 가면을 벗거나 게임에 들어가면 상태 메시지가 곧 `face: null`로 정정하지만, 탭이
 * 백그라운드로 밀려 rAF가 멈추거나 네트워크가 끊기면 <b>아무 소식도 오지 않는다</b>.
 * 그때 마지막 앵커가 남아 있으면 상대 얼굴이 움직여도 가면이 허공에 붙어 있다.
 */
export const FACE_FRAME_STALE_MS = 500

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

/** 참가자가 알려 오는 꾸미기 상태 — 그림으로 얹는 스티커, 프레임 효과, 배경. */
export interface DecorState {
  sprites: StickerSprite[]
  /** 걸려 있는 프레임 효과(뽀샤시). 없으면 null — "껐다"도 알려야 한다. */
  effect: CameraEffect | null
  /**
   * 걸려 있는 배경(어두운 배경). 없으면 null.
   * 효과와 <b>따로</b> 싣는다 — 분류 한도가 각각 1이라 둘이 함께 걸릴 수 있다.
   */
  background: CameraBackground | null
  /**
   * 쓰고 있는 가면. <b>어떤 그림인지만</b> 담는다 — 자리·크기는 앵커 토픽으로 따로 온다.
   * 없으면 null(안 썼거나 벗었다).
   */
  faceSprite: StickerSprite | null
}

/**
 * 장착이 없으면 빈 배열·null로 보낸다 — "다 뗐다"도 알려야 한다.
 *
 * <p>효과가 늘었는데도 프로토콜 버전을 올리지 않는다. 올리면 옛 클라이언트가 메시지 전체를
 * 버려(`v` 불일치) 스티커까지 안 보이게 된다. `effect`는 없으면 없는 대로 읽히는 추가 필드라
 * 양쪽 모두 서로의 메시지를 계속 이해한다.</p>
 *
 * <p><b>가면은 `sprites`에 넣지 않고 `face`로 따로 보낸다.</b> `sprites`에 넣으면 이 필드를
 * 모르는 옛 클라이언트가 가면을 화면 고정 스티커로 읽어(수신부가 앵커를 FIXED로 굳힌다)
 * 상대 영상 왼쪽 위 구석에 가면이 붙는다. 배포는 한순간에 갈리지 않으므로 그 창이 실제로
 * 생긴다. `effect`를 추가할 때와 같은 이유로 <b>모르면 무시되는 새 필드</b>로 넓힌다.</p>
 */
export function encodeDecorMessage(state: DecorState): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    sprites: state.sprites
      .filter((s) => s.anchor === 'FIXED')
      .slice(0, MAX_SPRITES)
      .map((s) => ({
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
    // 배경도 `effect`와 같은 이유로 모르면 무시되는 새 필드다(옛 클라이언트는 배경만 못 본다).
    background: state.background
      ? {
          itemId: state.background.itemId,
          kind: state.background.kind,
          intensity: state.background.intensity,
        }
      : null,
    // 그림만 — 좌표는 DECOR_FACE_TOPIC 으로 매 프레임 따로 온다.
    face: state.faceSprite
      ? { itemId: state.faceSprite.itemId, imageUrl: state.faceSprite.imageUrl }
      : null,
  })
}

/** 우리가 그릴 줄 아는 종류인지. 남의 브라우저가 보낸 문자열이라 그대로 믿지 않는다. */
const KNOWN_EFFECT_KINDS: EffectKind[] = ['SOFT_GLOW', 'GRAYSCALE']
const KNOWN_BACKGROUND_KINDS: BackgroundKind[] = ['SPOTLIGHT']

/**
 * 남이 보낸 효과·배경 — 종류와 세기를 다듬는다.
 * 모르는 종류면 통째로 버린다(엉뚱하게 그리지 않는다).
 *
 * 효과와 배경이 담는 것이 같아(itemId·kind·intensity) 한 함수로 받고, <b>어느 목록에서
 * 종류를 찾을지만</b> 다르게 준다 — 목록을 섞으면 배경 종류가 효과 자리에 들어와 그려진다.
 */
function sanitizeLayer<K extends string>(raw: unknown, known: readonly K[]) {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const itemId = Number(e.itemId)
  const intensity = Number(e.intensity)
  if (!Number.isFinite(itemId) || !Number.isFinite(intensity)) return null
  const kind = known.find((k) => k === e.kind)
  if (!kind) return null
  return { itemId, kind, intensity: clampIntensity(intensity) }
}

const sanitizeEffect = (raw: unknown): CameraEffect | null =>
  sanitizeLayer(raw, KNOWN_EFFECT_KINDS)

const sanitizeBackground = (raw: unknown): CameraBackground | null =>
  sanitizeLayer(raw, KNOWN_BACKGROUND_KINDS)

/**
 * 남이 쓴 가면 — 그림 주소만 받는다. 자리·크기는 앵커가 정하므로 0으로 둔다.
 * `sanitize`를 쓰지 않는 이유: 그쪽은 좌표가 유한한 수여야 통과시키는데 여기엔 좌표가 없다.
 */
function sanitizeFace(raw: unknown): StickerSprite | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  const itemId = Number(f.itemId)
  if (!Number.isFinite(itemId)) return null
  const imageUrl = safeImageUrl(f.imageUrl)
  if (!imageUrl) return null
  return { itemId, anchor: 'FACE', x: 0, y: 0, scale: 0, imageUrl }
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
  const { v, sprites, effect, background, face } = body as {
    v?: unknown
    sprites?: unknown
    effect?: unknown
    background?: unknown
    face?: unknown
  }
  if (v !== PROTOCOL_VERSION || !Array.isArray(sprites)) return null
  return {
    sprites: sprites.slice(0, MAX_SPRITES).flatMap((s) => {
      const sprite = sanitize(s)
      return sprite ? [sprite] : []
    }),
    // 효과·배경·가면을 모르는 옛 클라이언트의 메시지에는 이 필드가 없다 — 없으면 없는 것이다.
    effect: sanitizeEffect(effect),
    background: sanitizeBackground(background),
    faceSprite: sanitizeFace(face),
  }
}

/**
 * 얼굴 앵커 한 프레임. 소수점을 넉넉히 자른다 — 1024px 폭에서 1e-4 는 0.1px 미만이라
 * 눈에 보이지 않고, 초당 30번 보내는 값이라 자릿수가 그대로 대역폭이다.
 */
export function encodeFaceMessage(anchor: FaceAnchor | null): string {
  if (!anchor) return JSON.stringify({ v: PROTOCOL_VERSION, face: null })
  const round = (n: number) => Math.round(n * 1e4) / 1e4
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    face: {
      x: round(anchor.x),
      y: round(anchor.y),
      s: round(anchor.scale),
      r: round(anchor.rotation),
    },
  })
}

/**
 * 받은 앵커. 「가면을 벗었다」(face: null)와 「망가진 메시지」를 같은 null 로 돌려준다 —
 * 둘 다 결론이 "그리지 않는다"라서 부르는 쪽이 구분할 이유가 없다.
 */
export function parseFaceMessage(raw: string): FaceAnchor | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const { v, face } = body as { v?: unknown; face?: unknown }
  if (v !== PROTOCOL_VERSION || !face || typeof face !== 'object') return null
  const f = face as Record<string, unknown>
  const x = Number(f.x)
  const y = Number(f.y)
  const scale = Number(f.s)
  const rotation = Number(f.r)
  if (![x, y, scale, rotation].every(Number.isFinite)) return null
  // 남의 브라우저가 보낸 값이라 그대로 믿지 않는다 — 화면을 덮는 크기나 뒤집힌 각도가 오면 안 된다.
  if (scale <= 0 || scale > 4) return null
  if (Math.abs(rotation) > Math.PI) return null
  return { x: clamp01(x), y: clamp01(y), scale, rotation }
}
