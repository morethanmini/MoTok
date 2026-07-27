/** 캐치캐치리듬 공용 타입 — 순수 도메인. DOM/카메라 의존 없음. */

/** 판정 등급. 히트는 perfect/good, 놓치면 miss. */
export type Judgement = 'perfect' | 'good' | 'miss'

/** 히트로 인정된 판정만 (판정창 밖은 null로 표현) */
export type HitJudgement = Extract<Judgement, 'perfect' | 'good'>

export type Hand = 'left' | 'right'

/** 노트가 요구하는 손. 'any'는 아무 손이나 인정. */
export type NoteHand = Hand | 'any'

/**
 * 노트 종류.
 * - catch: 노트 위에서 **주먹을 쥐어야** 한다(펴짐→쥠 전환 순간만 인정)
 * - swipe: 손이 **지나가기만 해도** 된다(쥠 여부 무관). 판정창 안에 손이 들어오면 히트
 */
export type NoteKind = 'catch' | 'swipe'
