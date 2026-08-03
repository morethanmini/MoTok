/**
 * 탭 백본 보정 검증 — 사람 손의 지연·오차가 섞인 탭이 실제 온셋 시각으로 돌아오는지,
 * 누르고 있던 키가 홀드(롱노트)로 이어지는지.
 */
import { describe, expect, it } from 'vitest'

import type { SongAnalysis } from '../analysis/analyzeSong'
import { correctTapTracks, type TapEvent } from '../analysis/tapBackbone'
import {
  generateSongCatchChart,
  generateSongRingChart,
  ringDraftToGameChart,
} from '../generator/songChart'
import { RingLogic, holdBearingDeg, laneAngleDeg } from '../ring/ringLogic'
import { RING_RADIUS } from '../ring/ringConfig'

const tap = (t: number, d = 0): TapEvent => ({ t, d })

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
    const taps = trueTimes.map((t, i) => tap(t + 65 + jitter[i]!))

    const corr = correctTapTracks({ perc: taps, melody: [] }, analysis)

    expect(Math.abs(corr.latencyMs - 65)).toBeLessThanOrEqual(25)
    expect(corr.matchedRatio).toBe(1)
    expect(corr.onsets.map((o) => o.timeMs)).toEqual(trueTimes)
    // 스냅된 탭은 온셋의 소리 정보를 입는다
    expect(corr.onsets[0]!.strength).toBe(1.2)
  })

  it('검출 온셋이 없는 자리의 탭은 지연만 빼고 살린다 — 이 방식의 존재 이유', () => {
    // 온셋(500 간격) 사이 한가운데(+250)는 어떤 온셋에서도 70ms 밖이다
    const offGrid = [950, 1450, 1950]
    const taps = [tap(700 + 60), tap(1200 + 60), ...offGrid.map((t) => tap(t + 60))]
    const corr = correctTapTracks({ perc: [], melody: taps }, analysis)

    for (const t of offGrid) {
      expect(corr.onsets.some((o) => Math.abs(o.timeMs - t) <= 12)).toBe(true)
    }
    // 전부 사람이 보컬 트랙으로 쳤으니 스트림도 melody다
    expect(corr.onsets.every((o) => o.source === 'melody')).toBe(true)
  })

  it('누르고 있던 키(≥250ms)는 holdMs가 되고, 짧으면 그냥 탭이다', () => {
    const corr = correctTapTracks(
      { perc: [tap(700 + 60, 800), tap(1700 + 60, 150)], melody: [] },
      analysis,
    )
    const hold = corr.onsets.find((o) => o.timeMs === 700)
    const short = corr.onsets.find((o) => o.timeMs === 1700)
    expect(hold!.holdMs).toBe(800) // 길이는 지연이 상쇄되므로 그대로
    expect(short!.holdMs).toBeUndefined()
  })

  it('snapWindowMs=0이면 온셋으로 안 끌려간다 — 지연만 제거', () => {
    // 지연(+60)을 확정해 줄 정박 탭 3개 + 일부러 25ms 밀어 친 탭 1개
    const taps = [tap(700 + 60), tap(1200 + 60), tap(1700 + 60), tap(2225 + 60)]
    const free = correctTapTracks({ perc: taps, melody: [] }, analysis, { snapWindowMs: 0 })
    const pushed = free.onsets.find((o) => Math.abs(o.timeMs - 2225) <= 5)
    expect(pushed).toBeDefined() // 밀어 친 25ms가 살아 있다
    // 기본(±30)이면 같은 탭이 2200 온셋으로 스냅된다 — 옵션이 실제로 갈라놓는지 확인
    const snapped = correctTapTracks({ perc: taps, melody: [] }, analysis)
    expect(snapped.onsets.some((o) => o.timeMs === 2200)).toBe(true)
  })

  it('applyLatency=false면 어떤 이동도 없다 — 친 그대로', () => {
    const times = [760, 1260, 1760, 2333]
    const corr = correctTapTracks(
      { perc: times.map((t) => tap(t)), melody: [] },
      analysis,
      { applyLatency: false, snapWindowMs: 0 },
    )
    expect(corr.onsets.map((o) => o.timeMs)).toEqual(times)
    expect(corr.latencyMs).toBe(0)
  })

  it('100ms 안의 이중 입력은 하나로 접는다', () => {
    const corr = correctTapTracks({ perc: [tap(700), tap(740), tap(1200)], melody: [] }, analysis)
    expect(corr.onsets.length).toBe(2)
  })

  it('빈 입력은 빈 결과', () => {
    const corr = correctTapTracks({ perc: [], melody: [] }, analysis)
    expect(corr.onsets).toEqual([])
    expect(corr.matchedRatio).toBe(0)
  })
})

