/**
 * 캐치캐치리듬 전용 STOMP 이벤트 타입.
 *
 * 앱 공용 `api/types.ts`의 `GameEvent` 유니온에 넣지 않는다 — 여섯 게임이 하나의 유니온에
 * 각자 필드를 붙이면 그 파일에서 MR이 충돌한다. 이 게임의 페이로드는 이 파일에서 끝난다.
 * 서버 쪽 대응: `rhythm/dto/RhythmEventResponse.java`
 */

import type { Difficulty } from './generator/presets'
import type { GameMode } from './core/types'

export interface RhythmResultEntry {
  rank: number
  userId: string
  nickname: string
  score: number
  maxCombo: number
  perfect: number
  good: number
  miss: number
  finished: boolean
  pointsEarned: number
  /** 서버가 계산해 주는 정확도(%) */
  accuracy?: number
}

export type RhythmEvent =
  | {
      type: 'RHYTHM_START'
      sessionId: string
      /** 서버가 Long을 문자열로 내린다 — JS number 정밀도(2^53)를 넘을 수 있다 */
      seed: string
      difficulty: Difficulty
      mode: GameMode
      /** 이벤트를 만든 시각(서버 기준) — 로컬 시계와의 오차 보정에 쓴다 */
      serverNow: number
      /** 카운트다운이 끝나고 첫 노트가 오기 시작하는 시각(서버 기준) */
      startAt: number
      endAt: number
    }
  | {
      type: 'PROGRESS'
      sessionId: string
      userId: string
      nickname: string
      score: number
      combo: number
    }
  | {
      type: 'PLAYER_FINISHED'
      sessionId: string
      userId: string
      nickname: string
      score: number
      maxCombo: number
    }
  | {
      type: 'RHYTHM_END'
      sessionId: string
      results: RhythmResultEntry[]
    }
  /** 방장 강제종료(-164) — 정산이 없어 results가 없다 */
  | {
      type: 'RHYTHM_ABORTED'
      sessionId: string
    }

export type RhythmStartEvent = Extract<RhythmEvent, { type: 'RHYTHM_START' }>

/** 라운드 진행 중 화면에 띄우는 상대 점수 한 줄 */
export interface RhythmLiveRow {
  userId: string
  nickname: string
  score: number
  combo: number
  finished: boolean
}
