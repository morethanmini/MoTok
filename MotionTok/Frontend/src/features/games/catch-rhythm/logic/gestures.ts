/**
 * 제스처 판정 — DOM/카메라 의존 없는 순수 함수 + 소형 상태 트래커.
 * 입력은 MediaPipe 정규화 랜드마크 21개.
 *
 * 슬래시(휘두르기)를 구현하지 않으므로 프로토의 palmVelocity는 가져오지 않았다.
 */

import { FIST_RATIO, FIST_CONFIRM_FRAMES } from '../core/config'

/** MediaPipe NormalizedLandmark와 구조적으로 호환되는 최소 형태. */
export interface Landmark {
  x: number
  y: number
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const TIPS = [8, 12, 16, 20]
const MCPS = [5, 9, 13, 17]
/** MediaPipe 손 랜드마크 개수 — 이보다 적으면 판정하지 않는다. */
const LANDMARK_COUNT = 21

/**
 * 주먹 여부.
 * 손가락 TIP(8,12,16,20)-손목(0) 평균 거리 < MCP(5,9,13,17)-손목 평균 거리 × FIST_RATIO.
 * 손 크기·카메라 거리에 비례하는 비율 비교라 사람마다 보정이 필요 없다.
 *
 * 랜드마크가 모자라면(트래킹 유실) false — 쥐지 않은 것으로 본다.
 */
export function isFist(landmarks: Landmark[], ratio = FIST_RATIO): boolean {
  if (landmarks.length < LANDMARK_COUNT) return false
  const wrist = landmarks[0] as Landmark
  const avgDist = (indices: number[]) =>
    indices.reduce((s, i) => s + dist(landmarks[i] as Landmark, wrist), 0) / indices.length
  return avgDist(TIPS) < avgDist(MCPS) * ratio
}

/**
 * 순간 판정 흔들림 방지: N프레임 연속 동일 상태에서만 전환을 확정한다.
 * update(raw)가 확정 상태를 반환하고, 전환이 일어난 프레임이면 justChanged가 true.
 *
 * 캐치 판정은 이 justChanged(펴짐→쥠 전환)에만 반응한다 — 쥔 채로 있으면
 * 전환이 없으므로 노트를 쓸고 다니는 플레이가 통하지 않는다.
 */
export class StableState {
  state: boolean
  justChanged = false
  private candidate: boolean
  private count = 0

  constructor(
    initial = false,
    private readonly confirmFrames = FIST_CONFIRM_FRAMES,
  ) {
    this.state = initial
    this.candidate = initial
  }

  update(raw: boolean): boolean {
    this.justChanged = false
    if (raw === this.state) {
      this.candidate = raw
      this.count = 0
      return this.state
    }
    if (raw === this.candidate) {
      this.count += 1
    } else {
      this.candidate = raw
      this.count = 1
    }
    if (this.count >= this.confirmFrames) {
      this.state = raw
      this.count = 0
      this.justChanged = true
    }
    return this.state
  }
}
