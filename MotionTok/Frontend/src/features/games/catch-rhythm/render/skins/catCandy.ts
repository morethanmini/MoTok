/**
 * 기본 스킨 「캣캔디」 — 파스텔 피치 픽셀아트 톤(catchcatchrhythm.png).
 * 1차는 전부 절차 드로잉이다 — 스프라이트·음원 에셋이 나오면 이 파일만 갈아끼우면 된다.
 *
 * 실플레이 피드백으로 정착한 규칙:
 *  - 왼손/오른손은 **색 + L/R 글자**로 구분한다 (색만으로는 헷갈린다)
 *  - 판정 시점은 **접근 링 + 판정창 진입 시 번쩍이는 신호**로 알린다
 *  - 스와이프는 기본 노트라 아무 표시도 얹지 않는다 (>> 마크 제거)
 *  - 커서는 고양이 발바닥. 손 골격은 화면을 너무 덮어서 되돌렸다
 */

import type { CatchSkin, HandView, HitFxView, NoteView } from './types'
import type { Hand, NoteHand } from '../../core/types'

/**
 * 왼손 = 파랑, 오른손 = 빨강, 아무 손 = 보라. 전부 파스텔.
 * body = 채움(연함) / edge = 테두리·글자(진함) / glow = 하이라이트.
 */
const PALETTE: Record<NoteHand, { body: string; edge: string; glow: string }> = {
  left: { body: '#9ec5fe', edge: '#1d4ed8', glow: '#e0edff' },
  right: { body: '#ffa8a8', edge: '#c92a2a', glow: '#ffe8e8' },
  any: { body: '#c3aefc', edge: '#6d28d9', glow: '#efe7ff' },
}
const PAW_ASSET: Record<Hand, string> = {
  left: '/assets/games/catch-rhythm/paw-left-sky.png',
  right: '/assets/games/catch-rhythm/paw-right-pink.png',
}
const NOTE_PAW_ASSET = '/assets/games/catch-rhythm/note-paw-pink.png'
const BACKGROUND_ASSET = '/assets/games/catch-rhythm/background-peach-weave.png'
const pawImages: Partial<Record<Hand, HTMLImageElement>> = {}
let notePawImage: HTMLImageElement | null = null
let backgroundImage: HTMLImageElement | null = null

function pawImage(side: Hand): HTMLImageElement {
  const cached = pawImages[side]
  if (cached) return cached
  const image = new Image()
  image.src = PAW_ASSET[side]
  pawImages[side] = image
  return image
}

function rhythmNoteImage(): HTMLImageElement {
  if (notePawImage) return notePawImage
  const image = new Image()
  image.src = NOTE_PAW_ASSET
  notePawImage = image
  return image
}

function rhythmBackgroundImage(): HTMLImageElement {
  if (backgroundImage) return backgroundImage
  const image = new Image()
  image.src = BACKGROUND_ASSET
  backgroundImage = image
  return image
}
/** 노트 안에 찍는 손 표시 — 색맹·저대비 환경에서도 확실하다 */
const HAND_MARK: Record<NoteHand, string> = { left: 'L', right: 'R', any: '' }

const CATCH_GOLD = '#ffb32e'
const CATCH_DEEP = '#a4530b'

const JUDGE_TEXT: Record<string, string> = { perfect: 'PERFECT!', good: 'GOOD', miss: 'MISS' }
const JUDGE_COLOR: Record<string, string> = {
  perfect: '#ff9e3d',
  good: '#047857',
  miss: '#b3402a',
}

// ── 타이밍 표시 ────────────────────────────────────────────

/**
 * 판정 링(고정) + 접근 링(수렴) + **판정창 진입 신호**.
 * readiness는 창 밖 0 → 정확한 판정 시점 1. 이 값으로 "지금!"을 번쩍인다.
 */
