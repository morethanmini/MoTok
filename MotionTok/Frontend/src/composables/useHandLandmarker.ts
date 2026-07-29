/**
 * MediaPipe Hand Landmarker 컴포저블 (모션 인식 공통 모듈, S15P11A706-34).
 *
 * wasm·모델은 외부 CDN 대신 public/mediapipe/ 에서 셀프호스팅으로 로드한다.
 * 모델 인스턴스는 모듈 레벨 싱글턴 — 첫 게임에서 한 번만 로드하고 재입장 시 즉시 시작된다.
 *
 * 사용 (예):
 *   const hand = useHandLandmarker()
 *   await hand.start(videoEl, (result) => { ... })  // 새 비디오 프레임마다 호출
 *   hand.stop()
 *
 * 주의: detectForVideo는 단조 증가 타임스탬프를 요구하므로 동시에 한 소비자만 사용해야 한다
 * (게임룸에서는 자기 영상 하나만 분석하므로 충족).
 */
import { onBeforeUnmount, ref } from 'vue'
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { fetchModelBuffer, type LoadProgress } from './modelCache'

export type { HandLandmarkerResult }
export type { LoadProgress }

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/hand_landmarker.task'

/**
 * 모델 다운로드(7.5MB)가 로딩 시간의 대부분이라 로딩바의 0~90%를 여기에 배정하고,
 * 나머지 90~100%는 wasm 로드 + GPU 초기화(진행률을 잴 수 없는 구간)에 남겨 둔다.
 */
const MODEL_WEIGHT = 0.9

let landmarkerPromise: Promise<HandLandmarker> | null = null
let landmarkerReady = false

/**
 * 인스턴스가 이미 준비됐는지 동기로 알려준다(-161) — 스플래시·게임 시작 게이트가
 * "지금 바로 시작해도 되는가"를 프라미스 없이 판정할 때 쓴다.
 */
export function isHandLandmarkerReady(): boolean {
  return landmarkerReady
}

/** 싱글턴 로더 — 실패하면 다음 호출에서 재시도할 수 있게 프라미스를 비운다. */
function loadLandmarker(onProgress?: LoadProgress): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      // 모델은 우리가 직접 받아 진행률을 재고(버퍼로 주입 → MediaPipe가 재다운로드하지 않음),
      // wasm 로드·GPU 초기화가 끝나면 100%로 마무리한다.
      const modelBuffer = await fetchModelBuffer(MODEL_PATH, MODEL_WEIGHT, onProgress)
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelBuffer, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      })
      landmarkerReady = true
      onProgress?.(1)
      return landmarker
    })()
    landmarkerPromise.catch(() => {
      landmarkerPromise = null
    })
  } else {
    // 이미 로드됐거나 다른 소비자가 로딩 중 — 완료되는 순간 100%로 신호만 준다.
    landmarkerPromise.then(() => onProgress?.(1)).catch(() => {})
  }
  return landmarkerPromise
}

/**
 * 게임 밖(로비 스플래시 등)에서 모델을 미리 받아 두는 진입점.
 * 성공 여부만 돌려주고, 실패해도 던지지 않는다 — 호출부가 로딩을 막지 않고 넘어갈 수 있게.
 */
export async function preloadHandLandmarker(onProgress?: LoadProgress): Promise<boolean> {
  try {
    await loadLandmarker(onProgress)
    return true
  } catch {
    return false
  }
}

export function useHandLandmarker() {
  const isLoading = ref(false)
  const isRunning = ref(false)
  const error = ref<string | null>(null)
  let rafId = 0
  let stopped = true

  /** 게임 진입 전에 미리 호출하면 첫 라운드 시작이 빨라진다(선택). */
  async function preload(): Promise<boolean> {
    try {
      isLoading.value = true
      await loadLandmarker()
      return true
    } catch {
      error.value = '손 인식 모델을 불러오지 못했어요'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 인식 루프 시작. video의 새 프레임이 들어올 때마다 onResult를 호출한다
   * (RAF 주기가 아닌 비디오 fps 기준 — 같은 프레임을 중복 분석하지 않는다).
   */
  async function start(
    video: HTMLVideoElement,
    onResult: (result: HandLandmarkerResult) => void,
  ): Promise<boolean> {
    stop()
    if (!(await preload())) return false

    const landmarker = await loadLandmarker()
    stopped = false
    isRunning.value = true
    let lastVideoTime = -1

    const loop = () => {
      if (stopped) return
      rafId = requestAnimationFrame(loop)
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime
      try {
        onResult(landmarker.detectForVideo(video, performance.now()))
      } catch {
        /* 일시적 프레임 처리 오류는 다음 프레임에서 회복 */
      }
    }
    loop()
    return true
  }

  function stop() {
    stopped = true
    isRunning.value = false
    cancelAnimationFrame(rafId)
  }

  onBeforeUnmount(stop)

  return { isLoading, isRunning, error, preload, start, stop }
}
