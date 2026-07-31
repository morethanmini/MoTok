/**
 * 곡 분석 파이프라인 검증 — 정답을 아는 합성 신호로 수학을 확인한다.
 * (실제 MP3 회귀는 node에서 디코드가 안 되므로 채보 랩에서 Neon_Pulse로 수동 확인한다 —
 *  BPM 129.00, 격자 위상 154ms가 그 기준값이다.)
 */
import { describe, expect, it } from 'vitest'

import { fftMagnitude } from '../analysis/fft'
import { extractFeatures, subtractMovingAverage, toMono } from '../analysis/features'
import { detectOnsets } from '../analysis/onsets'
import { analyzeSong, detectFirstSoundMs } from '../analysis/analyzeSong'
import { formatSongAccentsSnippet } from '../analysis/accentExport'

const SR = 44100

/** 모노 샘플을 AudioBuffer 흉내로 감싼다 */
function fakeBuffer(samples: Float32Array) {
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate: SR,
    getChannelData: () => samples,
  }
}

/** t(ms)에 감쇠하는 광대역 클릭(킥 흉내)을 얹는다 */
function addClick(samples: Float32Array, atMs: number, gain = 0.8) {
  const start = Math.round((atMs / 1000) * SR)
  const durSamples = Math.round(0.05 * SR)
  for (let i = 0; i < durSamples && start + i < samples.length; i++) {
    const t = i / SR
    const env = Math.exp(-t * 80)
    // 저역(80Hz) + 중역(1kHz) 성분 — low/mid 플럭스가 모두 반응한다
    samples[start + i]! +=
      gain * env * (0.7 * Math.sin(2 * Math.PI * 80 * t) + 0.5 * Math.sin(2 * Math.PI * 1000 * t))
  }
}

/** t(ms)부터 durMs 동안 지속되는 톤을 얹는다 */
function addTone(samples: Float32Array, atMs: number, durMs: number, freq: number, gain = 0.5) {
  const start = Math.round((atMs / 1000) * SR)
  const durSamples = Math.round((durMs / 1000) * SR)
  for (let i = 0; i < durSamples && start + i < samples.length; i++) {
    const t = i / SR
    const attack = Math.min(1, t / 0.005) // 5ms 어택 — 온셋이 잡히게
    samples[start + i]! += gain * attack * Math.sin(2 * Math.PI * freq * t)
  }
}

describe('fftMagnitude', () => {
  it('임펄스는 모든 빈에서 크기 1', () => {
    const input = new Float32Array(256)
    input[0] = 1
    const mag = fftMagnitude(input)
    for (let k = 0; k < mag.length; k++) expect(mag[k]).toBeCloseTo(1, 5)
  })

  it('빈 주파수 사인은 그 빈에만 에너지가 모인다', () => {
    const n = 1024
    const bin = 100
    const input = new Float32Array(n)
    for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * bin * i) / n)
    const mag = fftMagnitude(input)
    expect(mag[bin]).toBeCloseTo(n / 2, 0)
    expect(mag[bin - 3]).toBeLessThan(1e-2)
    expect(mag[bin + 3]).toBeLessThan(1e-2)
  })

  it('2의 거듭제곱이 아니면 거부한다', () => {
    expect(() => fftMagnitude(new Float32Array(1000))).toThrow()
  })
})

describe('subtractMovingAverage', () => {
  it('일정한 값은 전부 0이 된다 (새로 난 소리가 없다)', () => {
    const flat = new Float32Array(500).fill(3)
    const out = subtractMovingAverage(flat, 5.8)
    for (const v of out) expect(v).toBeCloseTo(0, 4)
  })

  it('솟은 지점만 양수로 남는다', () => {
    const values = new Float32Array(500).fill(1)
    values[250] = 10
    const out = subtractMovingAverage(values, 5.8)
    expect(out[250]).toBeGreaterThan(5)
    expect(out[100]).toBeLessThan(0.5)
  })
})

describe('detectFirstSoundMs', () => {
  it('머리 무음을 건너뛰고 첫 소리를 찾는다', () => {
    const samples = new Float32Array(SR) // 1초
    addTone(samples, 300, 400, 440, 0.5)
    const first = detectFirstSoundMs({ samples, sampleRate: SR })
    expect(first).toBeGreaterThanOrEqual(280)
    expect(first).toBeLessThanOrEqual(320)
  })
})

