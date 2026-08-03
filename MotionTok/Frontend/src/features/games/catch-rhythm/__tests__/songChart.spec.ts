/**
 * 곡 주도 채보 초안 생성기 검증 — 합성 SongAnalysis(정답을 아는 온셋 목록)로
 * 결정성·물리 제약·격자 규약을 확인한다.
 */
import { describe, expect, it } from 'vitest'

import type { SongAnalysis } from '../analysis/analyzeSong'
import { HAND_MAX_SPEED, REACH_SAFETY } from '../core/config'
import { PRESETS, LEAD_IN_MS, X_RANGE, Y_RANGE } from '../generator/presets'
import {
  generateSongCatchChart,
  generateSongRingChart,
  songStartMs,
  type SongCatchNote,
} from '../generator/songChart'

/** 120 BPM(박 500ms)·원점 200ms·60초짜리 합성 분석 결과 */
function makeAnalysis(): SongAnalysis {
  const beatMs = 500
  const origin = 200
  const durationMs = 60_000
  const onsets: SongAnalysis['onsets'] = []
  const sustains: SongAnalysis['sustains'] = []
  for (let k = 0; ; k++) {
    const t = origin + k * (beatMs / 2) // 8분음표마다 온셋
    if (t > durationMs - 1000) break
    const onBeat = k % 2 === 0
    onsets.push({
      timeMs: t,
      strength: onBeat ? 1.5 : 0.7,
      bands: onBeat ? { low: 0.6, mid: 0.3, high: 0.1 } : { low: 0.2, mid: 0.5, high: 0.3 },
      pitch: 0.5 + 0.4 * Math.sin(k / 5), // 멜로디가 오르내리는 흉내
    })
    if (k % 16 === 0) {
      sustains.push({ startMs: t, durationMs: 1200, pitch: 0.6, pitchDelta: 0.3 })
    }
  }
  return {
    durationMs,
    bpm: 120,
    beatMs,
    gridOriginMs: origin,
    confidence: 5,
    bpmCandidates: [{ bpm: 120, score: 1 }],
    firstSoundMs: origin,
    onsets,
    sustains,
    slotAccents: [],
  }
}

describe('generateSongCatchChart', () => {
  const analysis = makeAnalysis()

  it('같은 (분석, 난이도, 시드)면 완전히 같은 초안이 나온다', () => {
    const a = generateSongCatchChart(analysis, 'NORMAL', 42)
    const b = generateSongCatchChart(analysis, 'NORMAL', 42)
    expect(a).toEqual(b)
    const c = generateSongCatchChart(analysis, 'NORMAL', 43)
    expect(JSON.stringify(c.notes)).not.toEqual(JSON.stringify(a.notes))
  })

  it('노트 수가 난이도 목표 밀도 대역에 들어온다 (NORMAL ≈ 1.4개/초)', () => {
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42)
    const seconds = (analysis.durationMs - analysis.gridOriginMs) / 1000
    const target = 1.4 * seconds
    expect(chart.notes.length).toBeGreaterThanOrEqual(target * 0.6)
    expect(chart.notes.length).toBeLessThanOrEqual(target * 1.05)
  })

  it('EASY가 HARD보다 노트가 적다', () => {
    const easy = generateSongCatchChart(analysis, 'EASY', 42)
    const hard = generateSongCatchChart(analysis, 'HARD', 42)
    expect(easy.notes.length).toBeLessThan(hard.notes.length)
  })

  it('물리 제약: 같은 손 최소 간격과 이동 속도 한계를 지킨다', () => {
    for (const difficulty of ['EASY', 'NORMAL', 'HARD'] as const) {
      const preset = PRESETS[difficulty]
      const chart = generateSongCatchChart(analysis, difficulty, 7)
      const last: Record<'left' | 'right', SongCatchNote | null> = { left: null, right: null }
      for (const note of chart.notes) {
        const prev = last[note.owner]
        if (prev) {
          const prevEndMs = prev.timeMs + (prev.durationMs ?? 0)
          const dt = note.timeMs - prevEndMs
          expect(dt).toBeGreaterThanOrEqual(preset.minSameHandGapMs - 1)
          const from = prev.path?.[prev.path.length - 1] ?? { x: prev.x, y: prev.y }
          const d = Math.hypot(note.x - from.x, note.y - from.y)
          const maxDist = HAND_MAX_SPEED * (dt / 1000) * REACH_SAFETY
          expect(d).toBeLessThanOrEqual(maxDist + 1e-6)
        }
        last[note.owner] = note
      }
    }
  })

  it('노트가 전부 스폰 영역 안이고, 리드인 앞에는 놓이지 않는다', () => {
    const chart = generateSongCatchChart(analysis, 'HARD', 99)
    for (const n of chart.notes) {
      expect(n.timeMs).toBeGreaterThanOrEqual(LEAD_IN_MS)
      expect(n.x).toBeGreaterThanOrEqual(X_RANGE.left[0])
      expect(n.x).toBeLessThanOrEqual(X_RANGE.right[1])
      expect(n.y).toBeGreaterThanOrEqual(Y_RANGE[0])
      expect(n.y).toBeLessThanOrEqual(Y_RANGE[1])
      if (n.path) {
        for (const p of n.path) {
          expect(p.x).toBeGreaterThanOrEqual(X_RANGE.left[0])
          expect(p.x).toBeLessThanOrEqual(X_RANGE.right[1])
        }
      }
    }
  })

  it("snap: 'grid'면 모든 노트가 16분음표 격자 위에 있다", () => {
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, { snap: 'grid', subdivision: 4 })
    const stepMs = analysis.beatMs / 4
    for (const n of chart.notes) {
      const rel = n.timeMs - chart.offsetMs
      const dist = Math.abs(rel - Math.round(rel / stepMs) * stepMs)
      expect(dist).toBeLessThanOrEqual(1) // ms 반올림 오차만 허용
    }
  })

  it('지속음 자리에는 연결(trail) 노트가 생기고 길이가 프리셋 대역 안이다', () => {
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42)
    const trails = chart.notes.filter((n) => n.kind === 'trail')
    expect(trails.length).toBeGreaterThan(0)
    const [lo, hi] = PRESETS.NORMAL.trailDurationMs
    for (const t of trails) {
      expect(t.durationMs!).toBeGreaterThanOrEqual(lo * 0.8 - 1)
      expect(t.durationMs!).toBeLessThanOrEqual(hi + 1)
      expect(t.path!.length).toBeGreaterThan(0)
    }
  })

  it('연결 노트는 쿨다운(2초)을 지켜 몰리지 않는다', () => {
    for (const seed of [1, 42, 777]) {
      const chart = generateSongCatchChart(analysis, 'NORMAL', seed)
      let prevTrailEnd = -Infinity
      for (const n of chart.notes) {
        if (n.kind !== 'trail') continue
        expect(n.timeMs - prevTrailEnd).toBeGreaterThanOrEqual(2000 - 1)
        prevTrailEnd = n.timeMs + n.durationMs!
      }
    }
  })

  it('offsetMs는 리드인 + 한 박이다 (곡 격자 원점의 게임 시각)', () => {
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42)
    expect(chart.offsetMs).toBe(songStartMs(analysis))
    expect(chart.offsetMs).toBe(LEAD_IN_MS + 500)
  })
})

