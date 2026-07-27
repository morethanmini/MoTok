/**
 * 스킨 인터페이스 — 노트 모양 / 터지는 모션 / 커서 / 효과음을 게임 로직과 완전히 분리한다.
 * 로직은 스킨을 모른다. 렌더러가 현재 스킨의 메서드를 호출할 뿐이다.
 *
 * 새 스킨 = 파일 하나 추가 + 레지스트리 등록. 시즌·이벤트 스킨, 상점 아이템 연동(-56)까지 열린다.
 * 좌표는 전부 캔버스 픽셀 — 게임 좌표 변환은 렌더러가 끝내고 넘긴다.
 */

import type { Hand, Judgement } from '../../core/types'

export interface NoteView {
  x: number
  y: number
  /** 판정 크기 기준 반지름(px). scale이 이미 반영된 값. */
  radius: number
  /** 0(원경) → 1(판정 지점) */
  scale: number
  hand: Hand
  /** 반대편 영역에서 온 크로스 노트인가 (기본 스킨은 시각 구분하지 않는다) */
  cross: boolean
}

export interface HitFxView {
  x: number
  y: number
  radius: number
  judgement: Judgement
  hand: Hand
  /** 이펙트 시작 후 경과 시간 */
  elapsedMs: number
}

export interface HandView {
  x: number
  y: number
  radius: number
  isFist: boolean
  side: Hand
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
