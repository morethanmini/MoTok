/**
 * 곡 분석 오케스트레이터 — AudioBuffer 하나를 넣으면 채보 생성에 필요한 전부를 돌려준다.
 *
 * 결과(SongAnalysis)는 **순수 JSON 직렬화 가능** 형태다 — 채보 초안 생성기(songChart)와
 * songAccents 내보내기(accentExport)가 이것만 받으면 되고, 필요하면 파일로 저장해
 * 재분석 없이 재사용할 수 있다.
 */

import { computeSlotAccents } from './accentExport'
import { extractFeatures, toMono, type FrameFeatures, type MonoAudio } from './features'
import { detectOnsets, type Onset } from './onsets'
import { estimateTempo, type TempoEstimate } from './tempo'

/** 온셋에 음높이 힌트를 얹은 것 — 초안 생성기의 레인/높이 배치 근거 */
export interface AnalyzedOnset extends Onset {
  /** 스펙트럼 센트로이드의 곡 내 백분위(0=낮은 음, 1=높은 음). 무음이면 0.5 */
  pitch: number
}

/** 지속음 — 홀드(링)/연결(캐치) 노트 후보 */
export interface Sustain {
  startMs: number
  durationMs: number
  /** 시작 시점 음높이(0~1) */
  pitch: number
  /** 지속 구간의 음높이 변화(끝-시작, -1~1) — 슬라이드 방향 힌트 */
  pitchDelta: number
}

export interface SongAnalysis {
  durationMs: number
  bpm: number
  beatMs: number
  /** 곡의 박자 격자 원점(파일 내 시각) — 노트·재생 정렬의 기준 */
  gridOriginMs: number
  confidence: number
  bpmCandidates: { bpm: number; score: number }[]
  /** RhythmMusic의 첫 소리 규칙(10ms RMS > −50dBFS)과 같은 값 — 재생 정렬 검증용 */
  firstSoundMs: number
  onsets: AnalyzedOnset[]
  sustains: Sustain[]
  /** 8분음표 슬롯별 악센트(100 = 곡 평균) — songAccents.ts 교체용 (accentExport 참고) */
  slotAccents: number[]
}

/** 지속음으로 인정할 최소 길이 — 이보다 짧으면 그냥 탭이다 */
const SUSTAIN_MIN_MS = 450
/** 지속 판정: 온셋 직후 피크 에너지의 이 비율 아래로 내려가면 끝난 것 */
const SUSTAIN_KEEP_RATIO = 0.5

/** music.ts의 detectFirstSound와 같은 규칙 — 양쪽이 같아야 재생 정렬이 상쇄된다 */
const HEAD_WINDOW_MS = 10
const HEAD_THRESHOLD_DB = -50

export function detectFirstSoundMs(audio: MonoAudio): number {
  const { samples, sampleRate } = audio
  const win = Math.max(1, Math.round((sampleRate * HEAD_WINDOW_MS) / 1000))
  const floor = Math.pow(10, HEAD_THRESHOLD_DB / 20)
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += samples[j]! * samples[j]!
    if (Math.sqrt(sum / win) > floor) return (i / sampleRate) * 1000
  }
  return 0
}

/** 0이 아닌 센트로이드 값들의 백분위 경계(p10, p90) — pitch 정규화 기준 */
function centroidBounds(features: FrameFeatures): [number, number] {
  const nonzero: number[] = []
  for (let i = 0; i < features.frameCount; i++) {
    const c = features.centroid[i]!
    if (c > 0) nonzero.push(c)
  }
  if (nonzero.length === 0) return [0, 1]
  nonzero.sort((a, b) => a - b)
  const p = (q: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(q * nonzero.length))]!
  const lo = p(0.1)
  const hi = p(0.9)
  return hi > lo ? [lo, hi] : [lo, lo + 1]
}

function pitchAt(features: FrameFeatures, bounds: [number, number], timeMs: number): number {
  const f = Math.max(0, Math.min(features.frameCount - 1, Math.round(timeMs / features.frameMs)))
  // 온셋 프레임 하나는 트랜지언트라 흔들린다 — 직후 몇 프레임(~60ms)을 평균한다
  const span = Math.max(1, Math.round(60 / features.frameMs))
  let sum = 0
  let n = 0
  for (let i = f; i < Math.min(features.frameCount, f + span); i++) {
    if (features.centroid[i]! > 0) {
      sum += features.centroid[i]!
      n++
    }
  }
  if (n === 0) return 0.5
  const [lo, hi] = bounds
  return Math.max(0, Math.min(1, (sum / n - lo) / (hi - lo)))
}