describe('generateSongRingChart', () => {
  const analysis = makeAnalysis()

  it('결정적이고, 레인이 0~7 정수다', () => {
    const a = generateSongRingChart(analysis, 'NORMAL', 42)
    const b = generateSongRingChart(analysis, 'NORMAL', 42)
    expect(a).toEqual(b)
    for (const n of a.notes) {
      expect(Number.isInteger(n.lane)).toBe(true)
      expect(n.lane).toBeGreaterThanOrEqual(0)
      expect(n.lane).toBeLessThanOrEqual(7)
    }
  })

  it('에디터 규약: offsetMs = 격자 원점, timeMs는 파일 내 절대 시각', () => {
    const chart = generateSongRingChart(analysis, 'NORMAL', 42, { snap: 'grid' })
    expect(chart.offsetMs).toBe(200)
    const stepMs = analysis.beatMs / 4
    for (const n of chart.notes) {
      expect(n.timeMs).toBeGreaterThanOrEqual(200)
      const rel = n.timeMs - chart.offsetMs
      expect(Math.abs(rel - Math.round(rel / stepMs) * stepMs)).toBeLessThanOrEqual(1)
    }
  })

  it('연속 노트의 레인 이동이 시간 여유 안에서만 일어난다', () => {
    const chart = generateSongRingChart(analysis, 'HARD', 5)
    let prevLane: number | null = null
    let prevEnd = -Infinity
    for (const n of chart.notes) {
      if (prevLane !== null) {
        const dt = n.timeMs - prevEnd
        let diff = (n.lane - prevLane) % 8
        if (diff > 4) diff -= 8
        if (diff < -4) diff += 8
        const cap = dt >= 900 ? 8 : Math.max(1, Math.floor(dt / 200))
        expect(Math.abs(diff)).toBeLessThanOrEqual(cap)
      }
      prevLane = n.laneDelta ? (n.lane + n.laneDelta + 64) % 8 : n.lane
      prevEnd = n.timeMs + (n.durationMs ?? 0)
    }
  })

  it('지속음은 홀드가 되고, 온셋 마커가 analysis 필드에 실린다', () => {
    const chart = generateSongRingChart(analysis, 'NORMAL', 42)
    const holds = chart.notes.filter((n) => n.type === 'hold')
    expect(holds.length).toBeGreaterThan(0)
    for (const h of holds) expect(h.durationMs!).toBeGreaterThanOrEqual(400)
    expect(chart.analysis.onsets.length).toBe(analysis.onsets.length)
  })
})
