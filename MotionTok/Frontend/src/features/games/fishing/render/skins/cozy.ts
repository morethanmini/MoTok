/**
 * 정식 스킨 — 서비스 톤 (S15P11A706-49).
 *
 * 색·테두리·그림자는 전부 `assets/styles/tokens.css`에서 온다. 여기서 새 색을 만들지 않는다 —
 * 게임 화면만 다른 팔레트를 쓰면 방에서 게임을 켰을 때 톤이 튄다.
 *
 * 규칙 다섯 개가 이 파일의 전부다:
 *   ① 잉크 한 색(#38263d)으로 테두리·글자·그림자를 다 쓴다. 순검정으로 바꾸면 값싸진다
 *   ② 그림자는 블러 0 오프셋(4,4) — 흐린 그림자를 하나 섞으면 스티커 느낌이 깨진다
 *   ③ 테두리 3~4px. 1px 선은 우리 화면에 없다
 *   ④ 그라데이션 금지 — 바다는 평면 색 띠로 깊이를 만든다
 *   ⑤ 파스텔 + 채도 있는 액센트. 네온은 계측 스킨의 것이다
 *
 * 2~3m 거리에서 읽혀야 하는 화면이라(웹캠 앞에서 팔을 휘두르는 사람이 본다) HUD는 캔버스에
 * 그린다. 게임룸이 송출하는 건 캔버스뿐이어서 DOM HUD는 다른 참가자 타일에 보이지 않는다.
 */
import { FISH, type FishSpec } from '../../fight'
import type { LoopConfig, LoopState, Phase, SceneFish } from '../../loop'
import type { FishingSkin, FishingView, Splash } from '../types'

/* ── tokens.css ── */
const INK = '#38263d'
const PAPER = '#fffaf0'
const MINT = '#48c8a4'
const CORAL = '#ef6872'
const YELLOW = '#ffc83d'
const BLUE = '#6579dd'
const VIOLET = '#9a72d8'
const SKY = '#cfe8ff'

/** 바다 — 평면 색 띠. 그라데이션 대신 단계로 깊이를 만든다(규칙 ④) */
const SEA_BANDS = ['#6579dd', '#5a6cc9', '#4f5eb4', '#45529f']

const FONT = "'DNF Bit Bit', ui-monospace, monospace"
const SHADOW = 4
const STROKE = 3

/**
 * 2px 격자 스냅 — 축 정렬 도형이 격자에 붙어야 픽셀아트로 읽힌다.
 *
 * ponytail: 진짜 픽셀아트는 저해상도(160×120)로 그려서 imageSmoothingEnabled=false로 4배
 * 확대하는 것이다. 그러면 곡선·글자까지 전부 픽셀이 된다. 지금은 loop.ts 좌표가 640×480이라
 * 그 방식을 쓰려면 좌표계를 갈아야 해서 스냅으로 근사했다 — 확대 방식이 필요해지면 여기서
 * 캔버스를 하나 더 두고 그 위에 그린 뒤 확대한다.
 */
const q = (v: number) => Math.round(v / 2) * 2

/** 잉크 테두리 — 모든 도형이 이걸 두른다(규칙 ③) */
function inkStroke(ctx: CanvasRenderingContext2D, w = STROKE) {
  ctx.strokeStyle = INK
  ctx.lineWidth = w
  ctx.lineJoin = 'miter'
  ctx.stroke()
}