/**
 * 온셋 뒤로 에너지가 유지되는 구간을 찾는다.
 * 다음 온셋이 오면 거기서 끊는다 — 새 소리가 났으면 그건 별개의 노트다.
 */
function detectSustains(
  features: FrameFeatures,
  onsets: Onset[],
  bounds: [number, number],
): Sustain[] {
  const { energy, frameMs, frameCount } = features
  const out: Sustain[] = []
  for (let i = 0; i < onsets.length; i++) {
    const onset = onsets[i]!
    const f0 = Math.round(onset.timeMs / frameMs)
    const fNext =
      i + 1 < onsets.length ? Math.round(onsets[i + 1]!.timeMs / frameMs) : frameCount - 1
    if (f0 >= frameCount) break

    // 온셋 직후 150ms 안의 피크가 이 소리의 기준 크기
    let peak = 0
    const peakEnd = Math.min(frameCount - 1, f0 + Math.round(150 / frameMs))
    for (let f = f0; f <= peakEnd; f++) if (energy[f]! > peak) peak = energy[f]!
    if (peak <= 0) continue

    let fEnd = f0
    for (let f = f0; f < fNext; f++) {
      if (energy[f]! < peak * SUSTAIN_KEEP_RATIO) break
      fEnd = f
    }
    const durationMs = (fEnd - f0) * frameMs
    if (durationMs < SUSTAIN_MIN_MS) continue

    const startPitch = pitchAt(features, bounds, onset.timeMs)
    const endPitch = pitchAt(features, bounds, onset.timeMs + durationMs - 60)
    out.push({
      startMs: Math.round(onset.timeMs),
      durationMs: Math.round(durationMs),
      pitch: startPitch,
      pitchDelta: Math.round((endPitch - startPitch) * 100) / 100,
    })
  }
  return out
}

/**
 * 전체 파이프라인. AudioBuffer(형태만 맞으면 됨) → SongAnalysis.
 * onProgress는 0~1 — 특징 추출이 대부분의 시간을 차지한다.
 */
export async function analyzeSong(
  buffer: {
    numberOfChannels: number
    length: number
    sampleRate: number
    getChannelData(ch: number): Float32Array
  },
  onProgress?: (ratio: number) => void,
): Promise<SongAnalysis> {
  const mono = toMono(buffer)
  const features = await extractFeatures(mono, (r) => onProgress?.(r * 0.85))
  const onsetAnalysis = detectOnsets(features)
  onProgress?.(0.9)
  // 템포 탐색도 수백 ms 걸릴 수 있다 — UI가 멎지 않게 한 번 양보한다
  await new Promise((r) => setTimeout(r, 0))
  const tempo: TempoEstimate = estimateTempo(onsetAnalysis)
  onProgress?.(0.97)

  const bounds = centroidBounds(features)
  const onsets: AnalyzedOnset[] = onsetAnalysis.onsets.map((o) => ({
    ...o,
    timeMs: Math.round(o.timeMs),
    strength: Math.round(o.strength * 100) / 100,
    bands: {
      low: Math.round(o.bands.low * 100) / 100,
      mid: Math.round(o.bands.mid * 100) / 100,
      high: Math.round(o.bands.high * 100) / 100,
    },
    pitch: Math.round(pitchAt(features, bounds, o.timeMs) * 100) / 100,
  }))
  const sustains = detectSustains(features, onsetAnalysis.onsets, bounds)
  onProgress?.(1)

  return {
    durationMs: Math.round((mono.samples.length / mono.sampleRate) * 1000),
    bpm: tempo.bpm,
    beatMs: tempo.beatMs,
    gridOriginMs: tempo.gridOriginMs,
    confidence: tempo.confidence,
    bpmCandidates: tempo.candidates,
    firstSoundMs: Math.round(detectFirstSoundMs(mono) * 10) / 10,
    onsets,
    sustains,
    slotAccents: computeSlotAccents(
      onsetAnalysis.novelty,
      onsetAnalysis.frameMs,
      tempo.gridOriginMs,
      tempo.beatMs,
    ),
  }
}
