/** 캐치캐치리듬 공용 타입 — 순수 도메인. DOM/카메라 의존 없음. */

/** 판정 등급. 히트는 perfect/good, 놓치면 miss. */
export type Judgement = 'perfect' | 'good' | 'miss'

/** 히트로 인정된 판정만 (판정창 밖은 null로 표현) */
export type HitJudgement = Extract<Judgement, 'perfect' | 'good'>

export type Hand = 'left' | 'right'

/** 노트가 요구하는 손. 'any'는 아무 손이나 인정. */
export type NoteHand = Hand | 'any'
