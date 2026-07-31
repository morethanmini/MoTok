/**
 * 온셋(소리가 새로 나는 순간) 검출 — 채보 초안의 후보 시각을 만든다.
 *
 * 대역별 플럭스에서 이동평균을 뺀 노벨티 곡선을 만들고, 그 위에서 피크를 찍는다.
 * 임계는 절대값이 아니라 **국소 적응형**(주변 창의 평균 + k×표준편차) — 곡 안에서
 * 조용한 구간과 시끄러운 구간의 온셋을 같은 기준으로 잡기 위해서다.
 */

import type { Band, FrameFeatures } from './features'
import { subtractMovingAverage } from './features'

export interface Onset {
  /** 파일 내 시각 */
  timeMs: number
  /** 결합 노벨티 세기. 1.0 = 곡 전체 온셋 평균 (songAccents의 100과 같은 기준) */
  strength: number
  /**
   * 이 온셋의 **원시 플럭스 비율**(합 = 1) — 킥/멜로디 구분에 쓴다.
   * 결합 노벨티처럼 대역 평균으로 정규화하면 조용한 대역의 누설이 증폭되어
   * "순수 저역 킥의 mid 기여가 low보다 크다" 같은 왜곡이 난다 — 비율은 원시값으로 본다.
   */
  bands: Record<Band, number>
}

/** 피크로 인정할 국소 최대 반경 — 이보다 가까운 이중 검출은 큰 쪽만 남는다 */
const PEAK_RADIUS_MS = 50
/** 적응 임계: 주변 창 평균 + K × 표준편차 */
const THRESH_WINDOW_MS = 2000
const THRESH_K = 1.2

/** 결합 노벨티 대역 가중 — 저역(킥)이 박자 정보를 제일 많이 갖는다 */
const BAND_WEIGHT: Record<Band, number> = { low: 1.4, mid: 1.0, high: 0.6 }

export interface OnsetAnalysis {
  onsets: Onset[]
  /** 결합 노벨티 곡선(프레임당 1값) — 템포 추정이 그대로 쓴다 */
  novelty: Float32Array
  frameMs: number
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

  // 국소 적응 임계 — 누적합으로 창 평균·분산을 O(n)에
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
    return mean + THRESH_K * Math.sqrt(varr)
  }

  const peakRadius = Math.max(1, Math.round(PEAK_RADIUS_MS / frameMs))
  const rawPeaks: number[] = []
  for (let i = 1; i < frameCount - 1; i++) {
    const v = novelty[i]!
    if (v <= 0 || v < threshold(i)) continue
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
  const peaks = rawPeaks.filter((f, idx) => idx === 0 || f - rawPeaks[idx - 1]! > peakRadius)

  // strength 기준: 1.0 = 검출된 온셋들의 평균 노벨티 (songAccents의 "100 = 곡 평균"과 동형)
  const meanPeak =
    peaks.length > 0 ? peaks.reduce((s, f) => s + novelty[f]!, 0) / peaks.length : 1

  const onsets: Onset[] = peaks.map((f) => {
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
    return {
      timeMs: features.timeOfFrame(f),
      strength: novelty[f]! / meanPeak,
      bands:
        rawSum > 0
          ? { low: rawLow / rawSum, mid: rawMid / rawSum, high: rawHigh / rawSum }
          : { low: 1 / 3, mid: 1 / 3, high: 1 / 3 },
    }
  })

  return { onsets, novelty, frameMs }
}
