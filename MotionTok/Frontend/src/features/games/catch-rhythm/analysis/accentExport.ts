/**
 * songAccents 자동 내보내기 (P5) — 곡을 갈아끼울 때 수동 오프라인 분석을 대체한다.
 *
 * generator/songAccents.ts의 표는 "8분음표 슬롯마다 ±45ms 안 노벨티 최댓값을 전체 평균으로
 * 나눠 ×100 (255에서 절단)" 규약이다. 여기서 같은 규약으로 임의 곡의 표를 만들고,
 * 붙여넣기 가능한 TS 스니펫으로 포맷한다.
 *
 * 슬롯 원점은 분석이 실측한 격자 원점(gridOriginMs)이다 — 기존 표의 "첫 소리 실측 −16ms"
 * 관행과 달리 위상까지 정합도로 맞춘 값이라, RhythmMusic의 첫 소리 규칙과의 차이는
 * firstSoundMs로 함께 내보내 확인할 수 있게 한다.
 */

import type { SongAnalysis } from './analyzeSong'

/** 악센트 샘플 창 — songAccents 원본과 같은 ±45ms (PERFECT ±80ms보다 좁게) */
const ACCENT_WINDOW_MS = 45

/**
 * 노벨티 곡선 → 8분음표 슬롯 악센트 표.
 * 100 = 곡 평균 세기, 0 = 소리 없음, 255 절단 — songAccents.ts와 같은 눈금.
 */
export function computeSlotAccents(
  novelty: Float32Array,
  frameMs: number,
  gridOriginMs: number,
  beatMs: number,
): number[] {
  const durationMs = novelty.length * frameMs
  const stepMs = beatMs / 2
  const raw: number[] = []
  for (let t = gridOriginMs; t < durationMs; t += stepMs) {
    const c = Math.round(t / frameMs)
    const r = Math.max(1, Math.round(ACCENT_WINDOW_MS / frameMs))
    let max = 0
    for (let i = Math.max(0, c - r); i <= Math.min(novelty.length - 1, c + r); i++) {
      if (novelty[i]! > max) max = novelty[i]!
    }
    raw.push(max)
  }
  const mean = raw.reduce((s, v) => s + v, 0) / Math.max(1, raw.length)
  if (mean <= 0) return raw.map(() => 0)
  return raw.map((v) => Math.min(255, Math.round((v / mean) * 100)))
}

/**
 * songAccents.ts에 붙여넣을 스니펫.
 * SLOT_ACCENTS 배열(원본과 같은 한 줄 16개 포맷)과 CHART_BPM 값을 함께 담는다.
 */
export function formatSongAccentsSnippet(analysis: SongAnalysis, songLabel: string): string {
  const rows: string[] = []
  const accents = analysis.slotAccents
  for (let i = 0; i < accents.length; i += 16) {
    rows.push('  ' + accents.slice(i, i + 16).join(', ') + ',')
  }
  const slots = accents.length
  const seconds = (analysis.durationMs / 1000).toFixed(1)
  return [
    `// ${songLabel} — 채보 랩 자동 분석 (S15P11A706-168)`,
    `// BPM ${analysis.bpm} (신뢰도 ${analysis.confidence}), 격자 원점 ${analysis.gridOriginMs}ms,`,
    `// 첫 소리 ${analysis.firstSoundMs}ms, 곡 ${seconds}초 = ${slots}칸`,
    `//`,
    `// presets.ts: export const CHART_BPM = ${analysis.bpm}`,
    `// songAccents.ts의 SLOT_ACCENTS를 아래로 교체:`,
    `const SLOT_ACCENTS: readonly number[] = [`,
    ...rows,
    `]`,
    ``,
  ].join('\n')
}
