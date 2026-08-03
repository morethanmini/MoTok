/**
 * 모션 낚시 안내 그림 공용 색.
 *
 * 색은 실제 게임(fishing/render/skins/cozy.ts)에서 그대로 가져왔다. 물 그라데이션 네 단계가
 * 곧 깊이 표시라, 그림에서도 같은 네 색을 쓴다 — 아이가 "아래로 갈수록 진해진다"를
 * 그림에서 익히면 게임 화면에서 그대로 통한다.
 */

export const VIEW_W = 320
export const VIEW_H = 220

export const INK = '#38263d'
export const PAPER = '#fffaf0'
export const MINT = '#48c8a4'
export const CORAL = '#ef6872'
export const YELLOW = '#ffc83d'

export const SKY_TOP = '#eaf7ff'
export const SKY_BOT = '#cfe8ff'
/** 물 — 위에서 아래로. 이 네 색이 깊이 층 네 개와 짝이다. */
export const WATER = ['#9fdcf0', '#5fb2d6', '#2e7aa6', '#1f5d85']
export const SAND = '#e3cf96'
export const SAND_DARK = '#c9ad72'
export const BOAT = '#c9945f'
export const BOAT_RIM = '#9a6a3f'

export const SKIN = '#f6cfa8'
export const SKIN_EDGE = '#8d5c38'

/**
 * 화면을 두 칸으로 나눈다 — 위는 낚시터(무슨 일이 일어나는가), 아래는 내 손(무엇을 하는가).
 *
 * 손을 낚시터 위에 그냥 얹으면 <b>손이 물속에 잠긴 것처럼 보인다</b>(첫 시안이 그랬다).
 * 실제로도 카메라 화면은 낚시터와 따로 구석에 뜨므로, 칸을 갈라 두는 쪽이 화면과도 맞는다.
 * 물 이야기만 하는 장(깊이별 물고기)은 나누지 않고 낚시터가 전체를 쓴다.
 */
export const FULL = { waterY: 74, sandY: 196 }
export const SPLIT = { waterY: 30, sandY: 118, deckY: 130 }

/** 깊이 층 4개의 경계 y(수면 → 바닥, 5개). 낚시터 높이에 맞춰 균등 분할한다. */
export function bandEdges(g: { waterY: number; sandY: number }): number[] {
  const h = (g.sandY - g.waterY) / 4
  return [0, 1, 2, 3, 4].map((i) => g.waterY + h * i)
}

/** 물고기 한 마리 — 몸통 타원 + 꼬리 삼각형. 크기만 바꿔 큰 고기·작은 고기를 그린다. */
export function fishPath(cx: number, cy: number, len: number, dir: 1 | -1 = 1): string {
  const h = len * 0.46
  const tail = len * 0.34
  return [
    `M ${cx - (dir * len) / 2} ${cy}`,
    `Q ${cx} ${cy - h / 2} ${cx + (dir * len) / 2} ${cy}`,
    `Q ${cx} ${cy + h / 2} ${cx - (dir * len) / 2} ${cy}`,
    'Z',
    `M ${cx - (dir * len) / 2} ${cy}`,
    `L ${cx - dir * (len / 2 + tail)} ${cy - h * 0.55}`,
    `L ${cx - dir * (len / 2 + tail)} ${cy + h * 0.55}`,
    'Z',
  ].join(' ')
}
