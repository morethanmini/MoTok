/**
 * 정식 스킨 — 서비스 톤 (S15P11A706-49).
 *
 * ─── 공간 모델: 물속 단면도 (2026-07-31 전환) ────────────────────────────
 * x = 앵글러(좌상단 수면 위)로부터의 거리, y = 깊이다(loop.ts와 같은 의미). 그래서 코지 낚시
 * 레퍼런스의 "위는 공기 / 아래는 심해 + 해초 + 모래바닥" 구성을 그대로 쓴다.
 * 이전에는 원근(위=멀리)이라 이 구성이 거리 매핑과 정반대여서 못 썼다 — 팀 회의에서
 * 단면도 반응이 더 좋아 좌표 의미를 통째로 전환했다.
 *
 * 깊이는 이렇게 표현한다:
 *   · 물이 아래로 갈수록 어두워진다(4단 그라데이션)
 *   · 어종 깊이 층(loop.ts bandYRange) 경계선 + **미끼가 있는 층만 밝게** — 깊이 조작 피드백
 *   · 앵글러는 좌상단 수면 위 보트 — 줄이 수면을 뚫고 내려가는 그림이 단면도의 최대 이득
 *
 * ─── 색·테두리 규칙 ─────────────────────────────────────────────────────
 * UI·전경 오브젝트(물고기·찌·배지·보트)는 `tokens.css`의 잉크 테두리 + 하드 섀도우를 쓴다.
 * **배경(하늘·물·모래·해초)은 테두리 없이 부드럽게 간다.** 처음엔 배경까지 잉크로 둘렀는데
 * 색칠공부처럼 보였다(2026-07-30 지적). 팀 에셋을 열어보니 규칙이 이미 그렇다 —
 * `lobby/lobby-cloud-a.png`(전경 구름)는 계단식 잉크 외곽선이지만
 * `games/rhythm-thumbnail/background.png`(게임 배경)는 외곽선 없는 디더 그라데이션이다.
 *
 * ⚠ 글자: 흰 배지 위 글자에 잉크 외곽선을 두르면 픽셀 폰트 획 속을 메워 검은 덩어리가 된다.
 * 배지 위는 `badgeText`(채우기만), 배경 위에 뜬 글자는 `floatText`(2px 외곽선).
 */
import { FISH, type FishSpec } from '../../fight'
import {
  bandYRange,
  DEPTH_BANDS,
  landingXFromAim,
  type LoopConfig,
  type LoopState,
  type Phase,
  type SceneFish,
} from '../../loop'
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
// 물 — 아래로 갈수록 어두워진다. 단면도의 깊이는 이 명암이 만든다
const WATER_TOP = '#9fdcf0'
const WATER_MID = '#5fb2d6'
const WATER_DEEP = '#2e7aa6'
const WATER_BOT = '#1f5d85'
const SURFACE = '#e2f7fe'
const SAND = '#e3cf96'
const SAND_DEEP = '#c9ad72'
const KELP_FAR = '#3c8a72'
const KELP_NEAR = '#2f7a5f'
const BOAT_HULL = '#c9945f'
const BOAT_RIM = '#9a6a3f'
/** 모래바닥 높이(px) — 물고기 하한(depthMaxMarginPx 48)보다 낮아 물고기가 모래에 박히지 않는다 */
const SAND_H = 36

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

