/**
 * 템포(BPM)·격자 위상 추정.
 *
 * 2단계로 간다:
 * 1. **자기상관**으로 대략의 BPM 후보를 찾는다 — 단, 온셋이 8분음표 격자에 깔린 곡에서는
 *    자기상관이 8분 간격의 **모든 배수**(½·⅔·¾·1·1.5·2배 템포 전부)에서 솟으므로
 *    후보의 관련 배율(×2·÷2·×1.5·×⅔·×4/3·×¾·×3)을 전부 미세 탐색에 넣는다.
 * 2. 후보 주변을 잘게 훑으며 **온셋 설명력**이 최대인 (BPM, 위상)을 고른다:
 *
 *    점수 = 커버리지 − 0.15×빈칸 비율 + 0.3×박 우세
 *    - 커버리지: 검출된 온셋(세기 가중)이 8분음표 격자 ±15ms 안에 얼마나 들어오는가.
 *      틀린 배율의 격자는 온셋 일부만 설명한다 — 4/3배 템포는 1/3만 잡아 즉시 탈락.
 *    - 빈칸 벌점: 아무 소리도 없는 격자점의 비율 — 필요 이상 촘촘한(배속) 격자를 누른다.
 *    - 박 우세: 잡힌 온셋 중 박(짝수 칸) 자리 세기의 비중 — "8분마다 소리가 있는 곡"에서
 *      박이 엇박보다 조금이라도 세면 올바른 절반/두배 해석을 고른다.
 *
 *    ※ 이전 구현의 "박−엇박 대비" 점수는 엇박에도 소리가 꽉 찬 곡(Neon_Pulse: 박 1.03 vs
 *      엇박 0.92)에서 무너져 4/3배 템포(172.01)를 골랐다 — 실곡 회귀로 잡은 버그.
 *      86(=129×⅔)의 자기상관 피크(8분 간격 3배 주기)가 ×2 확장으로 172가 되고,
 *      172의 성긴 격자는 엇박 벌점을 피해 대비 점수에서 이겼다. 커버리지 기준에서는
 *      온셋의 1/3만 설명하므로 바로 진다.
 *
 * 점수 대비(피크/중앙값)를 신뢰도로 노출한다 — 템포가 흔들리는 곡(루바토)은 대비가 낮아
 * "수동 BPM 입력·free 스냅"으로 안내할 근거가 된다.
 */

import type { OnsetAnalysis } from './onsets'

export interface TempoEstimate {
  bpm: number
  beatMs: number
  /** 8분음표 격자의 원점 — 파일 내 시각(ms). 첫 박이 놓이는 자리다. */
  gridOriginMs: number
  /** 정합 점수 피크 / 전 BPM 후보 중앙값 — 높을수록 기계적 고정 템포 */
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
 * 창 안에서는 삼각 가중 — 평지 동점으로 위상이 한쪽으로 밀리는 것을 막는다.
 */
const GRID_WINDOW_MS = 15
/** 빈 격자점 벌점 가중 */
const EMPTY_PENALTY = 0.15
/** 박(짝수 칸) 세기 우세 가중 */
const BEAT_BONUS = 0.3

/** 점수 계산에 쓰는 온셋 요약 */
interface OnsetPoint {
  timeMs: number
  strength: number
}

/**
 * 주어진 BPM에서 최적 위상과 그때의 온셋 설명력 점수.
 * 위상은 [0, 한 박) — 격자는 8분음표(반 박) 간격이고 위상 자리가 곧 박(짝수 칸)이다.
 */
function bestPhase(
  onsets: OnsetPoint[],
  totalStrength: number,
  durationMs: number,
  bpm: number,
): { phaseMs: number; score: number } {
  const beatMs = 60000 / bpm
  const stepMs = beatMs / 2
  const phaseStep = Math.min(10, beatMs / 48) // 10ms보다 곱게 — 위상 정밀도가 곧 오프셋 정밀도다
  let best = { phaseMs: 0, score: -Infinity }
  if (onsets.length === 0 || totalStrength <= 0) return { phaseMs: 0, score: 0 }

  const slotCount = Math.max(1, Math.floor(durationMs / stepMs))
  const hit = new Uint8Array(slotCount)

  for (let phase = 0; phase < beatMs; phase += phaseStep) {
    hit.fill(0)
    let covered = 0
    let coveredBeat = 0
    let hitCount = 0
    for (const o of onsets) {
      const rel = o.timeMs - phase
      const k = Math.round(rel / stepMs)
      const dist = Math.abs(rel - k * stepMs)
      if (dist > GRID_WINDOW_MS) continue
      const w = 1 - dist / GRID_WINDOW_MS // 삼각 가중
      covered += o.strength * w
      if (((k % 2) + 2) % 2 === 0) coveredBeat += o.strength * w
      if (k >= 0 && k < slotCount && !hit[k]) {
        hit[k] = 1
        hitCount++
      }
    }
    const coverage = covered / totalStrength
    const empty = 1 - hitCount / slotCount
    const beatShare = covered > 0 ? coveredBeat / covered : 0.5
    const score = coverage - EMPTY_PENALTY * empty + BEAT_BONUS * beatShare
    if (score > best.score) best = { phaseMs: phase, score }
  }
  return best
}

export function estimateTempo(onsetAnalysis: OnsetAnalysis): TempoEstimate {
  const { novelty, frameMs } = onsetAnalysis
  const durationMs = novelty.length * frameMs
  const points: OnsetPoint[] = onsetAnalysis.onsets.map((o) => ({
    timeMs: o.timeMs,
    strength: o.strength,
  }))
  const totalStrength = points.reduce((s, o) => s + o.strength, 0)

  // ── 1단계: 자기상관으로 후보 추리기 ──────────────────────────
  // 정규화(평균 제거) 없이 원곡선 그대로 — 노벨티는 이미 이동평균을 뺀 곡선이다.
  const lagMin = Math.round(60_000 / BPM_MAX / frameMs)
  const lagMax = Math.round(60_000 / BPM_MIN / frameMs)
  const acf = new Float64Array(lagMax + 1)
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0
    for (let i = 0; i + lag < novelty.length; i++) sum += novelty[i]! * novelty[i + lag]!
    acf[lag] = sum / (novelty.length - lag)
  }
  // 배수 보강: 한 박 lag과 두 박 lag이 함께 강해야 진짜 박이다
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

