/**
 * 캐치(그랩) 판정 로직 — DOM/카메라 의존 없는 순수 로직.
 *
 * 노트는 고정 위치 (x, y)에서 원경→근경으로 접근(스케일 확대)해 timeMs에 판정 크기에 도달한다.
 * "펴짐→쥠" 전환 이벤트 시점에 손-노트 거리 < NOTE_RADIUS + HAND_RADIUS && 타이밍 창 내 → 히트.
 * 쥔 채로 있으면 전환이 없으므로 연속 히트가 나지 않는다(쓸고 다니기 방지).
 *
 * 프로토의 슬래시 경로는 분기까지 통째로 제거했다 — type 없는 노트가 slash로 새지 않도록.
 */

import { NOTE_RADIUS, HAND_RADIUS, SWIPE_REACH_SCALE } from '../core/config'
import { judgeHit, isMissed } from '../core/judge'
import type { Beatmap, CatchNote } from '../core/beatmap'
import type { Hand, HitJudgement } from '../core/types'

/** 프레임마다 넘기는 손 상태. grabbed는 "펴짐→쥠" 전환 프레임에만 true. */
export interface HandState {
  x: number
  y: number
  grabbed: boolean
}

export type Hands = Record<Hand, HandState | null>

type NoteStatus = 'pending' | 'active' | 'hit' | 'miss'

export interface TrackedNote extends CatchNote {
  id: number
  status: NoteStatus
}

export type CatchEvent =
  | { type: 'spawn'; note: TrackedNote }
  | { type: 'miss'; note: TrackedNote }
  | { type: 'hit'; note: TrackedNote; judgement: HitJudgement; hand: Hand; deltaMs: number }

const SIDES: Hand[] = ['left', 'right']

/** 노트 접근 진행도 0(스폰)→1(판정 시점). 도달 후에는 1 초과. */
export function noteProgress(note: CatchNote, tMs: number, approachTimeMs: number): number {
  return 1 - (note.timeMs - tMs) / approachTimeMs
}

/** 손-노트 거리가 히트 반경 안인가. 스와이프는 스치듯 지나가므로 더 넉넉하다. */
export function isInReach(hand: HandState | null, note: CatchNote): boolean {
  if (!hand) return false
  const reach = (NOTE_RADIUS + HAND_RADIUS) * (note.kind === 'swipe' ? SWIPE_REACH_SCALE : 1)
  return Math.hypot(hand.x - note.x, hand.y - note.y) < reach
}

export class CatchLogic {
  private readonly approachTimeMs: number
  readonly notes: TrackedNote[]

  constructor(beatmap: Pick<Beatmap, 'approachTimeMs' | 'notes'>) {
    this.approachTimeMs = beatmap.approachTimeMs
    this.notes = beatmap.notes.map((n, id) => ({ ...n, id, status: 'pending' }))
  }

  /**
   * 매 프레임 호출. 노트는 timeMs 오름차순이라 겹칠 때 이른 노트가 먼저 판정된다.
   * 반환: 이 프레임에 발생한 이벤트들.
   */
  update(tMs: number, hands: Hands): CatchEvent[] {
    const events: CatchEvent[] = []
    const usedHands = new Set<Hand>() // 한 번의 전환은 노트 하나만 파괴

    for (const note of this.notes) {
      if (note.status === 'hit' || note.status === 'miss') continue

      if (note.status === 'pending' && tMs >= note.timeMs - this.approachTimeMs) {
        note.status = 'active'
        events.push({ type: 'spawn', note })
      }
      if (note.status !== 'active') continue

      const delta = tMs - note.timeMs
      if (isMissed(delta)) {
        note.status = 'miss'
        events.push({ type: 'miss', note })
        continue
      }

      const sides = note.hand === 'any' ? SIDES : [note.hand]
      for (const side of sides) {
        const hand = hands[side]
        if (!hand || usedHands.has(side)) continue
        // swipe만 손이 닿기만 해도 인정. 그 외(catch·미지정)는 "펴짐→쥠" 전환 순간만 —
        // 조건을 이 방향으로 써야 kind가 빠진 노트가 공짜 히트로 새지 않는다.
        if (note.kind !== 'swipe' && !hand.grabbed) continue
        if (!isInReach(hand, note)) continue

        const judgement = judgeHit(delta) // 이른 히트(delta<0)도 창 내면 인정
        if (!judgement) continue

        note.status = 'hit'
        usedHands.add(side)
        events.push({ type: 'hit', note, judgement, hand: side, deltaMs: delta })
        break
      }
    }
    return events
  }

  activeNotes(): TrackedNote[] {
    return this.notes.filter((n) => n.status === 'active')
  }

  isFinished(): boolean {
    return this.notes.every((n) => n.status === 'hit' || n.status === 'miss')
  }
}
