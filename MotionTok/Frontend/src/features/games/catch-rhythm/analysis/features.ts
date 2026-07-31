/**
 * STFT 프레임 특징 추출 — 곡 분석의 1차 원료.
 *
 * songAccents.ts의 악센트 표를 만들 때 썼던 오프라인 분석(STFT → 반파정류 스펙트럼 플럭스 →
 * 1초 이동평균 제거)과 같은 수학을 브라우저용 순수 함수로 옮긴 것이다. 한 번의 패스로
 * 프레임마다 아래를 뽑는다:
 *
 * - 대역별 플럭스: 저역(킥·베이스) / 중역(스네어·보컬·멜로디) / 고역(하이햇·질감)
 * - RMS 에너지: 지속음(홀드 후보) 검출용
 * - 스펙트럼 센트로이드: "대략 음이 높은가" — 레인/높이 매핑의 힌트
 *
 * AudioBuffer에 직접 의존하지 않고 {samples, sampleRate}를 받는다 — vitest(node)에서
 * 합성 신호로 검증하기 위해서다.
 */

import { fftMagnitude, hannWindow } from './fft'

/** 분석 입력 — AudioBuffer를 모노로 내린 것 */
export interface MonoAudio {
  samples: Float32Array
  sampleRate: number
}

/** 대역 경계(Hz) — songAccents가 봤던 30~12k 범위를 셋으로 나눈다 */
export const BAND_EDGES = {
  low: [30, 200],
  mid: [200, 2000],
  high: [2000, 12000],
} as const

export type Band = keyof typeof BAND_EDGES

/** FFT 크기 — 44.1kHz에서 빈 폭 43Hz. 플럭스에는 충분하고 비용은 절반이다(2048 대비). */
export const FFT_SIZE = 1024
/** 홉 — 44.1kHz에서 5.8ms. 판정창(±80ms)·스냅창(±45ms)보다 한참 촘촘하다. */
export const HOP_SIZE = 256

export interface FrameFeatures {
  /** 프레임 중심 시각들이 이 간격(ms)으로 늘어선다 */
  frameMs: number
  /** i번째 프레임 중심의 파일 내 시각 */
  timeOfFrame(i: number): number
  frameCount: number
  /** 대역별 반파정류 스펙트럼 플럭스 (프레임당 1값) */
  flux: Record<Band, Float32Array>
  /** 프레임 RMS 에너지 */
  energy: Float32Array
  /** 스펙트럼 센트로이드(Hz). 에너지가 거의 없는 프레임은 0 */
  centroid: Float32Array
}

/**
 * AudioBuffer(형태만 맞으면 아무 객체나) → 모노 다운믹스.
 * 채널 평균 — 스테레오 위상 반전 소재가 아니면 이걸로 충분하다.
 */
export function toMono(buffer: {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData(ch: number): Float32Array
}): MonoAudio {
  const { numberOfChannels, length, sampleRate } = buffer
  if (numberOfChannels === 1) return { samples: buffer.getChannelData(0), sampleRate }
  const out = new Float32Array(length)
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) out[i]! += data[i]! / numberOfChannels
  }
  return { samples: out, sampleRate }
}

/**
 * 전체 프레임 특징을 한 패스로 뽑는다.
 *
 * 3~4분 곡이면 수만 프레임 × FFT라 수 초 걸릴 수 있다 — `yieldEvery` 프레임마다
 * `onProgress`를 부르고 이벤트 루프에 양보한다(UI 진행 표시 + 멈춤 방지).
 */
export async function extractFeatures(
  audio: MonoAudio,
  onProgress?: (ratio: number) => void,
  yieldEvery = 2000,
): Promise<FrameFeatures> {
  const { samples, sampleRate } = audio
  const frameCount = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1)
  const frameMs = (HOP_SIZE / sampleRate) * 1000
  const window = hannWindow(FFT_SIZE)
  const bins = FFT_SIZE / 2 + 1
  const binHz = sampleRate / FFT_SIZE

  // 대역 → 빈 구간. 최소 1빈은 갖게 한다(저역은 43Hz 빈 폭에서 1~4번 빈).
  const binRange = (band: Band): [number, number] => {
    const [lo, hi] = BAND_EDGES[band]
    return [Math.max(1, Math.round(lo / binHz)), Math.min(bins - 1, Math.round(hi / binHz))]
  }
  const ranges: Record<Band, [number, number]> = {
    low: binRange('low'),
    mid: binRange('mid'),
    high: binRange('high'),
  }

  const flux: Record<Band, Float32Array> = {
    low: new Float32Array(frameCount),
    mid: new Float32Array(frameCount),
    high: new Float32Array(frameCount),
  }
  const energy = new Float32Array(frameCount)
  const centroid = new Float32Array(frameCount)

  const frame = new Float32Array(FFT_SIZE)
  const mag = new Float32Array(bins)
  const prevMag = new Float32Array(bins)

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE
    let sumSq = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[start + i]!
      frame[i] = s * window[i]!
      sumSq += s * s
    }
    energy[f] = Math.sqrt(sumSq / FFT_SIZE)

    fftMagnitude(frame, mag)

    for (const band of ['low', 'mid', 'high'] as const) {
      const [b0, b1] = ranges[band]
      let sum = 0
      for (let k = b0; k <= b1; k++) {
        const d = mag[k]! - prevMag[k]!
        if (d > 0) sum += d // 반파정류 — 새로 생긴 소리만 본다
      }
      flux[band][f] = sum
    }

    // 센트로이드는 멜로디 대역(중역~4kHz)만 본다 — 하이햇이 섞이면 항상 위로 끌려간다
    let wSum = 0
    let mSum = 0
    const c1 = Math.min(bins - 1, Math.round(4000 / binHz))
    for (let k = ranges.mid[0]; k <= c1; k++) {
      wSum += mag[k]! * k * binHz
      mSum += mag[k]!
    }
    centroid[f] = mSum > 1e-6 ? wSum / mSum : 0

    prevMag.set(mag)

    if (onProgress && f % yieldEvery === yieldEvery - 1) {
      onProgress(f / frameCount)
      await new Promise((r) => setTimeout(r, 0)) // UI에 양보
    }
  }
  onProgress?.(1)

  return {
    frameMs,
    frameCount,
    timeOfFrame: (i) => ((i * HOP_SIZE + FFT_SIZE / 2) / sampleRate) * 1000,
    flux,
    energy,
    centroid,
  }
}

/**
 * 이동평균을 빼서 "이 순간 새로 난 소리"만 남긴다(음수는 0).
 * songAccents를 만들 때와 같은 1초 창이 기본.
 */
export function subtractMovingAverage(
  values: Float32Array,
  frameMs: number,
  windowMs = 1000,
): Float32Array {
  const half = Math.max(1, Math.round(windowMs / frameMs / 2))
  const out = new Float32Array(values.length)
  // 누적합으로 O(n)
  const prefix = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(values.length - 1, i + half)
    const mean = (prefix[b + 1]! - prefix[a]!) / (b - a + 1)
    const v = values[i]! - mean
    out[i] = v > 0 ? v : 0
  }
  return out
}
