/**
 * 탭 백본 보정 검증 — 사람 손의 지연·오차가 섞인 탭이 실제 온셋 시각으로 돌아오는지.
 */
import { describe, expect, it } from 'vitest'

import type { SongAnalysis } from '../analysis/analyzeSong'
import { correctTapTracks } from '../analysis/tapBackbone'
import { generateSongCatchChart } from '../generator/songChart'

/** 온셋이 500ms 간격으로 깔린 20초짜리 합성 분석 결과 */
function makeAnalysis(): SongAnalysis {
  const onsets: SongAnalysis['onsets'] = []
  for (let t = 200; t < 20_000; t += 500) {
    onsets.push({
      timeMs: t,
      strength: 1.2,
      bands: { low: 0.5, mid: 0.3, high: 0.2 },
      pitch: 0.3 + ((t / 500) % 5) * 0.1,
      source: 'perc',
    })
  }
  return {
    durationMs: 20_000,
    bpm: 120,
    beatMs: 500,
    gridOriginMs: 200,
    confidence: 5,
    bpmCandidates: [],
    firstSoundMs: 200,
    onsets,
    sustains: [{ startMs: 2200, durationMs: 1000, pitch: 0.6, pitchDelta: 0.2 }],
    slotAccents: [],
  }
}

describe('correctTapTracks', () => {
  const analysis = makeAnalysis()

  it('일정한 지연(+65ms)과 잔떨림(±25ms)을 걷어내고 실제 온셋 시각으로 스냅한다', () => {
    const jitter = [10, -20, 25, 0, -15, 20, -25, 5]
    const trueTimes = [700, 1200, 1700, 2200, 2700, 3200, 3700, 4200]
    const taps = trueTimes.map((t, i) => t + 65 + jitter[i]!)

    const corr = correctTapTracks({ percMs: taps, melodyMs: [] }, analysis)

    expect(Math.abs(corr.latencyMs - 65)).toBeLessThanOrEqual(25)
    expect(corr.matchedRatio).toBe(1)
    expect(corr.onsets.map((o) => o.timeMs)).toEqual(trueTimes)
    // 스냅된 탭은 온셋의 소리 정보를 입는다
    expect(corr.onsets[0]!.strength).toBe(1.2)
  })

  it('검출 온셋이 없는 자리의 탭은 지연만 빼고 살린다 — 이 방식의 존재 이유', () => {
    // 온셋(500 간격) 사이 한가운데(+250)는 어떤 온셋에서도 70ms 밖이다
    const offGrid = [950, 1450, 1950]
    const taps = [700 + 60, 1200 + 60, ...offGrid.map((t) => t + 60)]
    const corr = correctTapTracks({ percMs: [], melodyMs: taps }, analysis)

    for (const t of offGrid) {
      expect(corr.onsets.some((o) => Math.abs(o.timeMs - t) <= 12)).toBe(true)
    }
    // 전부 사람이 보컬 트랙으로 쳤으니 스트림도 melody다
    expect(corr.onsets.every((o) => o.source === 'melody')).toBe(true)
  })

  it('100ms 안의 이중 입력은 하나로 접는다', () => {
    const corr = correctTapTracks({ percMs: [700, 740, 1200], melodyMs: [] }, analysis)
    expect(corr.onsets.length).toBe(2)
  })

  it('빈 입력은 빈 결과', () => {
    const corr = correctTapTracks({ percMs: [], melodyMs: [] }, analysis)
    expect(corr.onsets).toEqual([])
    expect(corr.matchedRatio).toBe(0)
  })
})

describe('백본 채보 생성', () => {
  const analysis = makeAnalysis()

  it('백본이 있으면 밀도 컷 없이 탭 전부가 노트가 되고, 시각이 정확히 일치한다', () => {
    const taps = [700, 1400, 2200, 3100, 3800, 4700, 5500, 6200]
    const corr = correctTapTracks({ percMs: taps, melodyMs: [] }, analysis)
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, {
      backbone: corr.onsets,
      snap: 'free',
    })

    expect(chart.notes.length).toBe(taps.length)
    const offset = chart.offsetMs
    const expected = corr.onsets.map((o) => Math.round(offset + (o.timeMs - 200)))
    expect(chart.notes.map((n) => n.timeMs)).toEqual(expected)
  })

  it('백본 탭이 지속음 위면 연결 노트가 된다 — 살 붙이기는 기계 몫', () => {
    const corr = correctTapTracks({ percMs: [], melodyMs: [2200 + 55, 5200 + 55] }, analysis)
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, { backbone: corr.onsets })
    const trail = chart.notes.find((n) => n.kind === 'trail')
    expect(trail).toBeDefined()
    expect(trail!.durationMs).toBeGreaterThanOrEqual(800)
  })
})
