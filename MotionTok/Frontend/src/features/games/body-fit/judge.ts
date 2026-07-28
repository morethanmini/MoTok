/**
 * 게임④ 판정기 (기획 §7, UI 스펙 §2) — 128×128 오프스크린 픽셀 카운트.
 *
 * 기준선이 두 개다 (§7-1):
 *  - 통과 판정: 구멍(마진 포함) 밖으로 삐져나온 픽셀 비율 → 낭떠러지 여부
 *  - 등급 점수: 원본 실루엣(마진 없음)과의 IoU → 얼마나 잘했는가
 *
 * 구멍 마진 M은 상수가 아니라, "구멍 면적 = 원본 면적 × K"가 되도록
 * 라운드마다 이분 탐색으로 자동 산출한다 (§2-3). 난이도 노브는 K 하나.
 *
 * 픽셀 비교 함수들은 순수 함수로 분리 — jsdom(캔버스 없음)에서도 테스트된다.
 */
import type { BodyFitConfig } from './config'
import type { SegmentKey } from './avatarRig'
import { OVERFLOW_SEGMENTS, drawSilhouette } from './silhouette'
import type { SolvedSkeleton } from './skeleton'

export type Grade = 'PERFECT' | 'GREAT' | 'PASS' | 'FAIL'

export interface RoundJudgment {
  /** 내 실루엣 중 구멍 밖 픽셀 비율 (0~1) */
  outsideRatio: number
  passed: boolean
  /** 원본 실루엣과의 IoU × 100 */
  iou: number
  grade: Grade
  /** 구멍 밖으로 삐져나온 세그먼트 — 빨강 표시 대상 (§7-4) */
  overflow: SegmentKey[]
}

// ── 순수 함수 (테스트 대상) ──────────────────────────────

/** RGBA 버퍼에서 알파 > 127 픽셀 수 */
export function countMask(data: Uint8ClampedArray): number {
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 127) n++
  return n
}

/** a에는 있고 b에는 없는 픽셀 수 (a & !b) */
export function countOutside(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0
  for (let i = 3; i < a.length; i += 4) if (a[i]! > 127 && b[i]! <= 127) n++
  return n
}

/** IoU × 100 (둘 다 빈 마스크면 0) */
export function iouOf(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let inter = 0
  let union = 0
  for (let i = 3; i < a.length; i += 4) {
    const inA = a[i]! > 127
    const inB = b[i]! > 127
    if (inA && inB) inter++
    if (inA || inB) union++
  }
  return union === 0 ? 0 : (inter / union) * 100
}

/** 등급별 기본 점수 — 통과한 라운드에 준다. */
export const GRADE_POINTS: Record<Grade, number> = { PERFECT: 100, GREAT: 85, PASS: 70, FAIL: 0 }
/**
 * 실패해도 받을 수 있는 점수 상한.
 *
 * <p><b>PASS(70)보다 반드시 낮아야 한다.</b> 두 가지 이유가 있다:
 * ① 실패가 통과보다 이득이면 안 된다. ② 관전 화면·스코어보드가 서버에서 돌아온 점수를
 * GRADE_POINTS와 <i>정확히 비교</i>해 등급 배지를 역산한다(점수가 곧 등급 인코딩) —
 * 실패 점수가 70·85·100과 겹치면 FAIL이 PASS 배지로 표시된다.</p>
 */
export const FAIL_MAX_SCORE = 50

/**
 * 라운드 판정 → 점수. 실패해도 일치율에 비례해 부분 점수를 준다(실기 피드백: 0점은 허무하다).
 *
 * <p>0점 경로가 둘이라 `passed`가 아니라 `grade`로 가른다 — 구멍 밖으로 삐져나온 경우와,
 * 삐져나오진 않았지만 모양이 너무 안 맞아 등급이 FAIL인 경우 모두 여기로 온다.</p>
 */
export function scoreFor(j: RoundJudgment): number {
  return j.grade === 'FAIL'
    ? Math.round((Math.min(100, Math.max(0, j.iou)) / 100) * FAIL_MAX_SCORE)
    : GRADE_POINTS[j.grade]
}

export function gradeOf(iou: number, cfg: BodyFitConfig): Grade {
  const g = cfg.judge.grade
  if (iou >= g.perfect) return 'PERFECT'
  if (iou >= g.great) return 'GREAT'
  if (iou >= g.pass) return 'PASS'
  return 'FAIL'
}

/**
 * 면적이 목표에 닿는 마진 M을 이분 탐색으로 찾는다 (§2-3).
 * measure는 M에 대해 단조 증가(마진↑ → 면적↑)라는 전제.
 */
