/**
 * 별따라 손따라 안내 그림 공용 좌표·색.
 *
 * 별 위치는 눈대중이 아니라 "두 손의 손가락 끝"에서 역산한 값이다 — STARS를 손끝
 * 좌표 그대로 쓰기 때문에 어느 장에서 손을 그리든 손끝과 별이 항상 맞물린다.
 * (엄지 2개는 별이 없다. 별자리는 5~8개라 8개짜리에선 엄지가 남는데, 실제 게임의
 *  그리디 매칭도 남는 손가락을 그냥 두므로 이쪽이 맞다 — finger-star/logic.ts 참고)
 *
 * 색은 실제 게임 화면(FingerStarGame.vue)의 값을 그대로 옮겼다. 아이가 그림을 보고
 * 게임에 들어갔을 때 같은 색이 보여야 "그 그림"이라고 알아본다.
 */

/** 모든 안내 그림이 공유하는 viewBox — 카드/모달에서 비율이 어긋나지 않게 고정. */
export const VIEW_W = 320
export const VIEW_H = 220

export interface Pt {
  x: number
  y: number
}

/** 손바닥 중심. 손목은 여기서 아래로 화면 밖까지 이어진다. */
export const PALM_L: Pt = { x: 96, y: 188 }
export const PALM_R: Pt = { x: 226, y: 188 }

/**
 * 엄지→새끼 순. 손바닥 중심에서 이 점까지가 손가락 한 개.
 *
 * 두 손을 130px 떼어 놓고 손끝을 넓게 벌린 값이다 — 이보다 좁히면 별(반지름 9)끼리
 * 붙어서 별자리가 별 하나의 덩어리로 보인다. 이웃 별 간격을 최소 33px로 잡았다.
 * 중지가 가장 길고 엄지·새끼가 짧은 것도 실제 손 비율이라 그대로 뒀다.
 */
export const TIPS_L: Pt[] = [
  { x: 54, y: 178 }, // 엄지 — 별 없음
  { x: 58, y: 144 }, // 검지
  { x: 84, y: 120 }, // 중지
  { x: 112, y: 138 }, // 약지
  { x: 134, y: 164 }, // 새끼
]
export const TIPS_R: Pt[] = [
  { x: 268, y: 178 }, // 엄지 — 별 없음
  { x: 264, y: 144 }, // 검지
  { x: 238, y: 120 }, // 중지
  { x: 210, y: 138 }, // 약지
  { x: 188, y: 164 }, // 새끼
]

/** 별 반지름 — 간격(최소 33px)의 절반보다 작아야 붙어 보이지 않는다. */
export const STAR_R = 9

/**
 * 별자리 = 엄지를 뺀 손끝 8개를 왼쪽에서 오른쪽으로 이은 것.
 * 배열 순서 = 안내선이 이어지는 순서(실제 게임 constellations.ts와 같은 규칙).
 */
export const STARS: Pt[] = [
  TIPS_L[1]!,
  TIPS_L[2]!,
  TIPS_L[3]!,
  TIPS_L[4]!,
  TIPS_R[4]!,
  TIPS_R[3]!,
  TIPS_R[2]!,
  TIPS_R[1]!,
]

/** 손가락 끝 색 — 게임의 FINGER_COLORS(R1~R5 / L1~L5)와 같은 값. 엄지→새끼 순. */
export const TIP_COLORS_L = ['#FF9F5D', '#FF5DE0', '#5DFFC6', '#5D8CFF', '#FFEA5D']
export const TIP_COLORS_R = ['#FF5D73', '#FFD23F', '#C6FF5E', '#3ddcff', '#B98CFF']

/** 게임 화면 팔레트. */
export const SKY_TOP = '#182a55'
export const SKY_BOTTOM = '#070b1a'
export const LINE = '#C6FF5E'
export const GOLD = '#FFD23F'
export const TIMER = '#FF5D73'

