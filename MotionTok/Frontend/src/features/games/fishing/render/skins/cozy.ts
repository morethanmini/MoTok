/**
 * 정식 스킨 — 서비스 톤 (S15P11A706-49).
 *
 * ─── 공간 모델 ───────────────────────────────────────────────────────────
 * 이 무대는 **단면도가 아니라 원근으로 본 수면**이다. `loop.ts`가 위쪽(수평선)을 멀리,
 * 아래쪽을 가까이로 매핑한다(`landFarMarginPx`가 수면 근처, `landNearMarginPx`가 화면 아래).
 * 그래서 코지 낚시 게임 레퍼런스에서 흔한 "위는 공기 / 아래는 심해 + 해초 + 모래바닥" 구성을
 * 그대로 쓸 수 없다. 그걸 깔면 화면 아래가 심해가 되어 던지기 거리 매핑과 정반대가 된다.
 *
 * 대신 원근에 맞는 장치로 깊이를 만든다:
 *   · 물고기가 위로 갈수록 작고 흐려진다(원근 페이드)
 *   · 근경(화면 아래)에 갈대, 원경(수평선)에 언덕·구름
 *   · 앵글러는 가까운 쪽 = 좌하단
 *
 * ─── 색·테두리 규칙 ─────────────────────────────────────────────────────
 * UI·전경 오브젝트(물고기·찌·배지·보트)는 `tokens.css`의 잉크 테두리 + 하드 섀도우를 쓴다.
 * **배경(하늘·언덕·물)은 테두리 없이 부드럽게 간다.** 처음엔 배경까지 잉크로 둘렀는데 색칠공부
 * 처럼 보였다(2026-07-30 지적). 팀 에셋을 열어보니 규칙이 이미 그렇다 —
 * `lobby/lobby-cloud-a.png`(전경 구름)는 계단식 잉크 외곽선이지만
 * `games/rhythm-thumbnail/background.png`(게임 배경)는 외곽선 없는 디더 그라데이션이다.
 *
 * ⚠ 글자: 흰 배지 위 글자에 잉크 외곽선을 두르면 픽셀 폰트 획 속을 메워 검은 덩어리가 된다.
 * 배지 위는 `badgeText`(채우기만), 배경 위에 뜬 글자는 `floatText`(2px 외곽선).
 */
import { FISH, type FishSpec } from '../../fight'
import type { LoopConfig, LoopState, Phase, SceneFish } from '../../loop'
import type { FishingSkin, FishingView, Splash } from '../types'
import catUrl from '@/assets/games-catalog/hero-fishing-cat-transparent.png'

/* ── tokens.css — UI·전경 ── */
const INK = '#38263d'
const PAPER = '#fffaf0'
const MINT = '#48c8a4'
const CORAL = '#ef6872'
const YELLOW = '#ffc83d'
const VIOLET = '#9a72d8'

/**
 * 배경 팔레트 — 토큰이 아니다.
 *
 * `tokens.css`는 UI 크롬(버튼·카드·배지)의 색 규약이라 채도가 높다. 그 색을 배경에 쓰면
 * 배경이 UI만큼 튀어서 물고기가 안 보인다(이전 버전에서 `--c-blue #6579dd`를 물 색으로 썼다가
 * 화면이 남색으로 무거워졌다). 배경은 일러스트라 별도 계열이고, 여기서만 쓴다.
 */
const SKY_TOP = '#eaf7ff'
const SKY_BOT = '#cfe8ff'
const HILL_FAR = '#c3e0cd'
const HILL_NEAR = '#9ccfae'
const WATER_TOP = '#bfe9f7'
const WATER_MID = '#83cfea'
const WATER_BOT = '#4fa6cd'
const SURFACE = '#e2f7fe'
const REED_FAR = '#7cbd9b'
const REED_NEAR = '#4f9c78'
const BOAT_HULL = '#c9945f'
const BOAT_RIM = '#9a6a3f'

const FONT = "'DNF Bit Bit', ui-monospace, monospace"

/**
 * 고양이 앵글러 — 게임 카탈로그의 낚시 고양이를 그대로 쓴다.
 *
 * 원본은 1536×1024이고 왼쪽에 매달린 장난감, 오른쪽에 고양이가 있다. 고양이만 잘라 쓴다
 * (불투명 바운딩 박스 실측: 537,432 크기 591×563). 비율로 적어둔 이유는 에셋이 리사이즈돼도
 * 깨지지 않게 하려는 것이다.
 */
