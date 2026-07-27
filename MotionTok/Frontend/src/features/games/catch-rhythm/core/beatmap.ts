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
import type { NoteHand, NoteKind } from './types'

export class BeatmapError extends Error {}

const HANDS: NoteHand[] = ['left', 'right', 'any']
const KINDS: NoteKind[] = ['swipe', 'trail', 'catch']

export interface PathPoint {
  x: number
  y: number
}

export interface CatchNote {
  timeMs: number
  /** 게임 좌표. 화면 중앙이 원점, 가로는 종횡비만큼 넓다. 연결 노트는 경로의 시작점. */
  x: number
  y: number
  hand: NoteHand
  kind: NoteKind
  /**
   * 연결(trail) 노트가 따라가야 할 경로. (x, y)를 시작점으로 이어지는 나머지 점들.
   * timeMs부터 durationMs 동안 경로 위를 등속으로 훑는다.
   */
  path?: PathPoint[]
  /** 연결 노트의 지속 시간 */
  durationMs?: number
  /**
   * 이 노트만의 접근 시간. 없으면 비트맵 기본값을 쓴다.
   * 주먹 노트처럼 준비 시간이 더 필요한 종류에 쓴다 — 판정 시각은 그대로고 더 일찍 등장한다.
   */
  approachMs?: number
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
    if (note.kind !== undefined && !KINDS.includes(note.kind as NoteKind)) {
      fail(
        `notes[${i}].kind은(는) ${KINDS.join('/')} 중 하나여야 합니다 (현재: ${JSON.stringify(note.kind)})`,
      )
    }
    const kind = (note.kind as NoteKind) ?? 'catch'
    const parsed: CatchNote = { timeMs, x, y, hand: (note.hand as NoteHand) ?? 'any', kind }

    if (kind === 'trail') {
      if (!Array.isArray(note.path) || note.path.length === 0) {
        fail(`notes[${i}].path는 연결 노트에 필수입니다`)
      }
      parsed.path = (note.path as unknown[]).map((p, j) => {
        const pt = p as Record<string, unknown>
        return {
          x: checkNumber(pt.x, `notes[${i}].path[${j}].x`, { min: -2, max: 2 }),
          y: checkNumber(pt.y, `notes[${i}].path[${j}].y`, { min: -1, max: 1 }),
        }
      })
      parsed.durationMs = checkNumber(note.durationMs, `notes[${i}].durationMs`, { min: 100 })
    }
    if (note.approachMs !== undefined) {
      parsed.approachMs = checkNumber(note.approachMs, `notes[${i}].approachMs`, { min: 100 })
    }
    return parsed
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
