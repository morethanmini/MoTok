/**
 * MediaPipe Face Detector 컴포저블 — 가면 아이템을 얼굴에 붙이는 데 쓴다.
 *
 * 손·자세와 같은 규칙을 따른다: wasm·모델은 public/mediapipe/ 셀프호스팅, 인스턴스는
 * 모듈 레벨 싱글턴, 실패해도 던지지 않는다.
 *
 * 랜드마크(478점)가 아니라 <b>검출기</b>(BlazeFace, 눈·코·입·귀 6점)를 쓰는 이유 —
 * 가면을 얹는 데 필요한 건 두 눈의 위치뿐이고, 모델이 0.2MB vs 3.7MB다.
 *
 * <b>로비에서 미리 받지 않는다</b>(MOTION_MODELS에 넣지 않는다). 그 목록은 게임 시작 게이트가
 * 쓰는 것이라, 하나라도 실패하면 {@code gamePrep.failed}로 게임이 아예 안 뜬다 — 꾸미기 모델
 * 하나 때문에 게임을 못 하게 되는 건 맞바꿀 만한 거래가 아니다. 대신 가면을 장착한 사람이
 * 화면에 들어올 때 받는다. 0.2MB인 데다 wasm 파일셋은 손·자세와 같은 것을 공유해 이미 떠 있다.
 *
 * 주의: detectForVideo는 단조 증가 타임스탬프를 요구하므로 동시에 한 소비자만 쓴다
 * (가면을 쓰는 화면은 언제나 하나 — 인벤토리·장치 설정·게임룸 셀프 타일).
 */
import { onBeforeUnmount, ref } from 'vue'
import { FaceDetector, FilesetResolver, type FaceDetectorResult } from '@mediapipe/tasks-vision'
import { fetchModelBuffer, type LoadProgress } from './modelCache'

export type { FaceDetectorResult }

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/blaze_face_short_range.tflite'

/** 모델이 0.2MB라 다운로드는 순식간이고 wasm 로드·GPU 초기화가 대부분이다. */
const MODEL_WEIGHT = 1

let detectorPromise: Promise<FaceDetector> | null = null

/** 싱글턴 로더 — 실패하면 다음 호출에서 재시도할 수 있게 프라미스를 비운다. */
function loadDetector(onProgress?: LoadProgress): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const modelBuffer = await fetchModelBuffer(MODEL_PATH, MODEL_WEIGHT, onProgress)
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: modelBuffer, delegate: 'GPU' },
        runningMode: 'VIDEO',
      })
      onProgress?.(1)
      return detector
    })()
    detectorPromise.catch(() => {
      detectorPromise = null
    })
  } else {
    detectorPromise.then(() => onProgress?.(1)).catch(() => {})
  }
  return detectorPromise
}

export function useFaceDetector() {
  const isLoading = ref(false)
  const isRunning = ref(false)
  const error = ref<string | null>(null)
  let rafId = 0
  let stopped = true
  /**
   * start() 호출마다 올라가는 번호. 모델을 받는 동안(await) stop()이나 다음 start()가 끼어들면
   * 이 값이 달라지므로, 뒤늦게 깨어난 쪽은 루프를 켜지 않고 조용히 물러난다.
   *
   * 없으면 <b>정리한 뒤에 루프가 켜진다</b> — 화면을 떠났는데 rAF가 계속 돌며 GPU를 물고
   * 사라진 ref에 값을 쓴다. 모델을 처음 받는 순간(가장 느린 때)에만 재현돼 눈으로는 못 잡는다.
   */
  let generation = 0

  async function preload(): Promise<boolean> {
    try {
      isLoading.value = true
      await loadDetector()
      return true
    } catch {
      error.value = '얼굴 인식 모델을 불러오지 못했어요'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 인식 루프 시작. video의 새 프레임이 들어올 때마다 onResult를 호출한다
   * (같은 프레임을 두 번 분석하지 않는다).
   */
  async function start(
    video: HTMLVideoElement,
    onResult: (result: FaceDetectorResult, timestampMs: number) => void,
  ): Promise<boolean> {
    stop()
    const mine = ++generation
    if (!(await preload())) return false
    if (mine !== generation) return false // 기다리는 사이 껐거나 다시 켰다

    const detector = await loadDetector()
    if (mine !== generation) return false

    stopped = false
    isRunning.value = true
    let lastVideoTime = -1

    const loop = () => {
      if (stopped || mine !== generation) return
      rafId = requestAnimationFrame(loop)
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime
      const now = performance.now()
      try {
        onResult(detector.detectForVideo(video, now), now)
      } catch {
        /* 일시적 프레임 처리 오류는 다음 프레임에서 회복 */
      }
    }
    loop()
    return true
  }

  function stop() {
    stopped = true
    generation++ // 아직 모델을 기다리고 있는 start()가 뒤늦게 루프를 켜지 못하게
    isRunning.value = false
    cancelAnimationFrame(rafId)
  }

  onBeforeUnmount(stop)

  return { isLoading, isRunning, error, preload, start, stop }
}
