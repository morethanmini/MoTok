/**
 * 온셋(소리가 새로 나는 순간) 검출 — 채보 초안의 후보 시각을 만든다.
 *
 * **스트림 분리 검출**(보컬온셋-개선제안.md): 결합 노벨티 하나에서 피크를 찍으면
 * 킥(수 ms 트랜지언트, 큰 플럭스)이 보컬(50~100ms 완만한 어택, 작은 플럭스)을
 * 4중으로 억누른다 — ①결합 곡선에서 크기 경쟁 ②±50ms 국소 최대 억제
 * ③드럼이 키운 σ 임계 ④선형 플럭스의 절대 크기 비례. 가중치 튜닝으로는 못 고친다.
 *
 * 그래서 두 스트림을 **각자 자기 통계·자기 임계로 독립 검출**한 뒤 라벨 붙여 병합한다:
 * - perc: 기존 결합 노벨티(저역 가중) — 박자 뼈대. 템포 추정도 이 곡선을 그대로 쓴다
 *   (보컬은 박자보다 밀고 당기는 소리라 템포에 넣으면 172 사건류가 재발한다)
 * - melody: 멜로디 대역 로그 플럭스(features.fluxMelody) — 보컬·리드 멜로디
 *
 * 병합 규칙: ±25ms 안의 완전 동시 피크는 **같은 소리가 두 스트림에 새어 들어온 것**
 * (킥의 중역 어택도 멜로디 플럭스에 찍힌다)이라 perc 하나로 합친다. 그보다 떨어진
 * melody 온셋은 지우지 않는다 — 킥 30ms 옆의 보컬은 노이즈가 아니라 양손 동시 노트 재료다.
 */

import type { Band, FrameFeatures } from './features'
import { subtractMovingAverage } from './features'

/** 어느 검출 스트림에서 나왔나 — 채보 생성기의 밀도·배치 1차 분기 기준 */
export type OnsetSource = 'perc' | 'melody'

export interface Onset {
  /** 파일 내 시각 */
  timeMs: number
  /** 노벨티 세기. 1.0 = **자기 스트림** 온셋 평균 (perc 쪽은 songAccents의 100과 같은 기준) */
  strength: number
  /**
   * 이 온셋의 **원시 플럭스 비율**(합 = 1) — 킥/멜로디 구분에 쓴다.
   * 결합 노벨티처럼 대역 평균으로 정규화하면 조용한 대역의 누설이 증폭되어
   * "순수 저역 킥의 mid 기여가 low보다 크다" 같은 왜곡이 난다 — 비율은 원시값으로 본다.
   */
  bands: Record<Band, number>
  source: OnsetSource
}

/** perc 스트림: 국소 최대 반경 — 이보다 가까운 이중 검출은 큰 쪽만 남는다 */
const PERC_PEAK_RADIUS_MS = 50
const PERC_THRESH_K = 1.2
/** melody 스트림: 보컬은 16분 연타가 드물다 — 넓혀서 비브라토 잔떨림을 누르고, 문턱은 낮춘다 */
const MELODY_PEAK_RADIUS_MS = 80
const MELODY_THRESH_K = 1.0
/** 적응 임계의 국소 창 */
const THRESH_WINDOW_MS = 2000
/** 두 스트림 피크가 이 안이면 같은 소리 — perc 하나로 합친다 */
const STREAM_MERGE_MS = 25

/** 결합 노벨티 대역 가중 — 저역(킥)이 박자 정보를 제일 많이 갖는다 */
const BAND_WEIGHT: Record<Band, number> = { low: 1.4, mid: 1.0, high: 0.6 }

export interface OnsetAnalysis {
  /** perc + melody 병합, 시각 순 */
  onsets: Onset[]
  /** 결합(perc) 노벨티 곡선(프레임당 1값) — 템포 추정·악센트 표가 그대로 쓴다 */
  novelty: Float32Array
  frameMs: number
}

interface PeakOptions {
  peakRadiusMs: number
  threshK: number
  /** 절대 하한 — 국소 적응 임계가 조용한 구간에서 티끌(스펙트럼 누설 비팅)까지 통과시키는 것을 막는다 */
  floor?: number
}