const catImg = new Image()
catImg.src = catUrl
const CAT_CROP = { sx: 0.3496, sy: 0.4219, sw: 0.3848, sh: 0.5498 }

/** 2px 격자 스냅 — 축 정렬 도형이 격자에 붙어야 픽셀아트로 읽힌다 */
const q = (v: number) => Math.round(v / 2) * 2

function inkStroke(ctx: CanvasRenderingContext2D, w: number) {
  ctx.strokeStyle = INK
  ctx.lineWidth = w
  ctx.lineJoin = 'miter'
  ctx.stroke()
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.roundRect(q(x), q(y), q(w), q(h), r)
}

/** 블러 0 하드 섀도우 — 같은 도형을 잉크로 옮겨 칠하고 그 위에 본체를 올린다 */
function hardShadow(ctx: CanvasRenderingContext2D, path: () => void, off = 4) {
  ctx.save()
  ctx.translate(off, off)
  path()
  ctx.fillStyle = INK
  ctx.fill()
  ctx.restore()
}

/** 배지 위 글자 — 외곽선 없다. 배경이 이미 흰 종이라 대비가 최대다 */
function badgeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
) {
  ctx.save()
  ctx.font = `${px}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
  ctx.restore()
}

/** 배경 위에 떠 있는 글자 — 얇은 외곽선만. 두꺼우면 글자 속이 메워진다 */
function floatText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
) {
  ctx.save()
  ctx.font = `${px}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
  ctx.restore()
}

function fitFontPx(ctx: CanvasRenderingContext2D, text: string, maxW: number, start: number) {
  let px = start
  while (px > 14) {
    ctx.font = `${px}px ${FONT}`
    if (ctx.measureText(text).width <= maxW) break
    px -= 2
  }
  return px
}

function badge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  strokeW = 3,
) {
  const path = () => roundRectPath(ctx, x, y, w, h, h / 2)
  hardShadow(ctx, path)
  path()
  ctx.fillStyle = fill
  ctx.fill()
  inkStroke(ctx, strokeW)
}

/** 수면 물결 — 직선 대신 스캘럽. 자를 대고 그은 선처럼 보이지 않게 한다 */
function surfaceY(x: number, waterY: number, tMs: number): number {
  return waterY + Math.sin(tMs / 1100 + x / 74) * 3.5 + Math.sin(tMs / 700 + x / 31) * 1.5
}

/* ────────────────────────── 어종 ────────────────────────── */

/**
 * 어종 실루엣 — 색만 다르면 희귀도가 안 읽힌다(2026-07-30 지적: 물고기가 다 똑같다).
 * 점수 구간별로 **몸 모양 자체**를 바꾼다. 점수 = 희귀도다(loop.ts의 pickSpec이 점수 역가중).
 */
export type FishShape = 'slim' | 'round' | 'torpedo' | 'shark'

export function fishShape(spec: FishSpec): FishShape {
  if (spec.score >= 120) return 'shark'
  if (spec.score >= 45) return 'torpedo'
  if (spec.score >= 25) return 'round'
  return 'slim'
}

export function rarityColor(spec: FishSpec): string {
  if (spec.score >= 120) return VIOLET
  if (spec.score >= 45) return CORAL
  if (spec.score >= 25) return YELLOW
  return MINT
}

/**
 * 크기는 희귀도로 정한다 — 귀한 물고기가 크다.
 *
 * 계측 스킨은 `8 + (1 - requiredRate) * 14`를 쓰는데, requiredRate가 높은 상어에서 반지름이
 * 0에 가까워져 제일 귀한 물고기가 제일 작게 그려진다. 여기서는 점수로 뒤집었다.
 */
const MAX_SCORE = Math.max(...FISH.map((f) => f.score))
export function fishRadius(spec: FishSpec): number {
  return 12 + (spec.score / MAX_SCORE) * 16
}

