/**
 * MediaPipe 결과 → 게임 좌표 손 상태. 순수 모듈 — MediaPipe 타입에 의존하지 않는다
 * (호출부가 HandLandmarkerResult를 HandFrame으로 옮겨 준다).
 *
 * 게임 좌표: 화면 중앙 원점, y ∈ [-1, 1] (위가 +), x는 같은 스케일로 종횡비만큼 확장
 * (16:9면 x ∈ [-1.78, 1.78]). 셀피 카메라라 x는 미러링한다 — 화면 오른쪽이 +x.
 *
 * 모델 초기화는 앱 공용 useHandLandmarker 싱글턴이 담당하고 여기서는 변환만 한다.
 */

import { StableState, isFist, type Landmark } from '../logic/gestures'
import type { Hands, HandState } from '../logic/catchLogic'
import type { Hand } from '../core/types'

/** 한 프레임의 손 인식 결과 — MediaPipe HandLandmarkerResult에서 필요한 것만. */
export interface HandFrame {
  /** 손별 랜드마크 21개 */
  landmarks: Landmark[][]
  /** 손별 판정 라벨('Left' | 'Right'). landmarks와 같은 순서. */
  handedness: string[]
}

export interface Point {
  x: number
  y: number
}

/** 정규화 좌표(x, y ∈ [0,1], 좌상단 원점) → 게임 좌표. 미러링 포함. */
export function toGameCoords(nx: number, ny: number, aspect: number): Point {
  return {
    x: (0.5 - nx) * 2 * aspect, // 미러링: 화면 오른쪽 = +x
    y: (0.5 - ny) * 2, // 위가 +
  }
}

/** 손바닥 중심 = 손목(0) + 양쪽 MCP(5, 17)의 평균. 손가락을 접어도 잘 안 흔들린다. */
export function palmCenter(landmarks: Landmark[]): Point {
  const p0 = landmarks[0]
  const p5 = landmarks[5]
  const p17 = landmarks[17]
  if (!p0 || !p5 || !p17) return { x: 0.5, y: 0.5 }
  return { x: (p0.x + p5.x + p17.x) / 3, y: (p0.y + p5.y + p17.y) / 3 }
}

/**
 * MediaPipe 라벨 → 우리 손 구분.
 * 원본(비미러) 프레임을 넣으면 라벨이 실제 손과 그대로 일치한다 — 프로토 실플레이로 검증된 사항.
 */
function sideOf(label: string | undefined): Hand {
  return label === 'Left' ? 'left' : 'right'
}

/**
 * 프레임마다 update를 호출하면 판정 로직이 먹는 Hands를 돌려준다.
 * grabbed는 "펴짐→쥠" 전환 프레임에만 true — 쥔 채로 쓸고 다니는 플레이를 막는다.
 */
export class HandInputTracker {
  private fists: Record<Hand, StableState> = {
    left: new StableState(false),
    right: new StableState(false),
  }
  /** 렌더링용 확정 쥠 상태 (커서 모양) */
  readonly isFisted: Record<Hand, boolean> = { left: false, right: false }

  update(frame: HandFrame, aspect: number): Hands {
    const seen: Record<Hand, Landmark[] | null> = { left: null, right: null }
    for (let i = 0; i < frame.landmarks.length; i++) {
      const lm = frame.landmarks[i]
      if (!lm) continue
      seen[sideOf(frame.handedness[i])] = lm
    }

    const hands: Hands = { left: null, right: null }
    for (const side of ['left', 'right'] as Hand[]) {
      const lm = seen[side]
      if (!lm) {
        // 손이 사라지면 상태를 새로 시작한다 — 유령 전환 방지
        this.fists[side] = new StableState(false)
        this.isFisted[side] = false
        continue
      }
      const stable = this.fists[side]
      const fisted = stable.update(isFist(lm))
      this.isFisted[side] = fisted

      const palm = palmCenter(lm)
      const { x, y } = toGameCoords(palm.x, palm.y, aspect)
      const state: HandState = { x, y, grabbed: stable.justChanged && fisted }
      hands[side] = state
    }
    return hands
  }

  /** 라운드 사이 초기화 */
  reset(): void {
    this.fists = { left: new StableState(false), right: new StableState(false) }
    this.isFisted.left = false
    this.isFisted.right = false
  }
}