/**
 * 노벨티 곡선 → 피크 프레임 목록.
 * 임계는 절대값이 아니라 **국소 적응형**(주변 창의 평균 + k×표준편차) — 곡 안에서
 * 조용한 구간과 시끄러운 구간의 온셋을 같은 기준으로 잡기 위해서다.
 */
export function pickPeaks(
  novelty: Float32Array,
  frameMs: number,
  opts: PeakOptions,
): number[] {
  const frameCount = novelty.length
  // 누적합으로 창 평균·분산을 O(n)에
  const half = Math.max(1, Math.round(THRESH_WINDOW_MS / frameMs / 2))
  const p1 = new Float64Array(frameCount + 1)
  const p2 = new Float64Array(frameCount + 1)
  for (let i = 0; i < frameCount; i++) {
    p1[i + 1] = p1[i]! + novelty[i]!
    p2[i + 1] = p2[i]! + novelty[i]! * novelty[i]!
  }
  const threshold = (i: number): number => {
    const a = Math.max(0, i - half)
    const b = Math.min(frameCount - 1, i + half)
    const n = b - a + 1
    const mean = (p1[b + 1]! - p1[a]!) / n
    const varr = Math.max(0, (p2[b + 1]! - p2[a]!) / n - mean * mean)
    return mean + opts.threshK * Math.sqrt(varr)
  }

  const peakRadius = Math.max(1, Math.round(opts.peakRadiusMs / frameMs))
  const floor = opts.floor ?? 0
  const rawPeaks: number[] = []
  for (let i = 1; i < frameCount - 1; i++) {
    const v = novelty[i]!
    if (v <= floor || v < threshold(i)) continue
    let isMax = true
    for (let j = Math.max(0, i - peakRadius); j <= Math.min(frameCount - 1, i + peakRadius); j++) {
      if (novelty[j]! > v) {
        isMax = false
        break
      }
    }
    if (isMax) rawPeaks.push(i)
  }
  // 국소 최대 창이 겹치면 같은 피크가 이웃 프레임에서 중복으로 잡힌다(동률) — 첫 것만 남긴다
  return rawPeaks.filter((f, idx) => idx === 0 || f - rawPeaks[idx - 1]! > peakRadius)
}