  // ── 2단계: 후보 주변 미세 탐색 — 온셋 설명력 최대의 (BPM, 위상) ──
  // 자기상관 피크는 8분 간격의 어떤 배수에도 앉을 수 있다(172 사건 참고) —
  // 관련 배율을 전부 열어 두고 설명력 점수가 진짜 템포를 고르게 한다.
  const RATIOS = [1, 2, 0.5, 1.5, 2 / 3, 4 / 3, 0.75, 3]
  let best = { bpm: 120, phaseMs: 0, score: -Infinity }
  const fineScores: { bpm: number; score: number }[] = []
  const tried = new Set<number>()
  for (const cand of topCoarse) {
    for (const ratio of RATIOS) {
      const center = cand.bpm * ratio
      for (let bpm = center - 1.5; bpm <= center + 1.5; bpm += 0.25) {
        const key = Math.round(bpm * 20) // 0.05 격자로 중복 제거
        if (bpm < BPM_MIN || bpm > BPM_MAX || tried.has(key)) continue
        tried.add(key)
        const { phaseMs, score } = bestPhase(points, totalStrength, durationMs, bpm)
        fineScores.push({ bpm, score })
        if (score > best.score) best = { bpm, phaseMs, score }
      }
    }
  }
  // 최종 후보 주변을 0.05 BPM 간격으로 한 번 더 — 129.00 정밀도는 여기서 나온다
  for (let bpm = best.bpm - 0.3; bpm <= best.bpm + 0.3; bpm += 0.05) {
    if (bpm < BPM_MIN || bpm > BPM_MAX) continue
    const { phaseMs, score } = bestPhase(points, totalStrength, durationMs, bpm)
    if (score > best.score) best = { bpm, phaseMs, score }
  }

  fineScores.sort((a, b) => b.score - a.score)
  const median = fineScores[Math.floor(fineScores.length / 2)]?.score ?? 1
  const confidence = median > 0 ? best.score / median : 1

  // bestPhase의 위상 자리가 곧 박 — 1ms 국소 탐색으로 원점만 다듬는다(위상 스캔은 ~10ms 격자였다).
  const beatMs = 60000 / best.bpm
  let gridOriginMs = best.phaseMs
  let originScore = -Infinity
  for (let phase = best.phaseMs - 12; phase <= best.phaseMs + 12; phase += 1) {
    let s = 0
    for (const o of points) {
      const rel = o.timeMs - phase
      const k = Math.round(rel / beatMs)
      const dist = Math.abs(rel - k * beatMs)
      if (dist <= GRID_WINDOW_MS) s += o.strength * (1 - dist / GRID_WINDOW_MS)
    }
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
