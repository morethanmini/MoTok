/**
 * 별따라 손따라 판정·점수 로직 (순수 함수 — 캔버스/DOM 의존 없음).
 *
 * 규칙: 열 손가락 중 아무 손가락이든 목표 별 반경 안에 들어오면 그 별이 켜진다.
 * 손가락-별은 가까운 순 그리디 1:1 매칭. 모든 별을 동시에 켠 채 홀드 시간을 채우면 성공,
 * 성공 시점 손가락 위치들의 "점 사이 거리 비율"이 원본 별자리와 비슷할수록 고득점.
 */

export interface Point {
  x: number
  y: number
}

export type SlotKey = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

/** 감지된 손가락 끝 좌표(px). 없는 손/손가락은 키 자체가 없다. */
export type FingerSlots = Partial<Record<SlotKey, Point>>

/** MediaPipe 랜드마크의 최소 구조 (라이브러리 타입에 직접 의존하지 않음) */
export interface NormalizedPoint {
  x: number
  y: number
}
export interface HandednessCategory {
  categoryName: string
}

/** 손가락 끝 landmark 인덱스: 엄지, 검지, 중지, 약지, 새끼 */
export const FINGER_TIPS = [4, 8, 12, 16, 20] as const
export const SLOT_ORDER: SlotKey[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'L1', 'L2', 'L3', 'L4', 'L5']

/** 별자리 크기 대비 히트 판정 반경 비율 */
export const HIT_RADIUS_RATIO = 0.08
/** 이 평균 비율 오차면 0점이 되는 스케일 */
export const RATIO_ERR_SCALE = 0.22
/** 별자리 전체 크기 — 화면 짧은 변 기준 비율 */
export const CONSTELLATION_SCALE = 0.58

/**
 * MediaPipe 결과 → 손가락 슬롯(R1~R5, L1~L5) px 좌표 맵.
 * mirror=true면 x를 뒤집는다 — 셀프 뷰가 scaleX(-1) 미러링으로 표시되므로
 * 화면에 보이는 손 위치와 캔버스 좌표를 일치시키기 위함.
 */
export function collectFingerSlots(
  landmarksList: NormalizedPoint[][],
  handednessList: HandednessCategory[][],
  width: number,
  height: number,
  mirror = true,
): FingerSlots {
  const slots: FingerSlots = {}
  landmarksList.forEach((lm, idx) => {
    const cat = handednessList[idx]?.[0]?.categoryName
    const prefix = cat === 'Right' ? 'R' : cat === 'Left' ? 'L' : null
    if (!prefix) return
    FINGER_TIPS.forEach((tipIdx, fi) => {
      const key = (prefix + (fi + 1)) as SlotKey
      if (key in slots) return
      const p = lm[tipIdx]
      if (!p) return
      slots[key] = { x: (mirror ? 1 - p.x : p.x) * width, y: p.y * height }
    })
  })
  return slots
}

/** 0~1 정규화 별자리 좌표 → 화면 중앙 배치된 px 좌표 */
export function layoutConstellation(
  pts: [number, number][],
  width: number,
  height: number,
  scale = CONSTELLATION_SCALE,
): Point[] {
  const size = Math.min(width, height) * scale
  return pts.map(([x, y]) => ({
    x: width * 0.5 + (x - 0.5) * size,
    y: height * 0.5 + (y - 0.5) * size,
  }))
}

export interface MatchResult {
  /** 별 인덱스별 켜짐 여부 */
  activeMask: boolean[]
  /** 별 인덱스별 매칭된 손가락 좌표 (없으면 null) */
  positions: (Point | null)[]
  /** 매칭에 사용된 손가락 슬롯 키 */
  matchedSlots: Set<SlotKey>
}

/**
 * 손가락-별 그리디 매칭: 반경(hitRadiusPx) 안의 (손가락, 별) 쌍을 거리 오름차순으로
 * 1:1 배정한다 (손가락도 별도 한 번씩만 사용).
 */
export function matchFingersToTargets(
  slots: FingerSlots,
  targetPts: Point[],
  hitRadiusPx: number,
): MatchResult {
  const n = targetPts.length
  const candidates: { slotKey: SlotKey; i: number; dist: number }[] = []
  for (const slotKey of SLOT_ORDER) {
    const fp = slots[slotKey]
    if (!fp) continue
    for (let i = 0; i < n; i++) {
      const tp = targetPts[i]!
      const dist = Math.hypot(fp.x - tp.x, fp.y - tp.y)
      if (dist < hitRadiusPx) candidates.push({ slotKey, i, dist })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)

  const matchedSlots = new Set<SlotKey>()
  const usedTargets = new Set<number>()
  const activeMask = Array.from({ length: n }, () => false)
  const positions = Array.from({ length: n }, (): Point | null => null)
  for (const c of candidates) {
    if (matchedSlots.has(c.slotKey) || usedTargets.has(c.i)) continue
    matchedSlots.add(c.slotKey)
    usedTargets.add(c.i)
    activeMask[c.i] = true
    positions[c.i] = slots[c.slotKey]!
  }
  return { activeMask, positions, matchedSlots }
}

/**
 * 완성 시점 손가락 위치의 "인접 점 간 거리 비율"이 원본과 얼마나 비슷한지로 0~100점.
 * 전체 크기·위치와 무관하게 모양의 비례만 본다.
 */
export function computeRatioScore(targetPts: Point[], hitPts: Point[]): number {
  const n = targetPts.length
  if (n < 2 || hitPts.length !== n) return 0
  const dists = (pts: Point[]) => {
    const out: number[] = []
    for (let i = 1; i < n; i++) {
      const a = pts[i]!
      const b = pts[i - 1]!
      out.push(Math.hypot(a.x - b.x, a.y - b.y))
    }
    return out
  }
  const ratios = (ds: number[]) => {
    const total = ds.reduce((a, b) => a + b, 0) || 1
    return ds.map((d) => d / total)
  }
  const tr = ratios(dists(targetPts))
  const hr = ratios(dists(hitPts))
  let err = 0
  for (let i = 0; i < tr.length; i++) err += Math.abs(tr[i]! - hr[i]!)
  const avgErr = err / tr.length
  return Math.max(0, Math.min(100, Math.round(100 * (1 - avgErr / RATIO_ERR_SCALE))))
}

/** 미완성 라운드의 부분 점수 (최대 동시 점등 수 기준, 최대 40점) */
export function partialScore(bestCount: number, totalStars: number): number {
  if (totalStars <= 0) return 0
  return Math.round((bestCount / totalStars) * 40)
}

export function scoreTier(score: number): string {
  if (score >= 90) return '🌟 완벽한 별자리!'
  if (score >= 70) return '✨ 훌륭해요!'
  if (score >= 40) return '🙂 괜찮아요'
  return '💫 다시 도전해보세요'
}