function timingRings(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, judgeRadius, progress, readiness } = note
  const c = PALETTE[note.hand]

  ctx.save()

  // 판정 링 — 고정 크기. 창에 들어오면 점선이 실선으로 바뀌며 또렷해진다.
  ctx.globalAlpha = 0.28 + 0.6 * readiness
  ctx.strokeStyle = readiness > 0 ? '#ffffff' : c.edge
  ctx.lineWidth = Math.max(1.5, judgeRadius * (0.09 + 0.12 * readiness))
  if (readiness <= 0) ctx.setLineDash([judgeRadius * 0.45, judgeRadius * 0.35])
  ctx.beginPath()
  ctx.arc(x, y, judgeRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // 접근 링 — 바깥에서 판정 링으로 수렴. 겹치는 순간이 판정 시점.
  if (progress < 1) {
    const outer = judgeRadius * (1 + 2.4 * (1 - progress))
    ctx.globalAlpha = 0.25 + 0.5 * progress
    ctx.strokeStyle = c.edge
    ctx.lineWidth = Math.max(1.5, judgeRadius * 0.13)
    ctx.beginPath()
    ctx.arc(x, y, outer, 0, Math.PI * 2)
    ctx.stroke()
  }

  // ★ 판정창 신호 — 창 안에서만 퍼지는 흰 링. 이게 보이면 지금 치면 된다.
  if (readiness > 0) {
    ctx.globalAlpha = readiness * 0.85
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, judgeRadius * 0.22 * readiness)
    ctx.beginPath()
    ctx.arc(x, y, judgeRadius * (1.35 - 0.3 * readiness), 0, Math.PI * 2)
    ctx.stroke()

    // 후광까지 얹어 시선을 확실히 끈다
    const halo = ctx.createRadialGradient(x, y, judgeRadius * 0.5, x, y, judgeRadius * 2)
    halo.addColorStop(0, `rgba(255,255,255,${0.32 * readiness})`)
    halo.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y, judgeRadius * 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ── 노트 본체 ──────────────────────────────────────────────

/** 손 표시(L/R) — 아무 손 노트에는 찍지 않는다 */
function handMark(ctx: CanvasRenderingContext2D, note: NoteView, color: string) {
  const mark = HAND_MARK[note.hand]
  if (!mark || note.radius < 11) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(note.radius * 0.9)}px "DNF Bit Bit", monospace`
  ctx.lineWidth = Math.max(2, note.radius * 0.16)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.fillStyle = color
  ctx.strokeText(mark, note.x, note.y)
  ctx.fillText(mark, note.x, note.y)
  ctx.restore()
}

/** 기본 노트(스와이프) — 손만 닿으면 되는 노트라 장식을 얹지 않는다 */
function bubble(ctx: CanvasRenderingContext2D, note: NoteView) {
  const { x, y, radius } = note
  const c = PALETTE[note.hand]
  const image = rhythmNoteImage()

  if (image.complete && image.naturalWidth) {
    const size = radius * 3.05
    ctx.save()
    if (note.hand === 'left') ctx.filter = 'hue-rotate(190deg) saturate(0.55) brightness(1.3)'
    else if (note.hand === 'any') ctx.filter = 'hue-rotate(255deg) saturate(0.86)'
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size)
    ctx.restore()
    return
  }

  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = c.edge
  ctx.lineWidth = Math.max(2, radius * 0.18)
  ctx.beginPath()
  ctx.arc(x, y, radius * 1.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  const grad = ctx.createRadialGradient(
    x - radius * 0.26,
    y - radius * 0.32,
    radius * 0.08,
    x,
    y,
    radius * 0.88,
  )
  grad.addColorStop(0, c.glow)
  grad.addColorStop(1, c.body)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius * 0.88, 0, Math.PI * 2)
  ctx.fill()

  ctx.lineWidth = Math.max(1.5, radius * 0.1)
  ctx.strokeStyle = c.edge
  ctx.stroke()

  // 작은 젤리 발가락 네 개와 중심 패드로 고양이 테마를 노트에도 이어 준다.
  ctx.fillStyle = 'rgba(255,255,255,0.74)'
  for (const [px, py] of [
    [-0.28, -0.25],
    [0, -0.38],
    [0.28, -0.25],
  ] as const) {
    ctx.beginPath()
    ctx.arc(x + px * radius, y + py * radius, radius * 0.11, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.ellipse(
    x,
    y + radius * 0.13,
    radius * 0.3,
    radius * 0.24,
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  ctx.restore()

  handMark(ctx, note, c.edge)
}

/**
 * 주먹 노트 — 가장 드물고 준비가 필요한 노트라 **한눈에 달라 보여야 한다**.
 * 육각 코어 + 회전 스파이크 + 조여드는 집게 + 금색 후광.
 */
function grabNote(ctx: CanvasRenderingContext2D, note: NoteView, tMs: number) {
  const { x, y, radius, progress, readiness } = note
  const spin = tMs / 420
  const pulse = 1 + 0.14 * Math.sin(tMs / (readiness > 0 ? 60 : 160))

  ctx.save()
  ctx.translate(x, y)

  const halo = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 2.1 * pulse)
  halo.addColorStop(0, `rgba(255,179,46,${0.4 + 0.35 * readiness})`)
  halo.addColorStop(1, 'rgba(255,179,46,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, 0, radius * 2.1 * pulse, 0, Math.PI * 2)
  ctx.fill()

  ctx.rotate(spin)
  ctx.fillStyle = CATCH_GOLD
  const spikes = 8
  for (let i = 0; i < spikes; i++) {
    const a = (Math.PI * 2 * i) / spikes
    const inner = radius * 1.15
    const outer = radius * 1.62 * pulse
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
    ctx.lineTo(Math.cos(a + 0.16) * outer, Math.sin(a + 0.16) * outer)
    ctx.lineTo(Math.cos(a - 0.16) * outer, Math.sin(a - 0.16) * outer)
    ctx.closePath()
    ctx.fill()
  }
  ctx.rotate(-spin)

  const grad = ctx.createLinearGradient(0, -radius, 0, radius)
  grad.addColorStop(0, '#ffe6a8')
  grad.addColorStop(1, CATCH_GOLD)
  ctx.fillStyle = grad
  ctx.strokeStyle = CATCH_DEEP
  ctx.lineWidth = Math.max(2, radius * 0.16)
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    const px = Math.cos(a) * radius
    const py = Math.sin(a) * radius
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // 조여드는 집게 — 판정이 가까울수록 안쪽으로 모인다("쥐어라")
  const grip = radius * (1.5 - 0.45 * Math.min(1, progress))
  ctx.strokeStyle = CATCH_DEEP
  ctx.lineWidth = Math.max(2, radius * 0.2)
  ctx.lineCap = 'round'
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(0, 0, grip, dir > 0 ? -0.9 : Math.PI - 0.9, dir > 0 ? 0.9 : Math.PI + 0.9)
    ctx.stroke()
  }
  ctx.restore()

  handMark(ctx, note, CATCH_DEEP)
}

/** 연결 노트 경로 리본 + 따라가는 헤드 */
function trailRibbon(ctx: CanvasRenderingContext2D, note: NoteView) {
  const path = note.path
  if (!path || path.length < 2) return
  const c = PALETTE[note.hand]
  const width = note.judgeRadius * (note.tracing ? 1.5 : 1.15)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = note.tracing ? 0.9 : 0.35 + 0.45 * Math.min(1, note.scale)

  for (const [w, color] of [
    [width, c.edge],
    [width * 0.62, c.glow],
  ] as const) {
    ctx.lineWidth = w
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(path[0]!.x, path[0]!.y)
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i]!.x, path[i]!.y)
    ctx.stroke()
  }

  const end = path[path.length - 1]!
  ctx.globalAlpha = 1
  const image = rhythmNoteImage()
  if (image.complete && image.naturalWidth) {
    const size = width * 2.25
    ctx.save()
    if (note.hand === 'left') ctx.filter = 'hue-rotate(190deg) saturate(0.55) brightness(1.3)'
    else if (note.hand === 'any') ctx.filter = 'hue-rotate(255deg) saturate(0.86)'
    ctx.drawImage(image, end.x - size / 2, end.y - size / 2, size, size)
    ctx.restore()
  } else {
    ctx.fillStyle = c.edge
    ctx.beginPath()
    ctx.arc(end.x, end.y, width * 0.42, 0, Math.PI * 2)
    ctx.fill()
  }

  if (note.head) {
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = c.edge
    ctx.lineWidth = Math.max(2, width * 0.18)
    ctx.beginPath()
    ctx.arc(note.head.x, note.head.y, note.judgeRadius * 0.62, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// ── 커서 ───────────────────────────────────────────────────

/**
 * 고양이 발바닥 커서 — 최초 버전 그대로. 파스텔 채움 + 진한 테두리라
 * 오므렸을 때도 형태가 잘 보인다. 판정 반경 그대로 그린다(축소하지 않는다).
 * 손 골격 렌더는 화면을 너무 덮어서 폐기했다.
 */
function paw(ctx: CanvasRenderingContext2D, hand: HandView) {
  const { x, y, radius, isFist, side } = hand
  const image = pawImage(side)
  if (!image.complete || !image.naturalWidth) return
  const size = radius * (isFist ? 3.3 : 3.8)

  ctx.save()
  ctx.globalAlpha = isFist ? 0.84 : 1
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size)
  ctx.restore()
  return

  /*

  // 발바닥 젤리
  ctx.beginPath()
  ctx.ellipse(
    0,
    r * 0.1,
    r * 1.02,
    r * 1.04,
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  ctx.stroke()

  // 발가락 4개
  ctx.strokeStyle = c.edge
  ctx.lineWidth = Math.max(1.6, r * 0.105)
  for (const [tx, ty, angle] of [
    [-0.58, -0.43, -0.52],
    [-0.2, -0.7, -0.18],
    [0.2, -0.7, 0.18],
    [0.58, -0.43, 0.52],
  ] as const) {
    pad(tx * r, ty * r, r * 0.23, r * 0.32, angle)
  }
  pad(0, r * 0.28, r * 0.62, r * 0.49)

  ctx.fillStyle = 'rgba(255,255,255,0.54)'
  ctx.beginPath()
  ctx.ellipse(-r * 0.22, r * 0.08, r * 0.19, r * 0.1, -0.48, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  */
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = (Math.PI / 5) * i - Math.PI / 2
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

export const catCandySkin: CatchSkin = {
  id: 'cat-candy',
  label: '캣캔디',

  drawBackground(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#fff3ea')
    grad.addColorStop(1, '#ffe6d8')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    const image = rhythmBackgroundImage()
    if (image.complete && image.naturalWidth) {
      const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight)
      const drawW = image.naturalWidth * scale
      const drawH = image.naturalHeight * scale
      ctx.drawImage(image, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH)
    }
  },

  drawNote(ctx, note, tMs) {
    if (note.kind === 'trail') trailRibbon(ctx, note)
    // 추적 중인 연결 노트는 헤드가 본체 역할을 하므로 본체를 다시 그리지 않는다
    if (note.tracing) return

    timingRings(ctx, note)
    ctx.save()
    ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, note.scale)
    if (note.kind === 'catch') grabNote(ctx, note, tMs)
    else bubble(ctx, note)
    ctx.restore()
  },

  /** 타격감 — 이중 충격파 + 방사 파티클 + 판정 문구를 한꺼번에 띄운다. */
  drawHitFx(ctx, fx) {
    const t = fx.elapsedMs / fx.lifeMs
    if (t >= 1) return false
    const ease = 1 - Math.pow(1 - t, 3)
    const c = PALETTE[fx.hand]
    const color = JUDGE_COLOR[fx.judgement] ?? c.edge
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (fx.judgement === 'miss') {
      ctx.globalAlpha = 1 - t
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, fx.radius * 0.2 * (1 - t))
      ctx.beginPath()
      ctx.arc(fx.x, fx.y, fx.radius * (2.2 - 1.2 * ease), 0, Math.PI * 2)
      ctx.stroke()
      const d = fx.radius * 0.5
      ctx.lineCap = 'round'
      // 투박한 직선 X 대신 흰 스티커 외곽선과 컬러 안쪽 선을 겹쳐 부드럽게 보인다.
      ctx.strokeStyle = 'rgba(255,255,255,0.94)'
      ctx.lineWidth = Math.max(4, fx.radius * 0.3 * (1 - t))
      ctx.beginPath()
      ctx.moveTo(fx.x - d, fx.y - d)
      ctx.lineTo(fx.x + d, fx.y + d)
      ctx.moveTo(fx.x + d, fx.y - d)
      ctx.lineTo(fx.x - d, fx.y + d)
      ctx.stroke()
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, fx.radius * 0.15 * (1 - t))
      ctx.beginPath()
      ctx.moveTo(fx.x - d, fx.y - d)
      ctx.lineTo(fx.x + d, fx.y + d)
      ctx.moveTo(fx.x + d, fx.y - d)
      ctx.lineTo(fx.x - d, fx.y + d)
      ctx.stroke()
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.fillStyle = color
      ctx.font = `${Math.round(fx.radius * 0.68)}px "DNF Bit Bit", monospace`
      ctx.fillText(JUDGE_TEXT.miss!, fx.x, fx.y - fx.radius * (1.5 + ease * 0.8))
      ctx.restore()
      return true
    }

    const isPerfect = fx.judgement === 'perfect'
    const power = isPerfect ? 1 : 0.7

    ctx.globalAlpha = Math.max(0, 1 - t * 2.4)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(fx.x, fx.y, fx.radius * (0.9 + ease * 1.4) * power, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = (1 - t) * 0.95
    for (const [mul, widthMul] of [
      [2.6, 0.26],
      [1.6, 0.14],
    ] as const) {
      ctx.strokeStyle = mul > 2 ? color : c.glow
      ctx.lineWidth = Math.max(2, fx.radius * widthMul * (1 - t))
      ctx.beginPath()
      ctx.arc(fx.x, fx.y, fx.radius * (0.8 + ease * mul) * power, 0, Math.PI * 2)
      ctx.stroke()
    }

    const count = (isPerfect ? 10 : 6) + Math.min(6, Math.floor(fx.combo / 12))
    ctx.fillStyle = isPerfect ? '#ffd66b' : c.glow
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + t * 1.1
      const d = fx.radius * (0.7 + ease * 2.7) * power
      ctx.globalAlpha = (1 - t) * (isPerfect ? 1 : 0.8)
      star(ctx, fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, fx.radius * 0.3 * (1 - t) * power)
    }

    ctx.globalAlpha = Math.max(0, 1 - t * 1.3)
    ctx.fillStyle = color
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = Math.max(2, fx.radius * 0.14)
    const size = Math.round(fx.radius * (isPerfect ? 1.0 : 0.8))
    ctx.font = `${Math.round(size * 0.84)}px "DNF Bit Bit", monospace`
    const ty = fx.y - fx.radius * (1.4 + ease * 1.2)
    ctx.strokeText(JUDGE_TEXT[fx.judgement]!, fx.x, ty)
    ctx.fillText(JUDGE_TEXT[fx.judgement]!, fx.x, ty)

    ctx.restore()
    return true
  },

  drawCursor(ctx, hand) {
    paw(ctx, hand)
  },

  sfx: {
    perfect: { type: 'sine', freq: 880, sweepTo: 1620, durationMs: 130, gain: 0.32 },
    good: { type: 'sine', freq: 620, sweepTo: 880, durationMs: 120, gain: 0.24 },
    miss: { type: 'triangle', freq: 220, sweepTo: 110, durationMs: 180, gain: 0.16 },
  },
}
