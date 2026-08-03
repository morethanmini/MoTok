/**
 * 그림으로 말해요 안내 그림 공용 색·모양.
 *
 * 색은 실제 게임 화면(DrawingRelayGame.vue)에서 그대로 가져왔다 — 도화지·잉크·주제어 띠·
 * 펜 커서·지우개 커서. 아이가 그림을 보고 게임에 들어갔을 때 같은 색이 보여야 알아본다.
 *
 * 고양이 그림을 세 조각으로 나눠 둔 이유: 3장(이어 그리기)에서는 머리까지만, 6장(채점)에서는
 * 전부 보여 준다. 같은 그림이 자라나야 "여럿이 하나를 이어 그린다"가 그림만으로 읽힌다.
 */

export const VIEW_W = 320
export const VIEW_H = 220

/** 책상 · 도화지 · 잉크 — DrawingRelayGame의 PAPER_COLOR/PEN_COLOR와 같은 값. */
export const DESK = '#efe9dc'
export const PAPER = '#fdfdf8'
export const INK = '#26262e'
/** 주제어 띠(게임 상단 바)와 강조. */
export const GOLD = '#ffd23f'
/** 펜 커서(그리는 중) · 지우개 커서 — 게임에서 손끝에 뜨는 색. */
export const PEN_CURSOR = '#e0642f'
export const ERASER = '#ff5d73'
/** 남은 시간 막대. */
export const TIME_FILL = '#7fbf6c'

export const SKIN = '#f6cfa8'
export const SKIN_EDGE = '#8d5c38'
/** 화가 세 명을 구분하는 옷 색 — 순서를 색으로 따라갈 수 있게 장마다 같은 색을 쓴다. */
export const PAINTER_COLORS = ['#e0642f', '#5b8fd6', '#7fbf6c']

// ── 다 같이 그리는 고양이 ────────────────────────
// 아래 좌표는 140x120 상자 기준이다. 놓을 자리·크기는 쓰는 쪽에서 transform으로 정한다.

/** 1) 머리와 귀 — 첫 화가가 그린 만큼. */
export const CAT_HEAD =
  'M 22 45 a 28 28 0 1 0 56 0 a 28 28 0 1 0 -56 0 M 30 24 L 27 3 L 49 17 M 70 24 L 73 3 L 51 17'
/** 2) 얼굴 — 코와 수염(눈은 점이라 따로 찍는다). */
export const CAT_FACE =
  'M 45 53 L 50 58 L 55 53 M 14 48 L 33 51 M 14 58 L 33 56 M 86 48 L 67 51 M 86 58 L 67 56'
/** 눈 위치(반지름은 쓰는 쪽에서). */
export const CAT_EYES = [
  { x: 40, y: 41 },
  { x: 60, y: 41 },
]
/** 3) 몸통과 꼬리 — 마지막 화가가 채운 만큼. */
export const CAT_BODY =
  'M 32 66 Q 26 106 62 108 L 94 108 Q 116 106 111 83 Q 105 65 76 65 M 111 86 Q 136 82 129 52'

/**
 * 고양이를 (cx, cy) 중심에 s배로 얹는 transform.
 * 140x120 상자의 중심이 (70, 56)이다 — 귀가 위로 튀어나와 세로 중심이 상자 한가운데가 아니다.
 */
export function catAt(cx: number, cy: number, s: number): string {
  return `translate(${cx - 70 * s} ${cy - 56 * s}) scale(${s})`
}