/** 살색 — 굵은 선을 두 번 그려 테두리를 내므로 두 값이 짝이다. */
export const SKIN = '#f6cfa8'
export const SKIN_EDGE = '#8d5c38'

/** 점들을 순서대로 잇는 path("M x y L x y ..."). */
export function pathOf(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
}

/** 별자리 선 path. */
export const STAR_PATH = pathOf(STARS)

/**
 * 5장(완성 목록)에 쓰는 <b>두 번째</b> 별자리 — 실제 게임의 별자리는 판마다 바뀌는데
 * 완성 카드 세 장이 전부 같은 모양이면 "여러 개 만들었다"가 아니라 "같은 걸 세 번 그렸다"로
 * 읽힌다. 손끝에서 역산한 좌표가 아니라(손을 그리지 않는 자리다) 눈에 띄게 다른 모양을
 * 고른 것뿐이다 — 납작한 M자인 STARS와 달리 둥근 고리다.
 */
export const STARS_B: Pt[] = [
  { x: 40, y: 96 },
  { x: 34, y: 40 },
  { x: 92, y: 16 },
  { x: 150, y: 44 },
  { x: 168, y: 100 },
  { x: 104, y: 128 },
]
/**
 * 닫지 않는다(Z 없음) — 이으면 정오각형처럼 보여서 별자리가 아니라 도형이 된다.
 * 간격을 일부러 고르지 않게 둔 것도 같은 이유다.
 */
export const STAR_PATH_B = pathOf(STARS_B)

/**
 * 별자리를 (cx, cy) 중심에 target px 크기로 맞춰 얹는다.
 *
 * 배율을 밖에서 정하지 않고 여기서 계산하는 이유 — 모양마다 폭이 달라서, 같은 배율을 쓰면
 * 카드마다 별자리 크기가 들쭉날쭉해진다. 긴 변을 기준으로 맞추므로 세로로 긴 모양도 넘치지 않는다.
 * 배율을 함께 돌려주는 건 별 크기·선 굵기를 화면 기준으로 되돌리기 위한 것이다
 * (그대로 두면 작게 축소된 별자리의 별만 커 보인다).
 */
export function fitMini(
  pts: Pt[],
  cx: number,
  cy: number,
  target: number,
): { transform: string; scale: number } {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = target / Math.max(maxX - minX, maxY - minY)
  return {
    transform: `translate(${cx - ((minX + maxX) / 2) * scale} ${cy - ((minY + maxY) / 2) * scale}) scale(${scale})`,
    scale,
  }
}

/** 꼭짓점 5개짜리 별 path. 아이가 "별"이라고 바로 알아보는 모양이 이것뿐이라 이걸 쓴다. */
export function star5(cx: number, cy: number, r: number): string {
  const d: string[] = []
  for (let i = 0; i < 10; i++) {
    const rad = ((-90 + i * 36) * Math.PI) / 180
    const rr = i % 2 ? r * 0.45 : r
    d.push(
      `${i ? 'L' : 'M'} ${(cx + rr * Math.cos(rad)).toFixed(2)} ${(cy + rr * Math.sin(rad)).toFixed(2)}`,
    )
  }
  return `${d.join(' ')} Z`
}

/** 배경 잔별 — 별자리·손과 겹치지 않는 위쪽 하늘에만 뿌린다. */
export const SPECKS: (Pt & { r: number })[] = [
  { x: 34, y: 38, r: 1.6 },
  { x: 68, y: 66, r: 1.1 },
  { x: 104, y: 30, r: 1.9 },
  { x: 146, y: 58, r: 1.2 },
  { x: 186, y: 34, r: 1.5 },
  { x: 226, y: 62, r: 1.1 },
  { x: 264, y: 28, r: 1.8 },
  { x: 290, y: 70, r: 1.3 },
  { x: 50, y: 96, r: 1.1 },
  { x: 276, y: 100, r: 1.2 },
]
