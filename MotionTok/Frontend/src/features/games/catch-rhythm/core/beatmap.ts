/**
 * 비트맵 스키마·검증 — 순수 로직. 잘못된 비트맵은 어디가 왜 틀렸는지 밝히고 거부한다.
 *
 * 대전 MVP의 채보는 generator/battleChart가 시드에서 만들어 내므로 fetch 경로가 없다.
 * 이 모듈은 (1) 생성기 출력의 자기검증 (2) 곡 채보 확장 시 로더의 입력 검증을 겸한다.
 *
 * 프로토의 링(lane/hold) 스키마는 해당 모드를 구현하지 않으므로 가져오지 않았다.
 * 필요해지면 docs-personal/motion-party-proto/src/core/beatmap.js에서 그때 가져온다.
 */

import { DEFAULT_APPROACH_TIME_MS } from './config'
import type { NoteHand } from './types'

export class BeatmapError extends Error {}

const HANDS: NoteHand[] = ['left', 'right', 'any']

export interface CatchNote {
  timeMs: number
  /** 게임 좌표. 화면 중앙이 원점, 가로는 종횡비만큼 넓다. */
  x: number
  y: number
  hand: NoteHand
}

export interface Beatmap {
  version: 2
  title: string
  mode: 'catch'
  bpm: number
  offsetMs: number
  /** 노트가 원경에서 판정 지점까지 오는 시간 */
  approachTimeMs: number
  notes: CatchNote[]
  /** 마지막 노트 시각 */
  durationMs: number
}

function fail(msg: string): never {
  throw new BeatmapError(`비트맵 오류: ${msg}`)
}

function checkNumber(
  value: unknown,
  name: string,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name}은(는) 숫자여야 합니다 (현재: ${JSON.stringify(value)})`)
  }
  if (value < min || value > max) {
    fail(`${name}은(는) ${min}~${max} 범위여야 합니다 (현재: ${value})`)
  }
  return value
}

/** JSON 객체 → 검증된 비트맵. 실패 시 BeatmapError. */
export function parseBeatmap(json: unknown): Beatmap {
  if (typeof json !== 'object' || json === null) fail('비트맵은 JSON 객체여야 합니다')
  const raw = json as Record<string, unknown>

  if (raw.version !== 2) fail(`지원하지 않는 version: ${JSON.stringify(raw.version)} (2만 지원)`)
  if (typeof raw.title !== 'string' || !raw.title) fail('title이 필요합니다')
  if (raw.mode !== 'catch') fail(`mode는 catch여야 합니다 (현재: ${JSON.stringify(raw.mode)})`)
  checkNumber(raw.bpm, 'bpm', { min: 1, max: 999 })
  checkNumber(raw.offsetMs ?? 0, 'offsetMs', { min: 0 })
  const approachTimeMs = checkNumber(
    raw.approachTimeMs ?? DEFAULT_APPROACH_TIME_MS,
    'approachTimeMs',
    {
      min: 100,
    },
  )
  if (!Array.isArray(raw.notes) || raw.notes.length === 0) fail('notes 배열이 비어 있습니다')

  const notes: CatchNote[] = raw.notes.map((n: unknown, i: number) => {
    const note = n as Record<string, unknown>
    const timeMs = checkNumber(note.timeMs, `notes[${i}].timeMs`, { min: 0 })
    const x = checkNumber(note.x, `notes[${i}].x`, { min: -2, max: 2 })
    const y = checkNumber(note.y, `notes[${i}].y`, { min: -1, max: 1 })
    if (note.hand !== undefined && !HANDS.includes(note.hand as NoteHand)) {
      fail(
        `notes[${i}].hand은(는) ${HANDS.join('/')} 중 하나여야 합니다 (현재: ${JSON.stringify(note.hand)})`,
      )
    }
    return { timeMs, x, y, hand: (note.hand as NoteHand) ?? 'any' }
  })
  notes.sort((a, b) => a.timeMs - b.timeMs)

  return {
    version: 2,
    title: raw.title,
    mode: 'catch',
    bpm: raw.bpm as number,
    offsetMs: (raw.offsetMs as number) ?? 0,
    approachTimeMs,
    notes,
    // 위에서 빈 배열을 걸렀으므로 항상 값이 있다.
    durationMs: notes[notes.length - 1]?.timeMs ?? 0,
  }
}
