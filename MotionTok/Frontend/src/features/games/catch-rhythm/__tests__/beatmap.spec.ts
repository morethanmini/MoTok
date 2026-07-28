import { describe, it, expect } from 'vitest'
import { parseBeatmap, BeatmapError } from '../core/beatmap'
import { DEFAULT_APPROACH_TIME_MS } from '../core/config'

const valid = (over: Record<string, unknown> = {}) => ({
  version: 2,
  title: '테스트 채보',
  mode: 'catch',
  bpm: 120,
  notes: [{ timeMs: 1000, x: 0.3, y: 0.1, hand: 'right' }],
  ...over,
})

describe('parseBeatmap', () => {
  it('정상 비트맵을 파싱하고 기본값을 채운다', () => {
    const bm = parseBeatmap(valid())
    expect(bm.mode).toBe('catch')
    expect(bm.offsetMs).toBe(0)
    expect(bm.approachTimeMs).toBe(DEFAULT_APPROACH_TIME_MS)
    expect(bm.notes).toHaveLength(1)
  })

  it('notes를 timeMs 오름차순으로 정렬하고 durationMs를 마지막 노트로 잡는다', () => {
    const bm = parseBeatmap(
      valid({
        notes: [
          { timeMs: 3000, x: 0, y: 0, hand: 'left' },
          { timeMs: 1000, x: 0, y: 0, hand: 'right' },
          { timeMs: 2000, x: 0, y: 0, hand: 'left' },
        ],
      }),
    )
    expect(bm.notes.map((n) => n.timeMs)).toEqual([1000, 2000, 3000])
    expect(bm.durationMs).toBe(3000)
  })

  it('hand 생략 시 any', () => {
    const bm = parseBeatmap(valid({ notes: [{ timeMs: 0, x: 0, y: 0 }] }))
    expect(bm.notes[0]?.hand).toBe('any')
  })

  it.each([
    ['객체가 아님', 'not an object'],
    ['version 불일치', valid({ version: 1 })],
    ['title 없음', valid({ title: '' })],
    ['mode 불일치', valid({ mode: 'ring' })],
    ['bpm 범위 밖', valid({ bpm: 0 })],
    ['notes 빈 배열', valid({ notes: [] })],
    ['approachTimeMs 너무 작음', valid({ approachTimeMs: 50 })],
    ['timeMs 음수', valid({ notes: [{ timeMs: -1, x: 0, y: 0 }] })],
    ['x 범위 밖', valid({ notes: [{ timeMs: 0, x: 9, y: 0 }] })],
    ['y 범위 밖', valid({ notes: [{ timeMs: 0, x: 0, y: 9 }] })],
    ['hand 값 오류', valid({ notes: [{ timeMs: 0, x: 0, y: 0, hand: 'foot' }] })],
    ['timeMs가 숫자 아님', valid({ notes: [{ timeMs: '0', x: 0, y: 0 }] })],
  ])('%s → BeatmapError', (_label, input) => {
    expect(() => parseBeatmap(input)).toThrow(BeatmapError)
  })

  it('오류 메시지에 어느 노트가 틀렸는지 담는다', () => {
    expect(() =>
      parseBeatmap(
        valid({
          notes: [
            { timeMs: 0, x: 0, y: 0 },
            { timeMs: 100, x: 5, y: 0 },
          ],
        }),
      ),
    ).toThrow(/notes\[1\]\.x/)
  })
})
