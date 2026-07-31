/**
 * 게임⑤ 낚시 — 어깨 너비 정규화 (S15P11A706-10).
 *
 * 모든 판정 문턱을 **어깨 너비 배수**로 표현하기 위한 분모를 만든다.
 *
 * ── 왜 필요한가 ──
 * 문턱을 캔버스 px로 두면 카메라에서 멀어질 때 같은 동작이 작고 느리게 측정된다. 실측
 * (2026-07-30)에서 어깨 너비가 204px → 123px(1.67배)로 줄었을 때 스윙 속도도 1888 → 1201px/s
 * (1.72배)로 거의 정확히 같은 비율로 줄었다. 즉 어깨 너비로 나누면 거리 의존이 사라진다.
 *
 * ── 왜 중앙값인가 ──
 * 같은 자리에 앉아 있어도 어깨 너비 관측값이 141~189px로 흔들린다(같은 세션 내 최소/최대).
 * 몸을 돌리면 실제로 짧아 보이고, 멀리 앉으면 랜드마크 지터 비중이 커진다 — 원거리에서
 * 관측 변동이 33~54%까지 갔다. 매 프레임 raw 값을 분모로 쓰면 문턱이 그만큼 떨린다.
 *
 * 반면 **세션 평균은 극히 안정적이다**: 3회 반복에서 148 / 149 / 151px(±1%). 흔들리는 건
 * 개별 프레임이고 중심값은 단단하다는 뜻이라, 창 안의 중앙값을 쓰면 이상치에 안 흔들리면서
 * 자세 변화는 1초 안에 따라간다. 평균이 아니라 중앙값인 이유는 튀는 프레임 한 개가 평균은
 * 끌어당기지만 중앙값은 못 움직이기 때문이다.
 */

/** 중앙값 창 크기(프레임) — 30fps에서 약 1초 */
const WINDOW = 30
/** 이만큼 모이기 전에는 분모를 신뢰하지 않는다 */
const MIN_SAMPLES = 10

export interface Normalizer {
  /** 이번 프레임의 어깨 너비(px). 어깨를 못 본 프레임에는 호출하지 않는다 */
  push(px: number): void
  /** 정규화 분모(px) — 창 안의 중앙값. 표본이 없으면 0 */
  sw(): number
  /** 문턱 판정을 시작해도 되는지 */
  ready(): boolean
  reset(): void
}

export function createNormalizer(): Normalizer {
  let buf: number[] = []
  /** 마지막으로 계산한 중앙값 — 매 프레임 정렬하지 않도록 캐시한다 */
  let cached = 0
  let dirty = false

  return {
    push(px) {
      if (!(px > 0)) return
      buf.push(px)
      if (buf.length > WINDOW) buf.shift()
      dirty = true
    },

    sw() {
      if (buf.length === 0) return 0
      if (dirty) {
        const s = [...buf].sort((a, b) => a - b)
        const mid = s.length >> 1
        cached = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
        dirty = false
      }
      return cached
    },

    ready() {
      return buf.length >= MIN_SAMPLES
    },

    reset() {
      buf = []
      cached = 0
      dirty = false
    },
  }
}

/**
 * 조준 이득 — 몸 중심에서 이만큼(어깨너비 배수) 벗어나면 화면 끝.
 *
 * 조준은 오랫동안 이 파일의 규칙에서 빠져 있었다. 손 중점 x를 카메라 프레임 x 그대로 화면 x에
 * 썼는데, 2~3m 거리에서 사람 손은 프레임 좌우 끝까지 못 간다 — 조준 랩 실측에서 **화면 폭의
 * 46%만** 덮었다(도달 offSw -0.87~0.76, 프레임 17~63%).
 *
 * 0.75를 고른 이유: 실측 도달이 좌우 비대칭이었다(왼쪽 0.87 / 오른쪽 0.76). 큰 쪽에 맞추면
 * 약한 쪽 끝에 닿지 못하므로 **작은 쪽(0.76)보다 살짝 낮게** 잡아 양쪽 끝이 다 닿게 한다.
 * 랩의 권장값 0.79는 큰 쪽 기준이라 오른쪽이 아슬아슬하다.
 */
export const AIM_SPAN_SW = 0.75

/**
 * 손 중점 x를 조준 x(캔버스 px)로.
 *
 * @param handMidX 양손 손목 중점 x (캔버스 px)
 * @param bodyMidX 어깨 중점 x (캔버스 px) — 조준 0의 기준
 * @param sw       어깨 너비(px). 0이면 화면 중앙을 돌려준다
 * @param width    무대 폭(px)
 */
export function aimFromHands(
  handMidX: number,
  bodyMidX: number,
  sw: number,
  width: number,
): number {
  if (!(sw > 0)) return width / 2
  const offSw = (handMidX - bodyMidX) / sw
  const x = width / 2 + (offSw / AIM_SPAN_SW) * (width / 2)
  return Math.min(width, Math.max(0, x))
}

/** MediaPipe Pose 어깨 랜드마크 인덱스 */
export const SHOULDER = { left: 11, right: 12 } as const
/** MediaPipe Pose 손목 랜드마크 인덱스 */
export const WRIST = { left: 15, right: 16 } as const
/** 이 값 미만이면 랜드마크를 못 본 것으로 취급 */
export const VIS_MIN = 0.5