/** 모서리 살짝 둥근 사각형 — 픽셀 카드의 형태 */
function chunkyRect(
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

/**
 * 블러 0 하드 섀도우(규칙 ②).
 * 같은 도형을 잉크로 (4,4) 옮겨 한 번 칠하고, 그 위에 본체를 올린다.
 */
function hardShadow(ctx: CanvasRenderingContext2D, path: () => void) {
  ctx.save()
  ctx.translate(SHADOW, SHADOW)
  path()
  ctx.fillStyle = INK
  ctx.fill()
  ctx.restore()
}

/**
 * 희귀도 색 — 점수가 곧 희귀도다(loop.ts의 pickSpec이 점수 역가중으로 뽑는다).
 * 흔한 물고기가 조용하고 귀한 물고기가 튀어야 대기의 보상이 눈에 보인다.
 */
function rarityColor(spec: FishSpec): string {
  if (spec.score >= 120) return VIOLET
  if (spec.score >= 45) return CORAL
  if (spec.score >= 25) return YELLOW
  return MINT
}

/**
 * 크기도 희귀도로 정한다 — 귀한 물고기가 크다.
 *
 * 계측 스킨은 `8 + (1 - requiredRate) * 14`를 쓰는데, requiredRate가 높은 상어에서 반지름이
 * 0에 가까워져 제일 귀한 물고기가 제일 작게 그려진다. 여기서는 점수로 뒤집었다.
 */
const MAX_SCORE = Math.max(...FISH.map((f) => f.score))
function fishRadius(spec: FishSpec): number {
  return 11 + (spec.score / MAX_SCORE) * 15
}

/** 잉크 외곽선 + 하드섀도우가 붙은 글자 — 멀리서 읽히는 유일한 방법 */
function inkText(
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
  ctx.lineWidth = Math.max(3, px * 0.14)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
  ctx.restore()
}

/** 문구가 폭에 들어갈 때까지 글자 크기를 줄인다 — 잘리는 것보다 작은 게 낫다 */
function fitFontPx(ctx: CanvasRenderingContext2D, text: string, maxW: number, start = 30): number {
  let px = start
  while (px > 14) {
    ctx.font = `${px}px ${FONT}`
    if (ctx.measureText(text).width <= maxW) break
    px -= 2
  }
  return px
}

/** 알약 배지 — 점수·게이지·HUD가 전부 이 형태다 */
function badge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  const path = () => chunkyRect(ctx, x, y, w, h, h / 2)
  hardShadow(ctx, path)
  path()
  ctx.fillStyle = fill
  ctx.fill()
  inkStroke(ctx)
}

