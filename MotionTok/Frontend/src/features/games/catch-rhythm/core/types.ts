/** 캐치캐치리듬 공용 타입 — 순수 도메인. DOM/카메라 의존 없음. */

/** 판정 등급. 히트는 perfect/good, 놓치면 miss. */
export type Judgement = 'perfect' | 'good' | 'miss'

/** 히트로 인정된 판정만 (판정창 밖은 null로 표현) */
export type HitJudgement = Extract<Judgement, 'perfect' | 'good'>

export type Hand = 'left' | 'right'

/** 노트가 요구하는 손. 'any'는 아무 손이나 인정. */
export type NoteHand = Hand | 'any'

/**
 * 노트 종류. **swipe가 주력**이고 catch는 가끔 나오는 특수 노트다
 * (주먹 쥐기를 주력으로 두면 인식률·피로도 때문에 게임이 안 된다 — 실플레이 결론).
 *
 * - swipe: 손이 **지나가기만 해도** 된다(쥠 여부 무관). 판정창 안에 손이 들어오면 히트
 * - trail: 경로를 **손으로 쭉 따라 그리는** 노트. 커버리지 비율로 판정
 * - catch: 노트 위에서 **주먹을 쥐어야** 한다(펴짐→쥠 전환 순간만 인정) — 특수 노트
 */
export type NoteKind = 'swipe' | 'trail' | 'catch'

/**
 * 플레이 모드.
 * - catch: 화면 아무 곳에나 뜨는 노트를 손으로 잡는다(기본)
 * - ring: 마이마이식 — 중심에서 링으로 밀려 나오는 노트를 레인 위치에서 받는다
 */
export type GameMode = 'catch' | 'ring'
