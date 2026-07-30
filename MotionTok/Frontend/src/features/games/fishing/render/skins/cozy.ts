/**
 * 정식 스킨 — 서비스 톤 (S15P11A706-49).
 *
 * 색·테두리·그림자는 전부 `assets/styles/tokens.css`에서 온다. 여기서 새 색을 만들지 않는다 —
 * 게임 화면만 다른 팔레트를 쓰면 방에서 게임을 켰을 때 톤이 튄다.
 *
 * 규칙 다섯 개가 이 파일의 전부다:
 *   ① 잉크 한 색(#38263d)으로 테두리·글자·그림자를 다 쓴다. 순검정으로 바꾸면 값싸진다
 *   ② 그림자는 블러 0 오프셋 — 흐린 그림자를 하나 섞으면 스티커 느낌이 깨진다
 *   ③ 테두리는 도형 크기에 비례. 작은 물고기에 3px을 두르면 테두리가 몸통을 다 먹는다
 *   ④ 그라데이션 금지 — 바다는 평면 색 띠로 깊이를 만든다
 *   ⑤ 파스텔 + 채도 있는 액센트. 네온은 계측 스킨의 것이다
 *
 * ⚠ 글자에 관한 교훈(2026-07-30 지적: "글자가 보이지도 않고 너무 검정색"):
 * 흰 배지 위 글자에 잉크 외곽선을 두르면 안 된다. 픽셀 폰트는 획이 얇아서 외곽선이 글자 속을
 * 메워 검은 덩어리가 된다. **배지 위 글자는 외곽선 없이 채우기만**, 외곽선은 배경 위에 떠 있는
 * 글자에만 얇게 준다.
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
const VIOLET = '#9a72d8'
const SKY = '#cfe8ff'
const LILAC = '#ded2ff'

/** 바다 — 평면 색 띠. 그라데이션 대신 단계로 깊이를 만든다(규칙 ④) */
const SEA_BANDS = ['#6579dd', '#5a6cc9', '#4f5eb4', '#45529f']

const FONT = "'DNF Bit Bit', ui-monospace, monospace"

/** 2px 격자 스냅 — 축 정렬 도형이 격자에 붙어야 픽셀아트로 읽힌다.
 *
 * ponytail: 진짜 픽셀아트는 저해상도(160×120)로 그린 뒤 imageSmoothingEnabled=false로 4배
 * 확대하는 것이다. loop.ts 좌표가 640×480이라 그 방식은 좌표계를 갈아야 해서 스냅으로 근사했다.
 */
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

/** 블러 0 하드 섀도우(규칙 ②) — 같은 도형을 잉크로 옮겨 칠하고 그 위에 본체를 올린다 */
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

/** 문구가 폭에 들어갈 때까지 글자 크기를 줄인다 — 잘리는 것보다 작은 게 낫다 */
function fitFontPx(ctx: CanvasRenderingContext2D, text: string, maxW: number, start: number) {
  let px = start
  while (px > 14) {
    ctx.font = `${px}px ${FONT}`
    if (ctx.measureText(text).width <= maxW) break
    px -= 2
  }
  return px
}

/** 알약 배지 */
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
  return 12 + (spec.score / MAX_SCORE) * 16
}

