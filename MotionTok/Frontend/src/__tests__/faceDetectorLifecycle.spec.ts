/**
 * 얼굴 검출 루프의 생명주기 — <b>정리한 뒤에는 절대 켜지지 않는다</b>.
 *
 * 모델을 받고 GPU를 초기화하는 데 수 초가 걸린다. 그 사이 가면을 벗거나 화면을 떠나면
 * {@code stop()}이 먼저 돌고, 뒤늦게 깨어난 {@code start()}가 루프를 켜 버릴 수 있다 —
 * 그러면 화면을 떠났는데 rAF가 계속 돌며 GPU를 물고 사라진 ref에 값을 쓴다.
 *
 * 눈으로는 못 잡는다: 모델이 캐시된 뒤에는 await가 거의 즉시 끝나 재현되지 않고,
 * <b>처음 받는 사람에게만</b> 일어난다. 그래서 테스트로 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFaceDetector } from '@/composables/useFaceDetector'

/** 모델 로드를 우리가 원하는 순간에 끝내기 위해 붙잡아 두는 손잡이. */
const gate = vi.hoisted(() => ({
  release: null as null | (() => void),
  wait: () => new Promise<void>((resolve) => { gate.release = resolve }),
}))

vi.mock('@/composables/modelCache', () => ({
  fetchModelBuffer: async () => {
    await gate.wait()
    return new Uint8Array(4)
  },
}))

const detectForVideo = vi.fn(() => ({ detections: [] }))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceDetector: { createFromOptions: async () => ({ detectForVideo }) },
}))

/** readyState·currentTime을 흉내 낸 최소 video. 매번 새 프레임인 척한다. */
function fakeVideo() {
  let t = 0
  return {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    get currentTime() {
      return (t += 1 / 30)
    },
  } as unknown as HTMLVideoElement
}

let frame: (() => void) | null = null

beforeEach(() => {
  frame = null
  detectForVideo.mockClear()
  // rAF를 손으로 굴린다 — 콜백을 붙잡아 두고 필요할 때만 한 프레임씩 돌린다.
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => { frame = null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useFaceDetector 생명주기', () => {
  it('모델을 기다리는 사이 stop()이 돌면 루프를 켜지 않는다', async () => {
    const detector = useFaceDetector()
    const onResult = vi.fn()

    const started = detector.start(fakeVideo(), onResult)
    // 아직 모델을 받는 중 — 이 순간 가면을 벗거나 화면을 떠난다
    detector.stop()

    gate.release?.()
    expect(await started).toBe(false)

    expect(detector.isRunning.value).toBe(false)
    // 뒤늦게 깨어난 start()가 rAF를 등록하지 않았다
    expect(frame).toBeNull()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('정상적으로 켜면 프레임마다 결과를 넘긴다 — 위 테스트가 그냥 안 도는 게 아님을 보인다', async () => {
    const detector = useFaceDetector()
    const onResult = vi.fn()

    const started = detector.start(fakeVideo(), onResult)
    gate.release?.()
    expect(await started).toBe(true)

    expect(detector.isRunning.value).toBe(true)
    expect(onResult).toHaveBeenCalledTimes(1) // 첫 프레임은 loop()가 바로 돈다
    frame?.()
    expect(onResult).toHaveBeenCalledTimes(2)
  })

  it('stop() 뒤에는 이미 예약된 프레임도 아무것도 하지 않는다', async () => {
    const detector = useFaceDetector()
    const onResult = vi.fn()

    const started = detector.start(fakeVideo(), onResult)
    gate.release?.()
    await started
    onResult.mockClear()

    const pending = frame
    detector.stop()
    pending?.() // 이미 브라우저 큐에 들어가 있던 프레임

    expect(onResult).not.toHaveBeenCalled()
  })
})