describe('detectOnsets', () => {
  it('클릭 시각을 ±15ms 안에서 전부 찾고, 무음에서 유령 온셋을 만들지 않는다', async () => {
    const clickTimes = [500, 1100, 1900, 2600, 3400, 4100]
    const samples = new Float32Array(SR * 5)
    for (const t of clickTimes) addClick(samples, t)

    const features = await extractFeatures({ samples, sampleRate: SR })
    const { onsets } = detectOnsets(features)

    expect(onsets.length).toBe(clickTimes.length)
    clickTimes.forEach((expected, i) => {
      expect(Math.abs(onsets[i]!.timeMs - expected)).toBeLessThanOrEqual(15)
    })
  })

  it('저역 클릭은 low 대역 기여가 mid보다 크다', async () => {
    const samples = new Float32Array(SR * 3)
    // 순수 저역(60Hz) 킥
    const start = Math.round(1.0 * SR)
    for (let i = 0; i < SR * 0.08; i++) {
      const t = i / SR
      samples[start + i] = 0.9 * Math.exp(-t * 50) * Math.sin(2 * Math.PI * 60 * t)
    }
    const features = await extractFeatures({ samples, sampleRate: SR })
    const { onsets } = detectOnsets(features)
    expect(onsets.length).toBeGreaterThanOrEqual(1)
    const kick = onsets[0]!
    expect(kick.bands.low).toBeGreaterThan(kick.bands.mid)
  })
})

describe('analyzeSong (합성 클릭 트랙)', () => {
  it('129 BPM · 위상 154ms 클릭 트랙에서 BPM·격자 원점을 복원한다', async () => {
    const beatMs = 60000 / 129
    const durationSec = 30
    const samples = new Float32Array(SR * durationSec)
    for (let t = 154; t < durationSec * 1000 - 100; t += beatMs) {
      addClick(samples, t)
    }
    const analysis = await analyzeSong(fakeBuffer(samples))

    expect(Math.abs(analysis.bpm - 129)).toBeLessThanOrEqual(0.15)
    // 격자 원점은 한 박 주기 안에서 154ms와 같은 위상이어야 한다
    const phaseDiff = Math.abs(((analysis.gridOriginMs - 154) % beatMs) + beatMs) % beatMs
    const wrapped = Math.min(phaseDiff, beatMs - phaseDiff)
    expect(wrapped).toBeLessThanOrEqual(25)
    expect(analysis.confidence).toBeGreaterThan(1.2)

    // 악센트 표: 박 자리(짝수 슬롯 = 클릭)는 평균(100) 위, 엇박(홀수 슬롯 = 무음)은 아래
    const accents = analysis.slotAccents
    expect(accents.length).toBeGreaterThan(100)
    const even = accents.filter((_, i) => i % 2 === 0)
    const odd = accents.filter((_, i) => i % 2 === 1)
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    expect(avg(even)).toBeGreaterThan(avg(odd) * 3)

    // 스니펫에 BPM과 배열이 담긴다
    const snippet = formatSongAccentsSnippet(analysis, '합성 클릭 트랙')
    expect(snippet).toContain(`CHART_BPM = ${analysis.bpm}`)
    expect(snippet).toContain('SLOT_ACCENTS: readonly number[]')
  }, 30_000)

  it('지속 톤은 sustain으로, 음높이는 pitch로 잡힌다', async () => {
    const samples = new Float32Array(SR * 6)
    addTone(samples, 1000, 1200, 350, 0.6) // 낮은 지속음
    addClick(samples, 3000)
    addTone(samples, 4200, 900, 3200, 0.6) // 높은 지속음

    const analysis = await analyzeSong(fakeBuffer(samples))

    const low = analysis.sustains.find((s) => Math.abs(s.startMs - 1000) < 60)
    const high = analysis.sustains.find((s) => Math.abs(s.startMs - 4200) < 60)
    expect(low).toBeDefined()
    expect(high).toBeDefined()
    expect(low!.durationMs).toBeGreaterThanOrEqual(800)
    expect(low!.durationMs).toBeLessThanOrEqual(1500)
    expect(high!.pitch).toBeGreaterThan(low!.pitch)

    // 3초의 단타 클릭은 sustain이 아니다
    expect(analysis.sustains.some((s) => Math.abs(s.startMs - 3000) < 60)).toBe(false)
  }, 30_000)
})
