/**
 * MediaPipe Pose Landmarker 컴포저블 (게임④ 그대로 멈춰라, S15P11A706-136).
 *
 * useHandLandmarker(S15P11A706-34)와 같은 패턴: wasm·모델은 public/mediapipe/ 셀프호스팅,
 * 모델 인스턴스는 모듈 레벨 싱글턴. 전신 33개 랜드마크를 비디오 프레임마다 넘긴다.
 *
 * 차이점: onResult에 추론 소요 시간(ms)을 함께 넘긴다 — 아바타 랩(/dev/avatar-lab)이
 * MediaPipe 추론과 three.js 렌더 시간을 분리 표기해야 해서(성능 병목 판별용).
 *
 * 주의: detectForVideo는 단조 증가 타임스탬프를 요구하므로 동시에 한 소비자만 사용해야 한다.
 */
import { onBeforeUnmount, ref } from 'vue'
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { fetchModelBuffer, type LoadProgress } from './modelCache'

export type { PoseLandmarkerResult }
export type { LoadProgress }

const WASM_PATH = '/mediapipe/wasm'
// full(9MB): lite(5.5MB)보다 랜드마크가 정확·안정 — 아바타 뭉뚝함 개선 (2026-07-27 실기).
// 저사양에서 fps가 부족하면 pose_landmarker_lite.task로 되돌린다 (파일 둘 다 배치돼 있음)
const MODEL_PATH = '/mediapipe/models/pose_landmarker_full.task'

/** 모델 다운로드(9MB)에 로딩바 0~90%를 배정, 나머지는 wasm 로드 + GPU 초기화 구간. */
const MODEL_WEIGHT = 0.9

let landmarkerPromise: Promise<PoseLandmarker> | null = null
let landmarkerReady = false

/** 인스턴스가 이미 준비됐는지 동기로 알려준다(-161) — useHandLandmarker와 같은 용도. */
export function isPoseLandmarkerReady(): boolean {
  return landmarkerReady
}

/** 싱글턴 로더 — 실패하면 다음 호출에서 재시도할 수 있게 프라미스를 비운다. */
function loadLandmarker(onProgress?: LoadProgress): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const modelBuffer = await fetchModelBuffer(MODEL_PATH, MODEL_WEIGHT, onProgress)
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelBuffer, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
      landmarkerReady = true
      onProgress?.(1)
      return landmarker
    })()
    landmarkerPromise.catch(() => {
      landmarkerPromise = null
    })
  } else {
    landmarkerPromise.then(() => onProgress?.(1)).catch(() => {})
  }
  return landmarkerPromise
}

/** 게임 밖에서 모델을 미리 받아 두는 진입점. 실패해도 던지지 않는다. */
export async function preloadPoseLandmarker(onProgress?: LoadProgress): Promise<boolean> {
  try {
    await loadLandmarker(onProgress)
    return true
  } catch {
    return false
  }
}

export function usePoseLandmarker() {
  const isLoading = ref(false)
  const isRunning = ref(false)
  const error = ref<string | null>(null)
  let rafId = 0
  let stopped = true

  async function preload(): Promise<boolean> {
    try {
      isLoading.value = true
      await loadLandmarker()
      return true
    } catch {
      error.value = '포즈 인식 모델을 불러오지 못했어요'
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
    onResult: (result: PoseLandmarkerResult, inferenceMs: number) => void,
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
        const t0 = performance.now()
        const result = landmarker.detectForVideo(video, t0)
        onResult(result, performance.now() - t0)
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