export const cozySkin: FishingSkin = {
  id: 'cozy',
  label: '정식',

  drawBackground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView) {
    const { width: W, height: H, waterY } = cfg
    const t = view.tMs

    // 하늘 — 평면 한 색
    ctx.fillStyle = SKY
    ctx.fillRect(0, 0, W, waterY)

    /*
     * 원경 섬 — 수평선에 걸린 실루엣.
     *
     * 평면 색 두 덩이(하늘/바다)만 있으면 "칠해놓은 판"으로 보인다. 수평선에 뭐라도 하나
     * 걸리면 깊이가 생긴다. 라일락은 파스텔 중 가장 뒤로 물러나 보이는 색이다.
     */
    ctx.fillStyle = LILAC
    for (const [cx, w, h] of [
      [110, 120, 26],
      [430, 170, 34],
    ] as const) {
      ctx.beginPath()
      ctx.moveTo(q(cx - w / 2), q(waterY))
      ctx.quadraticCurveTo(q(cx - w * 0.2), q(waterY - h), q(cx), q(waterY - h * 0.82))
      ctx.quadraticCurveTo(q(cx + w * 0.28), q(waterY - h * 1.1), q(cx + w / 2), q(waterY))
      ctx.closePath()
      ctx.fill()
      inkStroke(ctx, 2)
    }

    // 구름 — 천천히 흐른다. 배경이 완전히 정지해 있으면 화면이 죽어 보인다
    for (let i = 0; i < 3; i++) {
      const cx = (((t / 1000) * (5 + i * 3) + i * 250) % (W + 200)) - 100
      const cy = 22 + i * 24
      const s = 0.85 + i * 0.2
      // 세 덩이를 겹쳐 구름 실루엣을 만든다 — 사각형 하나는 구름으로 안 읽힌다
      ctx.beginPath()
      ctx.arc(q(cx), q(cy), q(13 * s), Math.PI, 0)
      ctx.arc(q(cx + 16 * s), q(cy - 5 * s), q(17 * s), Math.PI, 0)
      ctx.arc(q(cx + 36 * s), q(cy), q(12 * s), Math.PI, 0)
      ctx.lineTo(q(cx - 13 * s), q(cy))
      ctx.closePath()
      ctx.fillStyle = PAPER
      ctx.fill()
      inkStroke(ctx, 2)
    }

    // 바다 — 평면 띠 4단. 아래로 갈수록 어둡다(= 깊다)
    const bandH = (H - waterY) / SEA_BANDS.length
    SEA_BANDS.forEach((c, i) => {
      ctx.fillStyle = c
      ctx.fillRect(0, Math.floor(waterY + bandH * i), W, Math.ceil(bandH) + 1)
    })

    // 캠 — 물 위에 반투명(기획 §게임 화면 구성: 내 캠은 반투명).
    // 계측 스킨보다 옅게 깐다. 여기서 내 몸은 판정 근거가 아니라 분위기다.
    const video = view.video
    if (video && video.readyState >= 2) {
      ctx.save()
      ctx.globalAlpha = 0.1
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, W, H)
      ctx.restore()
    }

    // 물결 — 각 띠 경계에 얕은 결. 평면 띠의 경계선이 자를 대고 그은 선처럼 보이지 않게 한다
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = PAPER
    ctx.lineWidth = 3
    for (let i = 1; i < SEA_BANDS.length; i++) {
      const by = waterY + bandH * i
      ctx.beginPath()
      for (let x = -20; x < W + 20; x += 40) {
        const off = Math.sin(t / 900 + i * 1.3 + x / 90) * 3
        ctx.moveTo(q(x), q(by + off))
        ctx.lineTo(q(x + 22), q(by + off))
      }
      ctx.stroke()
    }
    ctx.restore()

    // 수면 — 잉크 굵은 선 + 물거품
    ctx.beginPath()
    ctx.moveTo(0, q(waterY))
    ctx.lineTo(W, q(waterY))
    inkStroke(ctx, 4)
    ctx.fillStyle = PAPER
    for (let x = 0; x < W; x += 26) {
      const bob = Math.sin(t / 420 + x / 40) * 2
      ctx.fillRect(q(x + 4), q(waterY + 6 + bob), 13, 3)
    }
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
    // 규칙 ③ — 작은 물고기에 굵은 테두리를 두르면 테두리가 몸통을 다 먹는다
    const sw = r > 20 ? 3 : 2

    ctx.save()
    ctx.translate(q(f.x), q(f.y))
    if (f.dir < 0) ctx.scale(-1, 1)

    // 꼬리 — 지느러미가 흔들린다
    const flap = Math.sin(tMs / 150 + f.id) * 0.22
    ctx.save()
    ctx.translate(-r * 0.78, 0)
    ctx.rotate(flap)
    ctx.beginPath()
    ctx.moveTo(2, 0)
    ctx.lineTo(q(-r * 0.8), q(-r * 0.62))
    ctx.lineTo(q(-r * 0.55), 0)
    ctx.lineTo(q(-r * 0.8), q(r * 0.62))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)
    ctx.restore()

    // 등지느러미
    ctx.beginPath()
    ctx.moveTo(q(-r * 0.3), q(-r * 0.55))
    ctx.lineTo(q(-r * 0.05), q(-r * 0.95))
    ctx.lineTo(q(r * 0.3), q(-r * 0.5))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)

    // 몸통
    roundRectPath(ctx, -r * 0.85, -r * 0.58, r * 1.75, r * 1.16, r * 0.46)
    ctx.fillStyle = color
    ctx.fill()
    inkStroke(ctx, sw)

    // 배 — 밝은 면 하나로 입체감. 음영 그라데이션 대신이다
    ctx.save()
    ctx.globalAlpha = 0.55
    roundRectPath(ctx, -r * 0.45, r * 0.04, r * 1.05, r * 0.4, r * 0.2)
    ctx.fillStyle = PAPER
    ctx.fill()
    ctx.restore()

    // 눈 — 흰자 + 잉크 동자. 점 하나보다 훨씬 살아 보인다
    ctx.beginPath()
    ctx.arc(q(r * 0.44), q(-r * 0.16), Math.max(3, r * 0.19), 0, Math.PI * 2)
    ctx.fillStyle = PAPER
    ctx.fill()
    inkStroke(ctx, 1.5)
    ctx.beginPath()
    ctx.arc(q(r * 0.5), q(-r * 0.16), Math.max(1.5, r * 0.09), 0, Math.PI * 2)
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
   * 물튀김 — 링 + 물방울.
   *
   * 링 하나만 퍼지는 건 "튀었다"로 안 읽힌다(2026-07-30 지적: "물튀김이 없다"). 물방울을
   * 같이 날리면 착수·포획 순간이 눈에 걸린다. 물방울 위치는 링의 상태(r·life)에서 계산해
   * 별도 상태를 늘리지 않았다 — 링이 커질수록 방울이 밖으로 나가고 아래로 떨어진다.
   */
  drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
    const DROPS = 7
    ctx.save()
    for (const p of splashes) {
      const life = Math.max(0, p.life / 0.6)
      const age = 1 - life

      // 퍼지는 링
      ctx.globalAlpha = life
      ctx.beginPath()
      ctx.arc(q(p.x), q(p.y), q(p.r), 0, Math.PI * 2)
      ctx.strokeStyle = PAPER
      ctx.lineWidth = 5
      ctx.stroke()
      inkStroke(ctx, 2)

      // 물방울 — 위로 솟았다가 중력으로 떨어진다
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
    // 입질 중에는 크게 떨고, 평소엔 물결에 얹혀 조금 흔들린다
    const shake = s.phase === 'bite' ? Math.sin(tMs * 0.032) * 6 : Math.sin(tMs / 480) * 2
    const bx = q(s.bobber.x)
    const by = q(s.bobber.y + shake)

    // 낚싯줄 — 화면 아래 중앙(앵글러)에서 찌까지. 잉크 선이라 물 위에서도 보인다
    ctx.beginPath()
    ctx.moveTo(cfg.width / 2, cfg.height - 12)
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

  /**
   * 조준 — 좌우 조준선과 착수 가능 범위.
   * 거리는 스윙 최고 속도로 정해져서 미리보기 게이지가 없다(cast.ts 주석 ③) — 대신 "이 선 위
   * 어딘가에 떨어진다"는 범위를 보여줘서 세게/약하게 던지는 감을 잡게 한다.
   */
  drawAim(ctx: CanvasRenderingContext2D, aimX: number, cfg: LoopConfig, tMs: number) {
    const nearY = cfg.height - cfg.landNearMarginPx
    const farY = cfg.waterY + cfg.landFarMarginPx
    const x = q(aimX)

    // 착수 범위 — 얇은 캡슐. 굵으면 물을 다 가린다
    badge(ctx, x - 5, farY, 10, nearY - farY, MINT, 2)

    // 던지는 라인
    ctx.save()
    ctx.setLineDash([9, 9])
    ctx.beginPath()
    ctx.moveTo(cfg.width / 2, cfg.height - 12)
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
    const w = W - 56
    const x = 28
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
   * 점수는 위, 문구는 아래 — 그리고 문구는 작게.
   *
   * 30px 배지가 화면 폭의 84%를 덮어 물을 가렸다(2026-07-30 지적: "글자가 화면을 너무 가려").
   * 22px로 줄이고 폭 상한을 걸면 절반 이하로 내려간다. 페이즈별로 배지 색을 바꿔서, 크기를
   * 줄인 만큼 색으로 눈에 걸리게 했다 — 입질은 coral, 포획은 yellow.
   */
  drawHud(ctx: CanvasRenderingContext2D, text: string, s: LoopState, cfg: LoopConfig) {
    const { width: W, height: H } = cfg

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

    const px = fitFontPx(ctx, text, W - 200, 22)
    ctx.font = `${px}px ${FONT}`
    const bw = ctx.measureText(text).width + 32
    const bh = px + 16
    const y = H - 50 - bh
    badge(ctx, (W - bw) / 2, y, bw, bh, fill)
    badgeText(ctx, text, W / 2, y + bh / 2 + 1, px, ink)
  },
}