export const cozySkin: FishingSkin = {
  id: 'cozy',
  label: '정식',

  drawBackground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView) {
    const { width: W, height: H, waterY } = cfg

    // 하늘 — 평면 한 색
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, W, waterY)

    // 구름 — 천천히 흐른다. 배경이 완전히 정지해 있으면 화면이 죽어 보인다
    ctx.save()
    ctx.globalAlpha = 0.9
    for (let i = 0; i < 3; i++) {
      const speed = 6 + i * 3
      const cx = ((view.tMs / 1000) * speed + i * 240) % (W + 160) - 80
      const cy = 24 + i * 26
      const cw = 62 + i * 14
      const path = () => {
        ctx.beginPath()
        ctx.roundRect(q(cx), q(cy), q(cw), q(20), 10)
      }
      path()
      ctx.fillStyle = PAPER
      ctx.fill()
      inkStroke(ctx, 2)
    }
    ctx.restore()

    // 바다 — 평면 띠 4단. 아래로 갈수록 어둡다(= 깊다)
    const bandH = (H - waterY) / SEA_BANDS.length
    SEA_BANDS.forEach((c, i) => {
      ctx.fillStyle = c
      ctx.fillRect(0, Math.floor(waterY + bandH * i), W, Math.ceil(bandH) + 1)
    })

    // 캠 — 물 위에 반투명(기획 §게임 화면 구성: 내 캠은 반투명).
    // 계측 스킨보다 더 옅게 깐다. 여기서는 내 몸이 판정 근거가 아니라 분위기다.
    const video = view.video
    if (video && video.readyState >= 2) {
      ctx.save()
      ctx.globalAlpha = 0.12
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, W, H)
      ctx.restore()
    }

    // 수면 — 잉크 굵은 선 + 물거품 점선
    ctx.beginPath()
    ctx.moveTo(0, q(waterY))
    ctx.lineTo(W, q(waterY))
    inkStroke(ctx, 4)
    ctx.save()
    ctx.fillStyle = PAPER
    for (let x = 0; x < W; x += 24) {
      const bob = Math.sin(view.tMs / 420 + x / 40) * 2
      ctx.fillRect(q(x + 4), q(waterY + 5 + bob), 12, 3)
    }
    ctx.restore()
  },

  drawFish(
    ctx: CanvasRenderingContext2D,
    f: SceneFish,
    isActive: boolean,
    phase: Phase,
    tMs: number,
  ) {
    const r = fishRadius(f.spec)
    const color = isActive ? YELLOW : rarityColor(f.spec)

    ctx.save()
    ctx.translate(q(f.x), q(f.y))
    if (f.dir < 0) ctx.scale(-1, 1)
    // 꼬리 — 지느러미가 흔들린다
    const flap = Math.sin(tMs / 160 + f.id) * 0.18
    ctx.save()
    ctx.translate(-r * 0.8, 0)
    ctx.rotate(flap)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(q(-r * 0.85), q(-r * 0.6))
    ctx.lineTo(q(-r * 0.85), q(r * 0.6))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx)
    ctx.restore()
    // 몸통 — 뭉툭한 사각형이 픽셀아트로 읽힌다
    chunkyRect(ctx, -r * 0.85, -r * 0.6, r * 1.75, r * 1.2, r * 0.42)
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx)
    // 배 — 밝은 면 하나로 입체감. 음영 그라데이션 대신이다
    ctx.save()
    ctx.globalAlpha = 0.5
    chunkyRect(ctx, -r * 0.5, r * 0.02, r * 1.1, r * 0.42, r * 0.2)
    ctx.fillStyle = PAPER
    ctx.fill()
    ctx.restore()
    // 눈
    ctx.beginPath()
    ctx.arc(q(r * 0.42), q(-r * 0.16), Math.max(2, r * 0.13), 0, Math.PI * 2)
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
      const my = f.y - r - 20 + (mark.t === '!!' ? Math.sin(tMs / 90) * 3 : 0)
      const w = mark.t === '!!' ? 40 : 28
      badge(ctx, f.x - w / 2, my - 15, w, 30, mark.c)
      inkText(ctx, mark.t, f.x, my, 20, PAPER)
    }
  },

  drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
    ctx.save()
    for (const p of splashes) {
      ctx.globalAlpha = Math.max(0, p.life / 0.6)
      ctx.beginPath()
      ctx.arc(q(p.x), q(p.y), q(p.r), 0, Math.PI * 2)
      ctx.strokeStyle = PAPER
      ctx.lineWidth = 5
      ctx.stroke()
      inkStroke(ctx, 2)
    }
    ctx.restore()
  },

  drawBobber(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig, tMs: number) {
    const shake = s.phase === 'bite' ? Math.sin(tMs * 0.03) * 5 : Math.sin(tMs / 500) * 1.5
    const bx = q(s.bobber.x)
    const by = q(s.bobber.y + shake)

    // 낚싯줄 — 화면 아래 중앙(앵글러)에서 찌까지. 잉크 선이라 물 위에서도 보인다
    ctx.beginPath()
    ctx.moveTo(cfg.width / 2, cfg.height - 12)
    ctx.lineTo(bx, by)
    inkStroke(ctx, 2)

    const path = () => {
      ctx.beginPath()
      ctx.arc(bx, by, 9, 0, Math.PI * 2)
    }
    hardShadow(ctx, path)
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
    inkStroke(ctx)
  },

  /**
   * 조준 — 좌우 조준선과 착수 가능 범위.
   * 거리는 스윙 최고 속도로 정해져서 미리보기 게이지가 없다(cast.ts 주석 ③) — 대신 "이 선 위
   * 어딘가에 떨어진다"는 범위를 보여줘서 세게/약하게 던지는 감을 잡게 한다.
   */
  drawAim(ctx: CanvasRenderingContext2D, aimX: number, cfg: LoopConfig, tMs: number) {
    const nearY = cfg.height - cfg.landNearMarginPx
    const farY = cfg.waterY + cfg.landFarMarginPx
    const x = q(aimX)

    // 착수 범위 — 뭉툭한 캡슐
    badge(ctx, x - 7, farY, 14, nearY - farY, MINT)

    // 던지는 라인
    ctx.save()
    ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(cfg.width / 2, cfg.height - 12)
    ctx.lineTo(x, nearY)
    inkStroke(ctx, 3)
    ctx.restore()

    // 양 끝 — 위가 멀리, 아래가 가까이
    const pulse = 7 + Math.sin(tMs / 160) * 2
    for (const y of [farY, nearY]) {
      ctx.beginPath()
      ctx.arc(x, q(y), pulse, 0, Math.PI * 2)
      ctx.fillStyle = PAPER
      ctx.fill()
      inkStroke(ctx)
    }
    inkText(ctx, '멀리', x, farY - 22, 16, PAPER)
    inkText(ctx, '가까이', x, nearY + 24, 16, PAPER)
  },

  drawGauges(ctx: CanvasRenderingContext2D, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg
    const w = W - 56
    const x = 28
    const y = H - 44

    if (s.phase === 'fighting') {
      badge(ctx, x, y, w, 26, PAPER)
      // 채움색은 상태색이지 액센트가 아니다 — 감기는 중 mint, DANGER coral
      const fill = s.reeling || s.grace ? MINT : CORAL
      const fw = Math.max(0, Math.min(1, s.progress)) * (w - 8)
      if (fw > 4) {
        chunkyRect(ctx, x + 4, y + 4, fw, 18, 9)
        ctx.fillStyle = fill
        ctx.fill()
      }
    }

    if (s.phase === 'bite') {
      const p = Math.max(0, Math.min(1, s.biteLeftSec / cfg.biteWindowSec))
      badge(ctx, x, y, w, 22, PAPER)
      const fw = p * (w - 8)
      if (fw > 4) {
        chunkyRect(ctx, x + 4, y + 4, fw, 14, 7)
        ctx.fillStyle = YELLOW
        ctx.fill()
      }
    }
  },

  /**
   * 점수는 위, 문구는 아래.
   *
   * 둘을 다 상단에 뒀다가 긴 문구("양손으로 낚싯대를 쥐고 뒤로 젖히세요")가 점수 배지를 침범했다
   * (실측 우측끝 573px > 점수 배지 좌측 518px). 중앙 정렬을 유지하면서 겹침을 피하려면 문구를
   * 20px까지 줄여야 하는데, 2~3m에서 읽혀야 하는 화면에서 그건 거꾸로 가는 선택이다.
   *
   * 하단으로 내리면 전체 폭을 쓸 수 있어 30px이 유지된다. 게이지 위에 놓아 "지금 상태" 영역을
   * 한 곳에 모으는 효과도 있다.
   */
  drawHud(
    ctx: CanvasRenderingContext2D,
    text: string,
    s: LoopState,
    cfg: LoopConfig,
  ) {
    const { width: W, height: H } = cfg

    // 점수 — 오른쪽 위 노란 배지
    const scoreText = `${s.score}`
    ctx.font = `24px ${FONT}`
    const sw = Math.max(58, ctx.measureText(scoreText).width + 34)
    badge(ctx, W - sw - 16, 14, sw, 38, YELLOW)
    inkText(ctx, scoreText, W - sw / 2 - 16, 33, 24, INK)

    if (!text) return

    // 문구 — 게이지 바로 위. 2~3m에서 읽혀야 하는 유일한 요소라 제일 크다
    const px = fitFontPx(ctx, text, W - 60)
    ctx.font = `${px}px ${FONT}`
    const bw = ctx.measureText(text).width + 40
    const bh = px + 22
    const y = H - 56 - bh
    badge(ctx, (W - bw) / 2, y, bw, bh, PAPER)
    inkText(ctx, text, W / 2, y + bh / 2, px, s.phase === 'bite' ? CORAL : INK)
  },
}
