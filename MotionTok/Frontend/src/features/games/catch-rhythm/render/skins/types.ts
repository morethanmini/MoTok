/**
 * 스킨 인터페이스 — 노트 모양 / 터지는 모션 / 커서 / 효과음을 게임 로직과 완전히 분리한다.
 * 로직은 스킨을 모른다. 렌더러가 현재 스킨의 메서드를 호출할 뿐이다.
 *
 * 좌표는 전부 캔버스 픽셀 — 게임 좌표 변환은 렌더러가 끝내고 넘긴다.
 */

import type { Hand, Judgement, NoteHand, NoteKind } from '../../core/types'

export interface NoteView {
  x: number
  y: number
  /** 지금 그릴 노트 본체 반지름(px) — scale이 반영된 값 */
  radius: number
  /**
   * 판정 시점의 반지름(px). 고정값이라 "여기까지 오면 치는 것"을 보여주는 기준선이 된다.
   * 접근 링은 이 크기로 수렴한다.
   */
  judgeRadius: number
  /** 0(원경) → 1(판정 지점). 1을 넘으면 판정선을 지난 것 */
  scale: number
  /** 진행도 그대로 — 접근 링 계산용(1에서 판정) */
  progress: number
  hand: NoteHand
  kind: NoteKind
  /** 반대편 영역에서 온 크로스 노트인가 (기본 스킨은 시각 구분하지 않는다) */
  cross: boolean
  /** trail 전용 — 시작점 포함 경로(px) */
  path?: { x: number; y: number }[]
  /** trail 전용 — 지금 따라가야 할 지점(px). 추적 중일 때만 있다 */
  head?: { x: number; y: number }
  /** trail 전용 — 헤드를 잡고 따라가는 중인가 */
  tracing?: boolean
}

export interface HitFxView {
  x: number
  y: number
  radius: number
  judgement: Judgement
  hand: Hand
  elapsedMs: number
  /** 이펙트 전체 수명(ms) — 스킨이 진행도를 계산할 때 쓴다 */
  lifeMs: number
  /** 이 히트로 도달한 콤보. 큰 콤보일수록 연출을 키우라는 힌트 */
  combo: number
}

export interface HandView {
  /** 손바닥 중심(px) */
  x: number
  y: number
  /** 판정 반경(px) */
  radius: number
  isFist: boolean
  side: Hand
  /**
   * MediaPipe 21개 랜드마크를 캔버스 픽셀로 옮긴 것. 손 전체를 그리는 데 쓴다.
   * 트래킹이 불완전하면 빈 배열일 수 있다.
   */
  landmarks: { x: number; y: number }[]
}

/** 절차 합성 효과음 스펙 — 음원 파일 없이 WebAudio로 만든다. */
export interface ToneSpec {
  type: OscillatorType
  /** 시작 주파수(Hz) */
  freq: number
  /** 있으면 durationMs 동안 이 주파수로 미끄러진다 */
  sweepTo?: number
  durationMs: number
  /** 0~1 */
  gain: number
}

export interface CatchSkin {
  id: string
  label: string
  /** 캔버스 배경. 생략하면 렌더러가 투명 처리(뒤 화면이 비친다). */
  drawBackground?(ctx: CanvasRenderingContext2D, w: number, h: number, tMs: number): void
  drawNote(ctx: CanvasRenderingContext2D, note: NoteView): void
  /** 히트/미스 이펙트. false를 반환하면 수명 종료 → 렌더러가 제거한다. */
  drawHitFx(ctx: CanvasRenderingContext2D, fx: HitFxView): boolean
  drawCursor(ctx: CanvasRenderingContext2D, hand: HandView): void
  sfx: Record<Judgement, ToneSpec | null>
}

/** MediaPipe 손 랜드마크 연결(뼈대) — 스킨이 손을 그릴 때 공용으로 쓴다. */
export const HAND_BONES: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // 엄지
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // 검지
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // 중지
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // 약지
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // 새끼
  [0, 17], // 손바닥 아래
]
