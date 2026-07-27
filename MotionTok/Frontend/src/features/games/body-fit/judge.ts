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