export function findMarginForArea(
  measure: (margin: number) => number,
  targetArea: number,
  maxMargin = 0.6,
  iterations = 7,
): number {
  let lo = 0
  let hi = maxMargin
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    if (measure(mid) < targetArea) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ── 캔버스 오케스트레이션 (브라우저 전용) ─────────────────

function rasterize(
  solved: SolvedSkeleton,
  cfg: BodyFitConfig,
  margin: number,
  segments?: readonly SegmentKey[],
): Uint8ClampedArray {
  const size = cfg.judge.maskSize
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  drawSilhouette(ctx, solved, cfg, margin, segments)
  return ctx.getImageData(0, 0, size, size).data
}

/** 출제 포즈로부터 구멍 마진 M을 산출 — 구멍 면적 = 원본 면적 × K */
export function holeMarginFor(setter: SolvedSkeleton, cfg: BodyFitConfig): number {
  const originalArea = countMask(rasterize(setter, cfg, 0))
  return findMarginForArea(
    (m) => countMask(rasterize(setter, cfg, m)),
    originalArea * cfg.judge.K,
  )
}

/**
 * 출제 포즈의 체감 난이도 (0~1) — 출제자 관전 화면의 별점 표시용.
 *
 * <p>점수·판정에는 쓰지 않는다(그건 K와 IoU가 정한다). 순수 표시용 휴리스틱이라
 * 캔버스가 필요 없고 세 항으로만 잰다:
 *  - 팔을 아래(중립)에서 얼마나 들었나 — 만세가 차렷보다 어렵다
 *  - 팔꿈치를 얼마나 접었나 — 각도 재현이 직선보다 어렵다
 *  - 좌우가 얼마나 다른가 — 대칭 포즈는 거울로 따라하기 쉽다
 * 다리는 앵커로 고정돼 난이도에 기여하지 않으므로 제외한다.</p>
 */
export function poseDifficulty(s: SolvedSkeleton): number {
  /** a→b 방향이 "아래"(0,-1)에서 벌어진 각 — 0(아래) ~ π(위) */
  const liftOf = (from: { x: number; y: number }, to: { x: number; y: number } | null) => {
    if (!to) return 0
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    return len < 1e-6 ? 0 : Math.acos(Math.min(1, Math.max(-1, -dy / len)))
  }
  /** 팔꿈치 굽힘 — 위팔 방향에서 아래팔이 꺾인 각. 0(쭉 뻗음) ~ π(완전히 접음) */
  const bendOf = (
    shoulder: { x: number; y: number },
    elbow: { x: number; y: number } | null,
    wrist: { x: number; y: number } | null,
  ) => {
    if (!elbow || !wrist) return 0
    const ux = elbow.x - shoulder.x
    const uy = elbow.y - shoulder.y
    const fx = wrist.x - elbow.x
    const fy = wrist.y - elbow.y
    const un = Math.hypot(ux, uy)
    const fn = Math.hypot(fx, fy)
    if (un < 1e-6 || fn < 1e-6) return 0
    const cos = (ux * fx + uy * fy) / (un * fn)
    return Math.acos(Math.min(1, Math.max(-1, cos)))
  }

  const liftL = liftOf(s.shoulderL, s.elbowL)
  const liftR = liftOf(s.shoulderR, s.elbowR)
  const bendL = bendOf(s.shoulderL, s.elbowL, s.wristL)
  const bendR = bendOf(s.shoulderR, s.elbowR, s.wristR)

  const lift = (liftL + liftR) / 2 / Math.PI
  const bend = (bendL + bendR) / 2 / Math.PI
  const asym = Math.abs(liftL - liftR) / Math.PI
  return Math.min(1, lift * 0.45 + bend * 0.35 + asym * 0.2)
}

/** 벽 도달 순간의 프레임 1장 판정 (§4) */
export function judgeRound(
  player: SolvedSkeleton,
  setter: SolvedSkeleton,
  holeMargin: number,
  cfg: BodyFitConfig,
): RoundJudgment {
  const playerMask = rasterize(player, cfg, 0)
  const holeMask = rasterize(setter, cfg, holeMargin)
  const originalMask = rasterize(setter, cfg, 0)

  const playerArea = countMask(playerMask)
  const outsideRatio = playerArea === 0 ? 1 : countOutside(playerMask, holeMask) / playerArea
  const passed = outsideRatio <= cfg.judge.overflowTolerance

  const iou = iouOf(playerMask, originalMask)
  // 통과 실패면 등급도 FAIL — 떨어졌는데 GREAT가 뜨면 판정을 불신한다
  const grade: Grade = passed ? gradeOf(iou, cfg) : 'FAIL'

  const overflow: SegmentKey[] = []
  for (const key of OVERFLOW_SEGMENTS) {
    const segMask = rasterize(player, cfg, 0, [key])
    const segArea = countMask(segMask)
    if (segArea === 0) continue
    if (countOutside(segMask, holeMask) / segArea > cfg.judge.overflowTolerance)
      overflow.push(key)
  }

  return { outsideRatio, passed, iou, grade, overflow }
}
