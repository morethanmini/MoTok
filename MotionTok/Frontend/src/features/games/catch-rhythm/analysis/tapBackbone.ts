/**
 * 탭 백본 — 사람이 곡을 들으며 키보드로 두드린 리듬을 채보의 뼈대로 쓴다.
 *
 * 자동 온셋 검출이 아무리 좋아져도 "이 곡에서 어떤 소리를 따라가야 하는가"는 취향과
 * 음악 이해의 문제다 — 그 판단을 사람에게 돌려주고, 기계는 잘하는 것만 한다:
 * ① 사람 손의 지연·오차 보정 ② 그 시각의 소리 정보(세기·음높이·지속음) 붙이기.
 *
 * 두 트랙으로 나눠 친다: 드럼 패스(perc)와 보컬/멜로디 패스(melody).
 * **키를 누르고 있으면(≥250ms) 홀드 탭**이 되어 롱노트(캐치 연결/링 홀드) 재료가 된다.
 * 보정된 탭은 AnalyzedOnset 형태가 되어 songChart의 backbone 옵션으로 들어간다 —
 * 이때 자동 선택(밀도 컷)은 완전히 꺼지고 탭한 것 전부가 노트가 된다.
 */

import type { AnalyzedOnset, SongAnalysis } from './analyzeSong'

/** 탭 한 번 — t = 누른 시각(파일 내 ms), d = 누르고 있던 길이(짧으면 0 = 그냥 탭) */
export interface TapEvent {
  t: number
  d: number
}

export interface TapTracks {
  /** 드럼 패스 */
  perc: TapEvent[]
  /** 보컬/멜로디 패스 */
  melody: TapEvent[]
}

export interface TapCorrection {
  /** 보정 완료된 백본 온셋 — songChart options.backbone에 그대로 넣는다 */
  onsets: AnalyzedOnset[]
  /** 추정한 계통 지연(ms, 중앙값) — 사람 반응 + 입력 경로. 양수 = 소리보다 늦게 침 */
  latencyMs: number
  /** 검출 온셋에 스냅된 탭의 비율(0~1) — 낮으면 지연 추정도 못 믿는다는 신호 */
  matchedRatio: number
}

/** 이 이상 누르고 있어야 홀드 — 그 밑은 손이 느렸을 뿐인 탭이다 */
export const HOLD_MIN_MS = 250
/** 같은 트랙에서 이보다 가까운 연타는 이중 입력으로 보고 앞 것만 남긴다 */
const DOUBLE_TAP_MS = 100
/** 지연 추정에 쓸 탭↔온셋 최대 거리 — 이보다 멀면 "그 소리를 친 것"이라 볼 수 없다 */
const LATENCY_MATCH_MS = 150
/**
 * 보정 후 이 안에 검출 온셋이 있으면 그 시각으로 스냅한다(소리의 실제 시각이 정답).
 * 기본 ±30ms — 처음의 ±70ms는 옆의 **다른 소리**(엇박 드럼 등)까지 빨아들여서
 * "맞게 쳤는데 보정 때문에 어긋나는" 역효과가 났다(실사용 피드백). 0이면 스냅 없이
 * 지연 제거만 한다.
 */
export const DEFAULT_SNAP_WINDOW_MS = 30

export interface TapCorrectionOptions {
  /** 온셋 스냅 창(±ms). 0 = 스냅 없음 */
  snapWindowMs?: number
  /**
   * 계통 지연(중앙값) 제거를 적용할지. 기본 true지만, 지연 추정은 검출 온셋을 기준으로
   * 하므로 **검출이 사람의 기준과 다르면(보컬을 따라 쳤는데 온셋은 드럼) 전체가 통째로
   * 밀린다** — 자기 타이밍을 믿는 사람은 꺼야 한다(실사용 피드백: 70ms 일괄 밀림).
   */
  applyLatency?: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 정렬된 온셋 배열에서 t에 가장 가까운 것 — 이진 탐색 */
function nearestOnset(onsets: AnalyzedOnset[], tMs: number): AnalyzedOnset | null {
  if (onsets.length === 0) return null
  let lo = 0
  let hi = onsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (onsets[mid]!.timeMs < tMs) lo = mid + 1
    else hi = mid
  }
  const cand = [onsets[lo], onsets[lo - 1]].filter((o): o is AnalyzedOnset => o !== undefined)
  cand.sort((a, b) => Math.abs(a.timeMs - tMs) - Math.abs(b.timeMs - tMs))
  return cand[0] ?? null
}