export function detectOnsets(features: FrameFeatures): OnsetAnalysis {
  const { frameMs, frameCount, flux } = features

  // 대역별 노벨티 — 대역마다 스케일이 달라서 각자 평균으로 정규화한 뒤 가중합한다
  const bandNovelty: Record<Band, Float32Array> = {
    low: subtractMovingAverage(flux.low, frameMs),
    mid: subtractMovingAverage(flux.mid, frameMs),
    high: subtractMovingAverage(flux.high, frameMs),
  }
  const bandScale: Record<Band, number> = { low: 0, mid: 0, high: 0 }
  for (const band of ['low', 'mid', 'high'] as const) {
    let sum = 0
    let n = 0
    const arr = bandNovelty[band]
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]! > 0) {
        sum += arr[i]!
        n++
      }
    }
    bandScale[band] = n > 0 ? sum / n : 1 // 0이 안 되게 — 무음 대역은 기여도 0이 된다
  }

  const novelty = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    let v = 0
    for (const band of ['low', 'mid', 'high'] as const) {
      if (bandScale[band] > 0) v += (bandNovelty[band][i]! / bandScale[band]) * BAND_WEIGHT[band]
    }
    novelty[i] = v
  }

  // ── 스트림별 독립 검출 ──
  const percPeaks = pickPeaks(novelty, frameMs, {
    peakRadiusMs: PERC_PEAK_RADIUS_MS,
    threshK: PERC_THRESH_K,
  })
  const melodyNovelty = subtractMovingAverage(features.fluxMelody, frameMs)
  // 절대 하한의 기준은 **마스킹 전** 곡선의 σ여야 한다 — 마스킹은 큰 어택(타악이 채간
  // 순간)을 지우므로, 지운 뒤 곡선으로 σ를 재면 잔여 미세 요동만 남아 σ가 붕괴하고
  // 0.06짜리 티끌(지속 정상파의 수치 요동)이 "유의미한 피크"로 살아난다(합성 톤 실측).
  let m1 = 0
  let m2 = 0
  for (let i = 0; i < frameCount; i++) {
    m1 += melodyNovelty[i]!
    m2 += melodyNovelty[i]! * melodyNovelty[i]!
  }
  const mMean = m1 / frameCount
  const mStd = Math.sqrt(Math.max(0, m2 / frameCount - mMean * mMean))

  // 타악 순간을 멜로디 곡선에서 지운다 — 킥의 중역 어택도 멜로디 플럭스에 크게 찍혀서,
  // 남겨 두면 그 스파이크들이 적응 임계의 σ를 지배해 진짜 보컬 피크가 임계를 못 넘는다.
  // 시간 거리 μ와 타악 잔향이 겹쳐 피크 뒤 ~80ms까지 가짜 상승이 남으므로(합성 킥 실측)
  // 꼬리를 길게 지운다 — 이 안의 진짜 보컬은 어차피 타악 노트가 대표한다.
  {
    const r = Math.max(1, Math.round(STREAM_MERGE_MS / frameMs))
    const tail = r + Math.round(80 / frameMs)
    for (const p of percPeaks) {
      for (let f = Math.max(0, p - r); f <= Math.min(frameCount - 1, p + tail); f++) {
        melodyNovelty[f] = 0
      }
    }
  }
  const melodyPeaksAll = pickPeaks(melodyNovelty, frameMs, {
    peakRadiusMs: MELODY_PEAK_RADIUS_MS,
    threshK: MELODY_THRESH_K,
    floor: 0.25 * mStd,
  })
  // 완전 동시(±25ms)는 같은 소리 — perc가 대표한다. percPeaks는 정렬돼 있어 이진 탐색.
  const mergeRadius = STREAM_MERGE_MS / frameMs
  const nearPerc = (f: number): boolean => {
    let lo = 0
    let hi = percPeaks.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const p = percPeaks[mid]!
      if (Math.abs(p - f) <= mergeRadius) return true
      if (p < f) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }
  const melodyPeaks = melodyPeaksAll.filter((f) => !nearPerc(f))

  // strength 기준: 1.0 = **자기 스트림** 피크 평균 — 스트림끼리 크기 경쟁을 시키지 않는다
  const meanOf = (peaks: number[], curve: Float32Array): number =>
    peaks.length > 0 ? peaks.reduce((s, f) => s + curve[f]!, 0) / peaks.length : 1

  const percMean = meanOf(percPeaks, novelty)
  const melodyMean = meanOf(melodyPeaks, melodyNovelty)

  const bandsAt = (f: number): Record<Band, number> => {
    // 피크 프레임 하나만 보면 어택이 대역마다 반 프레임씩 어긋나 흔들린다 — ±1프레임을 합쳐 본다
    const around = (arr: Float32Array): number => {
      let s = 0
      for (let j = Math.max(0, f - 1); j <= Math.min(frameCount - 1, f + 1); j++) s += arr[j]!
      return s
    }
    const rawLow = around(bandNovelty.low)
    const rawMid = around(bandNovelty.mid)
    const rawHigh = around(bandNovelty.high)
    const rawSum = rawLow + rawMid + rawHigh
    return rawSum > 0
      ? { low: rawLow / rawSum, mid: rawMid / rawSum, high: rawHigh / rawSum }
      : { low: 1 / 3, mid: 1 / 3, high: 1 / 3 }
  }

  const onsets: Onset[] = [
    ...percPeaks.map((f) => ({
      timeMs: features.timeOfFrame(f),
      strength: novelty[f]! / percMean,
      bands: bandsAt(f),
      source: 'perc' as const,
    })),
    ...melodyPeaks.map((f) => ({
      timeMs: features.timeOfFrame(f),
      strength: melodyNovelty[f]! / melodyMean,
      bands: bandsAt(f),
      source: 'melody' as const,
    })),
  ].sort((a, b) => a.timeMs - b.timeMs)

  return { onsets, novelty, frameMs }
}
