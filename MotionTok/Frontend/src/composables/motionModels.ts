/**
 * 모션 인식 모델(MediaPipe) 준비 상태를 한 곳에서 다룬다.
 *
 * 모델은 게임마다 다르지만(손·포즈) 받는 시점은 게임이 아니라 <b>로비 진입</b>이다 —
 * 17MB를 게임 시작 버튼을 누른 뒤에 받으면 그때부터 기다려야 한다.
 * 그래서 로비 스플래시가 전부 받아 두고, 다른 화면은 "혹시 안 받았으면 지금 받아 둬라"만 부른다.
 *
 * 각 preload는 싱글턴이라 여러 번 불러도 다운로드는 한 번이고, 실패해도 던지지 않는다.
 * 모델이 하나 늘면 이 목록만 고치면 된다.
 */
import { isHandLandmarkerReady, preloadHandLandmarker } from './useHandLandmarker'
import { isPoseLandmarkerReady, preloadPoseLandmarker } from './usePoseLandmarker'
import type { LoadProgress } from './modelCache'

export interface MotionModel {
  /** 로딩 안내에 쓰는 이름 */
  label: string
  load: (onProgress?: LoadProgress) => Promise<boolean>
  /** 인스턴스가 이미 준비됐는지 동기 판정(-161) */
  ready: () => boolean
  /** 진행률 배분 비중 — 파일 크기 기준(손 7.8MB : 포즈 9.4MB) */
  weight: number
}

export const MOTION_MODELS: MotionModel[] = [
  { label: '손 인식', load: preloadHandLandmarker, ready: isHandLandmarkerReady, weight: 0.45 },
  { label: '자세 인식', load: preloadPoseLandmarker, ready: isPoseLandmarkerReady, weight: 0.55 },
]

/**
 * 모든 모델 인스턴스가 준비됐는지 동기로 판정한다(-161).
 *
 * 스플래시(로비)와 게임 시작 게이트(게임룸)가 "기다릴 필요가 있는가"를 판단하는 기준 —
 * sessionStorage 같은 별도 플래그로 걸면 새로고침 시(힙은 죽고 플래그는 살아남아)
 * 실제 상태와 어긋난다. 반드시 싱글턴의 실제 상태를 본다.
 */
export function motionModelsReady(): boolean {
  return MOTION_MODELS.every((m) => m.ready())
}

/**
 * 모델을 순서대로 받아 둔다.
 *
 * 동시에 받지 않는 이유 — 대역폭을 나눠 써서 둘 다 늦게 끝나고, 첫 게임에 필요한
 * 모델이 뒤로 밀릴 수 있다. 로비를 거치지 않고 들어온 경우의 보완책이라 급하지 않다.
 *
 * @param onProgress 전체(두 모델 합산) 진행률 0~1 — 게임 시작 게이트의 로딩바용
 * @returns 전부 준비됐으면 true
 */
export async function warmUpMotionModels(onProgress?: LoadProgress): Promise<boolean> {
  let ok = true
  let completed = 0
  for (const model of MOTION_MODELS) {
    if (!(await model.load((f) => onProgress?.(completed + f * model.weight)))) ok = false
    completed += model.weight
    onProgress?.(completed)
  }
  return ok
}