function dedupe(taps: TapEvent[]): TapEvent[] {
  const sorted = [...taps].sort((a, b) => a.t - b.t)
  return sorted.filter((e, i) => i === 0 || e.t - sorted[i - 1]!.t > DOUBLE_TAP_MS)
}

/**
 * 탭 트랙 → 보정된 백본 온셋.
 *
 * 1. 두 트랙을 합쳐 계통 지연을 추정한다(탭 − 가장 가까운 검출 온셋의 중앙값).
 *    사람마다·장비마다 다르지만 한 세션 안에서는 거의 일정하다 — 그래서 중앙값 하나로 뺀다.
 * 2. 지연을 뺀 시각이 검출 온셋 ±70ms 안이면 **그 온셋의 시각·세기·음높이를 입는다** —
 *    사람은 "어느 소리인지"를 알려줬고 정확한 시각은 기계가 안다.
 * 3. 온셋이 없는 자리(검출이 놓친 보컬 등)는 지연만 뺀 시각을 그대로 쓴다 —
 *    이게 이 방식의 존재 이유다. 세기·음높이는 이웃 온셋에서 빌린다.
 *
 * 홀드 길이(d)는 지연이 시작·끝에 똑같이 얹혀 상쇄되므로 보정 없이 그대로 쓴다.
 */
export function correctTapTracks(
  taps: TapTracks,
  analysis: SongAnalysis,
  options: TapCorrectionOptions = {},
): TapCorrection {
  const snapWindowMs = options.snapWindowMs ?? DEFAULT_SNAP_WINDOW_MS
  const applyLatency = options.applyLatency ?? true
  const sortedOnsets = [...analysis.onsets].sort((a, b) => a.timeMs - b.timeMs)
  const perc = dedupe(taps.perc)
  const melody = dedupe(taps.melody)

  // ── 1. 계통 지연 추정 ──
  const deltas: number[] = []
  for (const e of [...perc, ...melody]) {
    const near = nearestOnset(sortedOnsets, e.t)
    if (near && Math.abs(e.t - near.timeMs) <= LATENCY_MATCH_MS) deltas.push(e.t - near.timeMs)
  }
  const latencyMs = applyLatency ? Math.round(median(deltas)) : 0

  // ── 2·3. 트랙별 보정·스냅 ──
  let matched = 0
  const convert = (trackTaps: TapEvent[], source: 'perc' | 'melody'): AnalyzedOnset[] =>
    trackTaps.map((e) => {
      const t = e.t - latencyMs
      const holdMs = e.d >= HOLD_MIN_MS ? Math.round(e.d) : undefined
      const near = nearestOnset(sortedOnsets, t)
      if (near && snapWindowMs > 0 && Math.abs(near.timeMs - t) <= snapWindowMs) {
        matched++
        // 시각·소리 정보는 검출 온셋에서, 스트림·홀드는 사람의 판단에서 — 사람이 우선이다
        return { ...near, source, ...(holdMs !== undefined ? { holdMs } : {}) }
      }
      return {
        timeMs: Math.round(t),
        strength: 1,
        bands:
          source === 'perc'
            ? { low: 0.6, mid: 0.3, high: 0.1 }
            : { low: 0.1, mid: 0.6, high: 0.3 },
        pitch: near?.pitch ?? 0.5,
        source,
        ...(holdMs !== undefined ? { holdMs } : {}),
      }
    })

  const onsets = [...convert(perc, 'perc'), ...convert(melody, 'melody')].sort(
    (a, b) => a.timeMs - b.timeMs,
  )
  const total = perc.length + melody.length

  return {
    onsets,
    latencyMs,
    matchedRatio: total > 0 ? Math.round((matched / total) * 100) / 100 : 0,
  }
}