/** 몸통 — 모양마다 실루엣이 다르다. 원점은 몸 중심, +x가 머리 방향 */
function fishBody(ctx: CanvasRenderingContext2D, shape: FishShape, r: number) {
  ctx.beginPath()
  switch (shape) {
    case 'slim':
      ctx.ellipse(0, 0, r * 0.95, r * 0.42, 0, 0, Math.PI * 2)
      break
    case 'round':
      ctx.ellipse(0, 0, r * 0.85, r * 0.66, 0, 0, Math.PI * 2)
      break
    case 'torpedo':
      // 앞이 뾰족하고 뒤가 좁아지는 방추형
      ctx.moveTo(r, 0)
      ctx.quadraticCurveTo(r * 0.3, -r * 0.6, -r * 0.85, -r * 0.22)
      ctx.quadraticCurveTo(-r, 0, -r * 0.85, r * 0.22)
      ctx.quadraticCurveTo(r * 0.3, r * 0.6, r, 0)
      break
    case 'shark':
      // 코가 길고 배가 평평하다
      ctx.moveTo(r * 1.1, -r * 0.04)
      ctx.quadraticCurveTo(r * 0.2, -r * 0.62, -r * 0.8, -r * 0.3)
      ctx.lineTo(-r * 0.86, r * 0.16)
      ctx.quadraticCurveTo(r * 0.1, r * 0.5, r * 1.1, -r * 0.04)
      break
  }
}

/** 꼬리 — 흔들린다. 갈래 모양이 종마다 다르다 */
function fishTail(ctx: CanvasRenderingContext2D, shape: FishShape, r: number) {
  ctx.beginPath()
  if (shape === 'shark' || shape === 'torpedo') {
    // 초승달 — 빠른 어종
    ctx.moveTo(4, 0)
    ctx.lineTo(q(-r * 0.9), q(-r * 0.8))
    ctx.quadraticCurveTo(q(-r * 0.45), 0, q(-r * 0.9), q(r * 0.8))
    ctx.closePath()
  } else {
    ctx.moveTo(2, 0)
    ctx.lineTo(q(-r * 0.75), q(-r * 0.55))
    ctx.lineTo(q(-r * 0.5), 0)
    ctx.lineTo(q(-r * 0.75), q(r * 0.55))
    ctx.closePath()
  }
}

