/**
 * 템포(BPM)·격자 위상 추정 — presets.ts의 CHART_BPM=129를 실측했던 방법 그대로.
 *
 * 2단계로 간다:
 * 1. **자기상관**으로 대략의 BPM 후보를 찾는다 (배속·반속 모호성은 배수 보강으로 누른다)
 * 2. 후보 주변을 잘게 훑으며 **전곡 격자 정합도**(8분음표 격자 위에 노벨티가 얼마나 얹히는가)가
 *    최대인 (BPM, 위상)을 고른다 — 자기상관만으로는 ±1 BPM 정밀도가 안 나온다.
 *
 * 정합도 대비(피크/중앙값)를 신뢰도로 노출한다 — 템포가 흔들리는 곡(루바토)은 대비가 낮아
 * "수동 BPM 입력"으로 안내할 근거가 된다.
 */

import type { OnsetAnalysis } from './onsets'

export interface TempoEstimate {
  bpm: number
  beatMs: number
  /** 8분음표 격자의 원점 — 파일 내 시각(ms). 첫 박이 놓이는 자리다. */
  gridOriginMs: number
  /** 격자 정합도 피크 / 전 BPM 후보 중앙값 — 3 이상이면 기계적 고정 템포로 봐도 된다 */
  confidence: number
  /** 참고용 차순위 후보(반속·배속 포함) — UI에서 보여주고 수동 선택을 돕는다 */
  candidates: { bpm: number; score: number }[]
}

export const BPM_MIN = 60
export const BPM_MAX = 200

/**
 * 격자 정합 창 — 악센트 샘플링(±45ms)보다 훨씬 좁게 잡는다.
 * 창이 넓으면 0.3 BPM쯤 어긋난 격자도 드리프트가 창 안에 다 들어와 점수가 같아진다 —
 * 30초 트랙에서 0.3 BPM 오차의 누적 위상차가 ±35ms라, 그보다 좁아야 소수점 BPM이 갈린다.
 */
const GRID_WINDOW_MS = 15

/**
 * 노벨티 곡선에서 t(ms) 주변 ±window의 **삼각 가중** 최댓값.
 * 순수 최댓값을 쓰면 창 안 어디에 피크가 있든 점수가 같아 위상 점수에 평지가 생기고,
 * 스캔 순서상 평지의 첫 위상(이른 쪽)이 뽑혀 원점이 한쪽으로 밀린다 — 중심에서 멀수록
 * 감쇠시키면 피크를 정중앙에 두는 위상이 유일한 최적이 된다.
 */
function maxAround(novelty: Float32Array, frameMs: number, tMs: number, windowMs: number): number {
  const c = tMs / frameMs
  const r = Math.max(1, windowMs / frameMs)
  const lo = Math.max(0, Math.ceil(c - r))
  const hi = Math.min(novelty.length - 1, Math.floor(c + r))
  let best = 0
  for (let i = lo; i <= hi; i++) {
    const w = 1 - Math.abs(i - c) / r
    const v = novelty[i]! * w
    if (v > best) best = v
  }
  return best
}

/**
 * 주어진 BPM에서 최적 위상과 그때의 정합도.
 *
 * 점수는 **박 자리 평균 − 엇박(반 박 밀린 자리) 평균**이다. "박 자리에 얼마나 얹히는가"만
 * 보면 반속 BPM이 이긴다 — 격자점이 절반이라 전부 소리 위에 놓이기 때문이다. 반속이면
 * 엇박 자리에도 똑같이 소리가 있어 대비가 0이 되고, 배속이면 박 자리 절반이 무음이라
 * 평균이 깎인다. 이 대비가 배속·반속 모호성을 실제로 가르는 값이다.
 */
function bestPhase(
  novelty: Float32Array,
  frameMs: number,
  bpm: number,
): { phaseMs: number; score: number } {
  const beatMs = 60000 / bpm
  const durationMs = novelty.length * frameMs
  const phaseStep = Math.min(10, beatMs / 48) // 10ms보다 곱게 — 위상 정밀도가 곧 오프셋 정밀도다
  let best = { phaseMs: 0, score: -Infinity }
  for (let phase = 0; phase < beatMs; phase += phaseStep) {
    let on = 0
    let off = 0
    let n = 0
    for (let t = phase; t < durationMs; t += beatMs) {
      on += maxAround(novelty, frameMs, t, GRID_WINDOW_MS)
      off += maxAround(novelty, frameMs, t + beatMs / 2, GRID_WINDOW_MS)
      n++
    }
    if (n > 0) {
      const score = (on - off) / n
      if (score > best.score) best = { phaseMs: phase, score }
    }
  }
  return best
}