describe('백본 채보 생성', () => {
  const analysis = makeAnalysis()

  it('백본이 있으면 밀도 컷 없이 탭 전부가 노트가 되고, 시각이 정확히 일치한다', () => {
    const taps = [700, 1400, 2200, 3100, 3800, 4700, 5500, 6200].map((t) => tap(t))
    const corr = correctTapTracks({ perc: taps, melody: [] }, analysis)
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
    const corr = correctTapTracks({ perc: [], melody: [tap(2200 + 55), tap(5200 + 55)] }, analysis)
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, { backbone: corr.onsets })
    const trail = chart.notes.find((n) => n.kind === 'trail')
    expect(trail).toBeDefined()
    expect(trail!.durationMs).toBeGreaterThanOrEqual(800)
  })

  it('홀드 탭은 쿨다운 무시하고 전부 연결 노트가 되고, 길이는 사람이 정한 값을 따른다', () => {
    // 지속음 검출이 없는 자리(=검출이 놓친 보컬 롱노트)에서도 홀드 탭이면 연결 노트다
    const corr = correctTapTracks(
      { perc: [], melody: [tap(950 + 60, 700), tap(2450 + 60, 900), tap(3950 + 60, 5000)] },
      analysis,
    )
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, { backbone: corr.onsets })
    const trails = chart.notes.filter((n) => n.kind === 'trail')
    expect(trails.length).toBe(3) // 쿨다운(2초)이면 셋 다 살 수 없다 — 홀드 탭은 예외
    expect(Math.abs(trails[0]!.durationMs! - 700)).toBeLessThanOrEqual(5)
    expect(trails[2]!.durationMs!).toBeLessThanOrEqual(1700) // 물리 한계(MAX_TRAIL_MS)는 지킨다
  })

  it('SUPERHARD: 난이도 프리셋과 분리 — 탭 그대로, 랜덤 양손 동시·크로스 없음', () => {
    const taps = [700, 1400, 2200, 3100, 3800].map((t) => tap(t))
    const corr = correctTapTracks({ perc: taps, melody: [] }, analysis)
    const chart = generateSongCatchChart(analysis, 'SUPERHARD', 42, { backbone: corr.onsets })
    expect(chart.notes.length).toBe(taps.length) // 동시 노트로 불어나지도, 잘리지도 않는다
    expect(chart.title).toContain('SUPERHARD')
    // 크로스 없음 — 스폰이 항상 자기(owner) 쪽 영역에서 나온다(오른손 x≥-0.1, 왼손 x≤0.1)
    for (const n of chart.notes) {
      if (n.owner === 'right') expect(n.x).toBeGreaterThanOrEqual(-0.1 - 1e-9)
      else expect(n.x).toBeLessThanOrEqual(0.1 + 1e-9)
    }
  })

  it('직접 찍는 난이도는 물리 하한도 없다 — 기관총 연타·초장 홀드 전부 그대로', () => {
    // 120ms 간격 연타 10개 — NORMAL은 같은손 최소 간격(380ms)에 걸려 일부가 떨어진다
    const rapid = Array.from({ length: 10 }, (_, i) => tap(700 + i * 120))
    const corrRapid = correctTapTracks({ perc: rapid, melody: [] }, analysis)
    const normal = generateSongCatchChart(analysis, 'NORMAL', 42, { backbone: corrRapid.onsets })
    const superhard = generateSongCatchChart(analysis, 'SUPERHARD', 42, {
      backbone: corrRapid.onsets,
    })
    expect(corrRapid.onsets.length).toBe(10)
    expect(normal.notes.length).toBeLessThan(10)
    expect(superhard.notes.length).toBe(10)

    // 5초 홀드 — EXTREME도 같은 엔진: 1.7초 상한 없이 누른 만큼
    const corrHold = correctTapTracks({ perc: [], melody: [tap(3950 + 60, 5000)] }, analysis)
    const holdChart = generateSongCatchChart(analysis, 'EXTREME', 42, { backbone: corrHold.onsets })
    const trail = holdChart.notes.find((n) => n.kind === 'trail')
    expect(trail).toBeDefined()
    expect(trail!.durationMs).toBeGreaterThanOrEqual(4990)
  })

  it('고밀도 스윕 런(EXTREME): 등간격 체인 · 한 손 · any 라벨 — 그림 그리듯 쓸어담기', () => {
    const run = Array.from({ length: 8 }, (_, i) => tap(5000 + i * 150))
    const corr = correctTapTracks({ perc: [], melody: run }, analysis, {
      applyLatency: false,
      snapWindowMs: 0,
    })
    const chart = generateSongCatchChart(analysis, 'EXTREME', 42, { backbone: corr.onsets })
    expect(chart.notes.length).toBe(8)
    expect(new Set(chart.notes.map((n) => n.owner)).size).toBe(1) // 한 손 스윕
    for (const n of chart.notes) expect(n.hand).toBe('any') // 고밀도 = 손 강요 없음
    for (let i = 1; i < chart.notes.length; i++) {
      const a = chart.notes[i - 1]!
      const b = chart.notes[i]!
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      expect(d).toBeGreaterThanOrEqual(0.24 * 0.75) // 등간격 — 뭉치지 않고
      expect(d).toBeLessThanOrEqual(0.24 * 1.05) // 벌어지지도 않는다
    }
  })

  it('백본 홀드 → 링 게임 채보 → 판정까지 전 사슬이 통과한다 (홀드 고장 회귀)', () => {
    const corr = correctTapTracks({ perc: [], melody: [tap(5000, 900)] }, analysis, {
      applyLatency: false,
      snapWindowMs: 0,
    })
    const draft = generateSongRingChart(analysis, 'EXTREME', 42, { backbone: corr.onsets })
    const dHold = draft.notes.find((n) => n.type === 'hold')
    expect(dHold, '초안에 홀드가 없다').toBeDefined()
    expect(dHold!.durationMs).toBeGreaterThanOrEqual(400)

    const game = ringDraftToGameChart(draft, analysis)
    const gHold = game.notes.find((n) => n.type === 'hold')
    expect(gHold, '게임 채보에 홀드가 없다').toBeDefined()

    const logic = new RingLogic(game)
    const handAt = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return {
        left: null,
        right: { x: Math.sin(rad) * RING_RADIUS, y: Math.cos(rad) * RING_RADIUS, grabbed: false },
      }
    }
    // head 잡기 → 이동 존을 정확히 따라가기
    logic.update(gHold!.timeMs, handAt(laneAngleDeg(gHold!.lane)))
    const events = []
    for (let t = gHold!.timeMs + 30; t <= gHold!.timeMs + (gHold!.durationMs ?? 0) + 60; t += 30) {
      events.push(...logic.update(t, handAt(holdBearingDeg(gHold!, t))))
    }
    expect(events.some((e) => e.type === 'hit')).toBe(true)
  })

  it('링(EXTREME): 고밀도에서는 레인 이동이 1칸까지만 묶인다', () => {
    const run = Array.from({ length: 10 }, (_, i) => tap(5000 + i * 150))
    const corr = correctTapTracks({ perc: [], melody: run }, analysis, {
      applyLatency: false,
      snapWindowMs: 0,
    })
    const ring = generateSongRingChart(analysis, 'EXTREME', 42, { backbone: corr.onsets })
    let prev: number | null = null
    for (const n of ring.notes) {
      if (prev !== null) {
        let diff = (n.lane - prev) % 8
        if (diff > 4) diff -= 8
        if (diff < -4) diff += 8
        expect(Math.abs(diff)).toBeLessThanOrEqual(1)
      }
      prev = n.laneDelta ? (n.lane + n.laneDelta + 64) % 8 : n.lane
    }
  })

  it('handByTrack은 성향이다 — 여유 있으면 드럼=왼손·보컬=오른손, 라벨은 강제 없음', () => {
    // 손이 넉넉히 돌아오는 간격 — 성향대로 배정돼야 한다
    const corr = correctTapTracks(
      { perc: [tap(700 + 60), tap(2700 + 60)], melody: [tap(1700 + 60), tap(3700 + 60)] },
      analysis,
    )
    const catchChart = generateSongCatchChart(analysis, 'NORMAL', 42, {
      backbone: corr.onsets,
      handByTrack: true,
    })
    for (const n of catchChart.notes) {
      expect(n.owner).toBe(n.source === 'perc' ? 'left' : 'right')
      // 라벨은 기존 규칙(대부분 any) — 성향이지 강제가 아니다
      expect(['any', n.owner]).toContain(n.hand)
    }
    // 링은 손을 못 박지 않고 위치로만 유도 — 드럼 왼쪽 반원, 보컬 오른쪽 반원
    const ring = generateSongRingChart(analysis, 'NORMAL', 42, {
      backbone: corr.onsets,
      handByTrack: true,
    })
    expect(ring.notes.every((n) => n.hand === undefined)).toBe(true)
  })

  it('handByTrack: 지정 손이 연타 한계로 바쁘면 반대손으로 넘긴다 — 노트를 버리지 않는다', () => {
    // 드럼 두 개를 200ms 간격(NORMAL 같은손 최소 380ms 미만)으로 — 강제였다면 둘째가 사라진다
    const corr = correctTapTracks({ perc: [tap(950 + 60), tap(1150 + 60)], melody: [] }, analysis)
    const chart = generateSongCatchChart(analysis, 'NORMAL', 42, {
      backbone: corr.onsets,
      handByTrack: true,
    })
    expect(chart.notes.length).toBe(2)
    expect(chart.notes[0]!.owner).toBe('left')
    expect(chart.notes[1]!.owner).toBe('right') // 폴백
  })
})