export const cozySkin: FishingSkin = {
  id: 'cozy',
  label: '정식',

  drawBackground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView) {
    const { width: W, height: H, waterY } = cfg
    const t = view.tMs

    // ── 하늘 — 옅은 그라데이션. 평면 한 색이면 "칠해놓은 판"으로 보인다
    const sky = ctx.createLinearGradient(0, 0, 0, waterY)
    sky.addColorStop(0, SKY_TOP)
    sky.addColorStop(1, SKY_BOT)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, waterY + 6)

    // ── 구름 — 천천히 흐른다. 테두리 없음(배경 규칙)
    ctx.save()
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 4; i++) {
      const cx = (((t / 1000) * (4 + i * 2.5) + i * 190) % (W + 220)) - 110
      const cy = 16 + (i % 2) * 22
      const s = 0.7 + (i % 3) * 0.22
      ctx.globalAlpha = 0.55 + (i % 2) * 0.25
      ctx.beginPath()
      ctx.arc(cx, cy, 12 * s, Math.PI, 0)
      ctx.arc(cx + 15 * s, cy - 6 * s, 16 * s, Math.PI, 0)
      ctx.arc(cx + 34 * s, cy, 11 * s, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()

    // ── 원경 언덕 — 수평선에 뭐라도 걸려야 깊이가 생긴다. 두 겹으로 원근을 만든다
    for (const [color, base, humps] of [
      [HILL_FAR, waterY - 4, [[70, 150, 30], [330, 210, 40], [590, 160, 26]]],
      [HILL_NEAR, waterY, [[190, 190, 22], [470, 230, 28]]],
    ] as const) {
      ctx.fillStyle = color
      for (const [cx, w, h] of humps) {
        ctx.beginPath()
        ctx.moveTo(cx - w / 2, base)
        ctx.quadraticCurveTo(cx - w * 0.22, base - h, cx, base - h * 0.86)
        ctx.quadraticCurveTo(cx + w * 0.3, base - h * 1.08, cx + w / 2, base)
        ctx.closePath()
        ctx.fill()
      }
    }

    // ── 물 — 스캘럽 수면 + 그라데이션. 평면 색 띠는 풍경이 아니라 그라데이션 대용품이었다
    const water = ctx.createLinearGradient(0, waterY, 0, H)
    water.addColorStop(0, WATER_TOP)
    water.addColorStop(0.45, WATER_MID)
    water.addColorStop(1, WATER_BOT)
    ctx.fillStyle = water
    ctx.beginPath()
    ctx.moveTo(0, surfaceY(0, waterY, t))
    for (let x = 8; x <= W; x += 8) ctx.lineTo(x, surfaceY(x, waterY, t))
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()

    // 수면 바로 아래 밝은 띠 — 빛이 닿는 자리
    ctx.save()
    ctx.clip()
    ctx.fillStyle = SURFACE
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.moveTo(0, surfaceY(0, waterY, t))
    for (let x = 8; x <= W; x += 8) ctx.lineTo(x, surfaceY(x, waterY, t))
    for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, surfaceY(x, waterY, t) + 13)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // ── 캠 — 물 위에 아주 옅게(기획 §게임 화면 구성: 내 캠은 반투명)
    const video = view.video
    if (video && video.readyState >= 2) {
      ctx.save()
      ctx.globalAlpha = 0.1
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, W, H)
      ctx.restore()
    }

    // ── 물결 결 — 원근을 따라 아래로 갈수록 길고 굵어진다
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = 'round'
    for (const [ry, len, alpha] of [
      [0.18, 14, 0.2],
      [0.36, 20, 0.22],
      [0.58, 28, 0.24],
      [0.8, 38, 0.26],
    ] as const) {
      const y = waterY + (H - waterY) * ry
      ctx.globalAlpha = alpha
      ctx.lineWidth = 2 + ry * 3
      ctx.beginPath()
      for (let x = -30; x < W + 30; x += len * 2.4) {
        const off = Math.sin(t / 950 + ry * 5 + x / 80) * (3 + ry * 4)
        const px = x + ((t / 1000) * (4 + ry * 14)) % (len * 2.4)
        ctx.moveTo(px, y + off)
        ctx.lineTo(px + len, y + off)
      }
      ctx.stroke()
    }
    ctx.restore()

    // ── 근경 갈대 — 화면 아래 = 가까운 쪽. 좌우 가장자리에만 둬서 플레이 영역을 비운다
    for (const [color, reeds] of [
      [REED_FAR, [[24, 46], [58, 34], [592, 40], [622, 52]]],
      [REED_NEAR, [[8, 62], [40, 74], [608, 66], [634, 80]]],
    ] as const) {
      ctx.strokeStyle = color
      ctx.lineCap = 'round'
      for (const [rx, rh] of reeds) {
        const sway = Math.sin(t / 800 + rx) * 5
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(rx, H)
        ctx.quadraticCurveTo(rx + sway * 0.4, H - rh * 0.6, rx + sway, H - rh)
        ctx.stroke()
      }
    }
  },

  drawFish(
    ctx: CanvasRenderingContext2D,
    f: SceneFish,
    isActive: boolean,
    phase: Phase,
    tMs: number,
    cfg: LoopConfig,
  ) {
    /*
     * 원근 — 수면선에 가까울수록 멀다. 멀면 작고 흐리게 그린다.
     *
     * 희귀도 크기(fishRadius)를 덮어쓰지 않고 곱한다. 0.74~1.12 범위라 희귀도 차이는 그대로
     * 읽히면서 깊이만 얹힌다.
     */
    const depth = Math.max(0, Math.min(1, (f.y - cfg.waterY) / (cfg.height - cfg.waterY)))
    const persp = 0.74 + depth * 0.38
    const r = fishRadius(f.spec) * persp
    const shape = fishShape(f.spec)
    const color = isActive ? YELLOW : rarityColor(f.spec)
    // 작은 물고기에 굵은 테두리를 두르면 테두리가 몸통을 다 먹는다
    const sw = r > 20 ? 3 : 2

    ctx.save()
    ctx.globalAlpha = 0.7 + depth * 0.3
    ctx.translate(q(f.x), q(f.y))
    if (f.dir < 0) ctx.scale(-1, 1)

    // 꼬리
    ctx.save()
    ctx.translate(-r * 0.8, 0)
    ctx.rotate(Math.sin(tMs / 150 + f.id) * 0.22)
    fishTail(ctx, shape, r)
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)
    ctx.restore()

    // 등지느러미 — 상어는 크고 뾰족하다
    const finH = shape === 'shark' ? 1.15 : 0.95
    ctx.beginPath()
    ctx.moveTo(q(-r * 0.3), q(-r * 0.5))
    ctx.lineTo(q(-r * 0.02), q(-r * finH))
    ctx.lineTo(q(r * 0.32), q(-r * 0.45))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)

    // 몸통
    fishBody(ctx, shape, r)
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)

    // 배 — 밝은 면 하나로 입체감
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.ellipse(-r * 0.04, r * 0.22, r * 0.56, r * 0.19, 0, 0, Math.PI * 2)
    ctx.fillStyle = PAPER
    ctx.fill()
    ctx.restore()

    // 눈 — 흰자 + 잉크 동자. 점 하나보다 훨씬 살아 보인다
    const ex = shape === 'shark' ? r * 0.5 : r * 0.44
    ctx.beginPath()
    ctx.arc(q(ex), q(-r * 0.16), Math.max(2.5, r * 0.17), 0, Math.PI * 2)
    ctx.fillStyle = PAPER
    ctx.fill()
    inkStroke(ctx, 1.5)
    ctx.beginPath()
    ctx.arc(q(ex + r * 0.05), q(-r * 0.16), Math.max(1.4, r * 0.08), 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.restore()

    // 관심 단계 — 대기의 긴장감을 눈에 보이게 한다
    const mark =
      f.interest === 'curious'
        ? { t: '?', c: YELLOW }
        : f.interest === 'approaching' && phase === 'waiting'
          ? { t: '!', c: CORAL }
          : isActive && phase === 'bite'
            ? { t: '!!', c: CORAL }
            : null
    if (mark) {
      const my = f.y - r - 18 + (mark.t === '!!' ? Math.sin(tMs / 80) * 4 : 0)
      const w = mark.t === '!!' ? 38 : 26
      badge(ctx, f.x - w / 2, my - 14, w, 28, mark.c, 2)
      badgeText(ctx, mark.t, f.x, my, 19, PAPER)
    }
  },

  /**
   * 물튀김 — 링 + 물방울. 링 하나만 퍼지는 건 "튀었다"로 안 읽힌다.
   * 물방울 위치는 링의 r·life에서 계산해 별도 상태를 늘리지 않았다.
   */
  drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
    const DROPS = 7
    ctx.save()
    for (const p of splashes) {
      const life = Math.max(0, p.life / 0.6)
      const age = 1 - life

      ctx.globalAlpha = life
      ctx.beginPath()
      ctx.arc(q(p.x), q(p.y), q(p.r), 0, Math.PI * 2)
      ctx.strokeStyle = PAPER
      ctx.lineWidth = 5
      ctx.stroke()
      inkStroke(ctx, 2)

      ctx.globalAlpha = life * 0.95
      for (let i = 0; i < DROPS; i++) {
        const a = (i / DROPS) * Math.PI * 2 + p.r * 0.05
        const spread = p.r * 1.5
        const dx = Math.cos(a) * spread
        // -sin으로 솟구침, age²로 낙하 — 포물선이 되어야 물처럼 보인다
        const dy = -Math.abs(Math.sin(a)) * spread * 0.8 + age * age * 46
        const rad = Math.max(1.5, 4 * life)
        ctx.beginPath()
        ctx.arc(q(p.x + dx), q(p.y + dy), rad, 0, Math.PI * 2)
        ctx.fillStyle = PAPER
        ctx.fill()
        if (rad > 2.5) inkStroke(ctx, 1.5)
      }
    }
    ctx.restore()
  },

  drawBobber(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig, tMs: number) {
    const shake = s.phase === 'bite' ? Math.sin(tMs * 0.032) * 6 : Math.sin(tMs / 480) * 2
    const bx = q(s.bobber.x)
    const by = q(s.bobber.y + shake)

    /*
     * 낚싯줄은 **낚싯대 끝**에서 나온다.
     *
     * 예전엔 화면 아래 중앙(loop.ts의 castFrom)에서 그었는데, 그러면 아무것도 없는 가장자리에서
     * 선이 튀어나온다. 물리 계산은 loop.ts 그대로 두고 그리는 자리만 대 끝으로 옮겼다 —
     * 순수하게 보이는 문제라 판정에 영향이 없다.
     */
    const tip = rodTip(cfg)
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(bx, by)
    inkStroke(ctx, 2)

    // 찌가 물에 잠긴 자리 — 파문 두 겹
    if (s.phase === 'waiting' || s.phase === 'bite') {
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = PAPER
      for (const k of [1, 1.7]) {
        ctx.beginPath()
        ctx.ellipse(bx, by + 9, q(11 * k), q(4 * k), 0, 0, Math.PI * 2)
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.restore()
    }

    const path = () => {
      ctx.beginPath()
      ctx.arc(bx, by, 9, 0, Math.PI * 2)
    }
    hardShadow(ctx, path, 3)
    // 위 절반 coral / 아래 절반 paper — 전통 찌 배색
    ctx.save()
    path()
    ctx.clip()
    ctx.fillStyle = CORAL
    ctx.fillRect(bx - 10, by - 10, 20, 10)
    ctx.fillStyle = PAPER
    ctx.fillRect(bx - 10, by, 20, 10)
    ctx.restore()
    path()
    inkStroke(ctx, 3)
  },

  drawAim(ctx: CanvasRenderingContext2D, aimX: number, cfg: LoopConfig, tMs: number) {
    const nearY = cfg.height - cfg.landNearMarginPx
    const farY = cfg.waterY + cfg.landFarMarginPx
    const x = q(aimX)

    // 착수 범위 — 얇은 캡슐. 굵으면 물을 다 가린다
    badge(ctx, x - 5, farY, 10, nearY - farY, MINT, 2)

    const tip = rodTip(cfg)
    ctx.save()
    ctx.setLineDash([9, 9])
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(x, nearY)
    inkStroke(ctx, 3)
    ctx.restore()

    // 양 끝 — 위가 멀리, 아래가 가까이
    const pulse = 6 + Math.sin(tMs / 160) * 2
    for (const y of [farY, nearY]) {
      ctx.beginPath()
      ctx.arc(x, q(y), pulse, 0, Math.PI * 2)
      ctx.fillStyle = PAPER
      ctx.fill()
      inkStroke(ctx, 2)
    }
    floatText(ctx, '멀리', x, farY - 20, 15, PAPER)
    floatText(ctx, '가까이', x, nearY + 22, 15, PAPER)
  },

  drawGauges(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg
    // 좌하단은 앵글러 자리다 — 보트 우측 끝(x=122)에 10px 여유를 두고 비켜준다
    const x = 132
    const w = W - x - 28
    const y = H - 42

    if (s.phase === 'fighting') {
      badge(ctx, x, y, w, 24, PAPER)
      // 채움색은 상태색이지 액센트가 아니다 — 감기는 중 mint, DANGER coral
      const fill = s.reeling || s.grace ? MINT : CORAL
      const fw = Math.max(0, Math.min(1, s.progress)) * (w - 8)
      if (fw > 4) {
        roundRectPath(ctx, x + 4, y + 4, fw, 16, 8)
        ctx.fillStyle = fill
        ctx.fill()
      }
    }

    if (s.phase === 'bite') {
      const p = Math.max(0, Math.min(1, s.biteLeftSec / cfg.biteWindowSec))
      badge(ctx, x, y, w, 20, PAPER)
      const fw = p * (w - 8)
      if (fw > 4) {
        roundRectPath(ctx, x + 4, y + 4, fw, 12, 6)
        ctx.fillStyle = YELLOW
        ctx.fill()
      }
    }
  },

  /**
   * 앵글러 + HUD.
   *
   * 앵글러를 `drawHud`에서 그리는 건 **흔들림 때문**이다. drawFrame은 무대만 흔드는데, 앵글러가
   * 흔들리면 손에 든 대에서 나오는 줄과 어긋난다(줄은 무대에서 그려진다). 카메라를 들고 있는
   * 주체가 흔들리지 않는 쪽이 자연스럽다.
   */
  drawHud(ctx: CanvasRenderingContext2D, text: string, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg
    drawAngler(ctx, cfg)

    // 점수 — 오른쪽 위 노란 배지
    const scoreText = `${s.score}`
    ctx.font = `22px ${FONT}`
    const sw = Math.max(54, ctx.measureText(scoreText).width + 30)
    badge(ctx, W - sw - 14, 12, sw, 34, YELLOW)
    badgeText(ctx, scoreText, W - sw / 2 - 14, 30, 22, INK)

    if (!text) return

    const caught = s.phase === 'result' && s.last?.outcome === 'caught'
    const danger = s.phase === 'fighting' && !s.reeling && !s.grace
    const hot = s.phase === 'bite' || danger
    const fill = caught ? YELLOW : hot ? CORAL : PAPER
    // coral·yellow 배지 위에서는 잉크가 잘 읽히지 않는다 — 종이색 글자로 뒤집는다
    const ink = caught ? INK : hot ? PAPER : INK

    /*
     * 폭 상한 384 — 배너가 앵글러를 덮지 않는 한계다.
     * 중앙 정렬이므로 배지 폭 bw = 글자폭+32 ≤ 416일 때 좌측 끝이 (640-416)/2 = 112 ≥ 보트 우측이다.
     * 실제 문구는 최대 232px라 여유가 있지만, 나중에 긴 문구가 들어와도 안 겹치게 못 박는다.
     */
    const px = fitFontPx(ctx, text, 384, 22)
    ctx.font = `${px}px ${FONT}`
    const bw = ctx.measureText(text).width + 32
    const bh = px + 16
    const y = H - 50 - bh
    badge(ctx, (W - bw) / 2, y, bw, bh, fill)
    badgeText(ctx, text, W / 2, y + bh / 2 + 1, px, ink)
  },
}