export function estimateTempo(onsetAnalysis: OnsetAnalysis): TempoEstimate {
  const { novelty, frameMs } = onsetAnalysis

  // ── 1단계: 자기상관으로 후보 추리기 ──────────────────────────
  // 정규화(평균 제거) 없이 원곡선 그대로 — 노벨티는 이미 이동평균을 뺀 곡선이다.
  const lagMin = Math.round(((60_000 / BPM_MAX) * 1) / frameMs)
  const lagMax = Math.round(((60_000 / BPM_MIN) * 1) / frameMs)
  const acf = new Float64Array(lagMax + 1)
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0
    for (let i = 0; i + lag < novelty.length; i++) sum += novelty[i]! * novelty[i + lag]!
    acf[lag] = sum / (novelty.length - lag)
  }
  // 배수 보강: 한 박 lag과 두 박 lag이 함께 강해야 진짜 박이다 — 반박(배속 BPM)을 누른다
  const scoreOf = (lag: number): number => {
    const twice = lag * 2
    return acf[lag]! + (twice <= lagMax ? 0.5 * acf[twice]! : 0)
  }
  const coarse: { bpm: number; score: number }[] = []
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const s = scoreOf(lag)
    const prev = lag > lagMin ? scoreOf(lag - 1) : -Infinity
    const next = lag < lagMax ? scoreOf(lag + 1) : -Infinity
    if (s >= prev && s > next) coarse.push({ bpm: 60_000 / (lag * frameMs), score: s })
  }
  coarse.sort((a, b) => b.score - a.score)
  const topCoarse = coarse.slice(0, 6)

  // ── 2단계: 후보 주변 미세 탐색 — 격자 정합도 최대의 (BPM, 위상) ──
  // 자기상관 피크가 반속·배속에 앉아 있어도 여기서 바로잡히도록 후보의 ×2·÷2도 함께 훑는다.
  let best = { bpm: 120, phaseMs: 0, score: -Infinity }
  const fineScores: { bpm: number; score: number }[] = []
  const tried = new Set<number>()
  for (const cand of topCoarse) {
    for (const center of [cand.bpm, cand.bpm * 2, cand.bpm / 2]) {
      for (let bpm = center - 1.5; bpm <= center + 1.5; bpm += 0.25) {
        const key = Math.round(bpm * 20) // 0.05 격자로 중복 제거
        if (bpm < BPM_MIN || bpm > BPM_MAX || tried.has(key)) continue
        tried.add(key)
        const { phaseMs, score } = bestPhase(novelty, frameMs, bpm)
        fineScores.push({ bpm, score })
        if (score > best.score) best = { bpm, phaseMs, score }
      }
    }
  }
  // 최종 후보 주변을 0.05 BPM 간격으로 한 번 더 — 129.00 정밀도는 여기서 나온다
  for (let bpm = best.bpm - 0.3; bpm <= best.bpm + 0.3; bpm += 0.05) {
    if (bpm < BPM_MIN || bpm > BPM_MAX) continue
    const { phaseMs, score } = bestPhase(novelty, frameMs, bpm)
    if (score > best.score) best = { bpm, phaseMs, score }
  }

  fineScores.sort((a, b) => b.score - a.score)
  const median = fineScores[Math.floor(fineScores.length / 2)]?.score ?? 1
  const confidence = median > 0 ? best.score / median : 1

  // bestPhase가 이미 한 박 격자에서 위상을 골랐다(대비 점수가 박/엇박을 구분한다).
  // 그 위상이 곧 첫 박 — 마지막으로 1ms 단위 국소 탐색으로 원점만 다듬는다(위상 스캔은 ~10ms 격자였다).
  const beatMs = 60000 / best.bpm
  const durationMs = novelty.length * frameMs
  let gridOriginMs = best.phaseMs
  let originScore = -Infinity
  for (let phase = best.phaseMs - 12; phase <= best.phaseMs + 12; phase += 1) {
    let s = 0
    for (let t = phase; t < durationMs; t += beatMs) s += maxAround(novelty, frameMs, t, GRID_WINDOW_MS)
    if (s > originScore) {
      originScore = s
      gridOriginMs = phase
    }
  }
  // 위상이 음수로 내려갔으면 한 박 안으로 되돌린다 — 원점은 파일 안 시각이어야 한다
  if (gridOriginMs < 0) gridOriginMs += beatMs

  const dedup: { bpm: number; score: number }[] = []
  for (const c of fineScores) {
    if (dedup.every((d) => Math.abs(d.bpm - c.bpm) > 2)) dedup.push(c)
    if (dedup.length >= 4) break
  }

  return {
    bpm: Math.round(best.bpm * 100) / 100,
    beatMs: 60000 / best.bpm,
    gridOriginMs: Math.round(gridOriginMs * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    candidates: dedup.map((c) => ({ bpm: Math.round(c.bpm * 100) / 100, score: c.score })),
  }
}