/** 해초 한 포기 — 세 가닥이 밑동에서 함께 흔들린다. 배경 규칙대로 테두리 없음 */
function kelp(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  h: number,
  color: string,
  tMs: number,
  width: number,
) {
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = width
  for (const [dx, hk] of [
    [-8, 0.72],
    [0, 1],
    [9, 0.82],
  ] as const) {
    const sway = Math.sin(tMs / 900 + x / 40 + dx) * (5 + h * 0.05)
    ctx.beginPath()
    ctx.moveTo(x + dx, baseY)
    ctx.quadraticCurveTo(x + dx + sway * 0.35, baseY - h * hk * 0.55, x + dx + sway, baseY - h * hk)
    ctx.stroke()
  }
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

    // ── 물 — 스캘럽 수면 + 깊이 그라데이션 4단. 아래로 갈수록 어둡다(단면도의 깊이)
    const water = ctx.createLinearGradient(0, waterY, 0, H)
    water.addColorStop(0, WATER_TOP)
    water.addColorStop(0.32, WATER_MID)
    water.addColorStop(0.7, WATER_DEEP)
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

    /*
     * 캠은 여기서 그리지 않는다 (2026-07-31 분리 결정).
     *
     * 이전엔 alpha 0.1 전체 워시로 겹쳤는데 프레이밍 확인엔 쓸모없고 배경 팔레트만 더럽혔다.
     * 캠은 FishingGame.vue의 DOM PiP로 나갔다 — 게임룸이 송출하는 건 캔버스뿐이라, DOM에 두면
     * 내 얼굴은 나한테만 보이고 다른 참가자에겐 순수 게임 화면만 나간다.
     * ⚠ 기획 §게임 화면 구성 "내 캠은 반투명"과 어긋나는 변경 — 팀 공유 필요.
     */

    // ── 빛줄기 — 수면에서 비스듬히 내려온다. "물속"임을 알리는 가장 싼 장치
    ctx.save()
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 3; i++) {
      const rx = 150 + i * 185 + Math.sin(t / 2600 + i * 2.1) * 24
      const topW = 26 + i * 8
      ctx.globalAlpha = 0.06 + (i % 2) * 0.03
      ctx.beginPath()
      ctx.moveTo(rx, waterY + 4)
      ctx.lineTo(rx + topW, waterY + 4)
      ctx.lineTo(rx + topW + 52, waterY + 190)
      ctx.lineTo(rx + 8, waterY + 190)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()

    // ── 깊이 층 — 경계선 + **미끼가 있는 층만 밝게**. 깊이 조작(steer)의 화면 피드백이다
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    for (let i = 1; i < DEPTH_BANDS; i++) {
      const y = bandYRange(cfg, i).top
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
    const st = view.state
    if (st.bobber.visible && (st.phase === 'waiting' || st.phase === 'bite')) {
      for (let i = 0; i < DEPTH_BANDS; i++) {
        const band = bandYRange(cfg, i)
        if (st.bobber.y >= band.top && st.bobber.y < band.bottom) {
          ctx.fillStyle = 'rgba(255,255,255,0.07)'
          ctx.fillRect(0, band.top, W, band.bottom - band.top)
          break
        }
      }
    }
    ctx.restore()

    // ── 원경 해초 — 모래에 심는다. 어둡고 가늘어서 물고기 뒤로 물러난다
    for (const [x, h] of [
      [110, 64],
      [285, 46],
      [420, 72],
      [560, 52],
    ] as const) {
      kelp(ctx, x, H - SAND_H + 10, h, KELP_FAR, t, 5)
    }

    // ── 모래바닥 — 물결진 윗선 두 겹 + 조약돌
    const sandTop = H - SAND_H
    ctx.fillStyle = SAND
    ctx.beginPath()
    ctx.moveTo(0, sandTop + Math.sin(1.3) * 5)
    for (let x = 16; x <= W; x += 16) ctx.lineTo(x, sandTop + Math.sin(x / 46 + 1.3) * 5)
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = SAND_DEEP
    ctx.beginPath()
    ctx.moveTo(0, H - 14 + Math.sin(4) * 4)
    for (let x = 16; x <= W; x += 16) ctx.lineTo(x, H - 14 + Math.sin(x / 60 + 4) * 4)
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fill()
    for (const [px, py, pr] of [
      [86, 10, 5],
      [204, 16, 4],
      [351, 9, 6],
      [489, 15, 4],
      [598, 11, 5],
    ] as const) {
      ctx.beginPath()
      ctx.ellipse(px, sandTop + py, pr + 2, pr, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // ── 기포 — 천천히 올라간다. 시각 기반이라 프레임률과 무관하다
    ctx.save()
    ctx.fillStyle = '#ffffff'
    const cycle = sandTop - waterY - 20
    for (let i = 0; i < 5; i++) {
      const by = sandTop - 10 - ((((t / 1000) * (22 + i * 6) + i * 83) % cycle) + cycle) % cycle
      const bx = 70 + i * 130 + Math.sin(t / 1200 + i * 1.9) * 9
      ctx.globalAlpha = 0.22
      ctx.beginPath()
      ctx.arc(bx, by, 2.5 + (i % 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  },

  /**
   * 근경 해초 — 물고기·미끼 **앞**에 그린다. 앞뒤 겹이 있어야 수조가 아니라 물속이 된다.
   * 좌우 가장자리에만 둬서 플레이 영역을 가리지 않는다.
   */
  drawForeground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView) {
    const { height: H } = cfg
    for (const [x, h, w] of [
      [26, 96, 9],
      [58, 70, 8],
      [576, 62, 8],
      [608, 88, 9],
    ] as const) {
      kelp(ctx, x, H - 8, h, KELP_NEAR, view.tMs, w)
    }
  },

  drawFish(
    ctx: CanvasRenderingContext2D,
    f: SceneFish,
    isActive: boolean,
    phase: Phase,
    tMs: number,
    _cfg: LoopConfig,
  ) {
    /*
     * 단면도라 원근 페이드가 없다 — y는 거리가 아니라 깊이다. 같은 물고기는 어느 층에 있든
     * 같은 크기·선명도로 그린다(수심 명암은 배경 그라데이션이 담당한다).
     */
    const r = fishRadius(f.spec)
    const shape = fishShape(f.spec)
    const color = isActive ? YELLOW : rarityColor(f.spec)
    // 작은 물고기에 굵은 테두리를 두르면 테두리가 몸통을 다 먹는다
    const sw = r > 20 ? 3 : 2

    ctx.save()
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

    // 낚싯줄 — 좌상단 대 끝에서 수면을 뚫고 미끼까지. 단면도의 최대 시각적 이득이 이 한 줄이다
    const tip = rodTip(cfg)
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(bx, by)
    inkStroke(ctx, 2)

    // 줄이 수면을 뚫는 자리 — 파문 두 겹. 미끼는 물속이므로 파문은 수면에 생긴다
    if ((s.phase === 'waiting' || s.phase === 'bite') && by > cfg.waterY) {
      const ct = (cfg.waterY - tip.y) / Math.max(1, by - tip.y)
      const sx = q(tip.x + (bx - tip.x) * ct)
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = PAPER
      for (const k of [1, 1.7]) {
        ctx.beginPath()
        ctx.ellipse(sx, cfg.waterY + 3, q(11 * k), q(4 * k), 0, 0, Math.PI * 2)
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
    // 조준이 착수 거리를 정한다 — 범위 캡슐 위에 손을 따라다니는 착수점 마커를 띄운다.
    // 던지기 전에 "여기 떨어진다"가 보이는 것이 파워 방식 대비 조준 방식의 존재 이유다.
    const nearX = cfg.landNearXPx
    const farX = cfg.width - cfg.landFarMarginPx
    const y = q(cfg.waterY + cfg.depthMinMarginPx)
    const lx = q(landingXFromAim(cfg, aimX))

    // 착수 가능 범위 — 얇은 캡슐. 굵으면 물을 다 가린다
    badge(ctx, nearX, y - 5, farX - nearX, 10, MINT, 2)

    // 착수점 마커 — 맥동하는 표적. 낚싯대 끝에서 점선이 이어져 "던지면 이 줄로 간다"를 만든다
    const tip = rodTip(cfg)
    ctx.save()
    ctx.setLineDash([9, 9])
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(lx, y)
    inkStroke(ctx, 2)
    ctx.restore()

    const pulse = 8 + Math.sin(tMs / 160) * 2
    ctx.beginPath()
    ctx.arc(lx, y, pulse, 0, Math.PI * 2)
    ctx.fillStyle = PAPER
    ctx.fill()
    inkStroke(ctx, 3)
    ctx.beginPath()
    ctx.arc(lx, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = CORAL
    ctx.fill()

    floatText(ctx, '가까이', nearX, y + 26, 15, PAPER)
    floatText(ctx, '멀리', farX, y + 26, 15, PAPER)
  },

  drawGauges(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg
    // 앵글러가 좌상단으로 갔다(단면도) — 화면 아래는 이제 게이지가 전부 쓴다
    const x = 28
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

    // 폭 상한 384 — 화면 폭의 60%. 앵글러가 좌상단으로 가서 겹칠 게 없어졌지만,
    // 배너가 물을 다 가리지 않는 상한으로 유지한다
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
 * 좌상단 수면 위 보트에서 바다 쪽으로 대를 뻗는다. loop.ts의 castFrom(W×0.27, waterY×0.5)과
 * 같은 자리다 — 찌 비행 포물선이 대 끝에서 출발해야 줄과 궤적이 안 어긋난다.
 */
function rodTip(cfg: LoopConfig) {
  return { x: cfg.width * 0.27, y: cfg.waterY * 0.5 }
}

function drawAngler(ctx: CanvasRenderingContext2D, cfg: LoopConfig) {
  const cx = 74
  // 보트는 수면에 뜬다 — 갑판이 수면선 살짝 위, 선체 아랫부분은 물에 잠긴다
  const deckY = cfg.waterY - 4

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
  ctx.quadraticCurveTo((cx + 18 + tip.x) / 2, deckY - 64, tip.x, tip.y)
  ctx.strokeStyle = INK
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.stroke()
}