/* ────────────────────── 앵글러 ────────────────────── */

/**
 * 낚싯대 끝 — 줄이 시작하는 자리.
 *
 * 좌하단 앵글러에서 화면 중앙 쪽으로 대를 뻗는다. 좌하단에 둔 이유는 `loop.ts`의 착수 범위가
 * 화면 폭 전체(10 ~ W-10)라, 가운데에 앵글러를 놓으면 자기가 던진 찌를 자기가 가린다.
 */
function rodTip(cfg: LoopConfig) {
  return { x: cfg.width * 0.335, y: cfg.height - 138 }
}

function drawAngler(ctx: CanvasRenderingContext2D, cfg: LoopConfig) {
  const { height: H } = cfg
  const cx = 60
  const deckY = H - 26

  // 보트 — 뱃머리가 오른쪽(던지는 방향)
  const hull = () => {
    ctx.beginPath()
    ctx.moveTo(cx - 52, deckY)
    ctx.lineTo(cx + 62, deckY)
    ctx.quadraticCurveTo(cx + 46, deckY + 26, cx - 30, deckY + 26)
    ctx.quadraticCurveTo(cx - 52, deckY + 18, cx - 52, deckY)
    ctx.closePath()
  }
  hardShadow(ctx, hull)
  hull()
  ctx.fillStyle = BOAT_HULL
  ctx.fill()
  inkStroke(ctx, 3)
  // 뱃전 — 널판 한 줄로 나무 느낌
  ctx.beginPath()
  ctx.moveTo(cx - 48, deckY + 8)
  ctx.lineTo(cx + 52, deckY + 8)
  ctx.strokeStyle = BOAT_RIM
  ctx.lineWidth = 3
  ctx.stroke()

  // 고양이 — 에셋이 아직 로드 안 됐으면 그냥 건너뛴다(보트만 보인다)
  if (catImg.complete && catImg.naturalWidth > 0) {
    const iw = catImg.naturalWidth
    const ih = catImg.naturalHeight
    const drawH = 74
    const drawW = drawH * ((CAT_CROP.sw * iw) / (CAT_CROP.sh * ih))
    ctx.drawImage(
      catImg,
      CAT_CROP.sx * iw,
      CAT_CROP.sy * ih,
      CAT_CROP.sw * iw,
      CAT_CROP.sh * ih,
      cx - drawW / 2 + 4,
      deckY - drawH + 4,
      drawW,
      drawH,
    )
  }

  // 낚싯대 — 고양이 앞발에서 대 끝까지 휘어진다
  const tip = rodTip(cfg)
  ctx.beginPath()
  ctx.moveTo(cx + 18, deckY - 30)
  ctx.quadraticCurveTo((cx + 18 + tip.x) / 2, deckY - 96, tip.x, tip.y)
  ctx.strokeStyle = INK
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.stroke()
}
