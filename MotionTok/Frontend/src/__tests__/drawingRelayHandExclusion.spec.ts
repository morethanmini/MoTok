/**
 * 그림으로 말해요 — 양손 동시 입력 시 획 릴레이 무결성 (컴포넌트 테스트).
 *
 * 획 릴레이(DrawOp)에는 소스 구분이 없어 수신 측은 화가당 진행 중 획 하나만 재생한다.
 * 펜 손·지우개 손이 획을 동시에 열면(늘어진 왼손이 주먹으로 오인되는 게 흔한 트리거)
 * 원격에서 두 손의 point가 한 획으로 합쳐져, 두 손 사이를 잇는 검은 지그재그가
 * 다른 사람들 캔버스에만 남던 버그의 회귀 테스트 — 발신 op 스트림이 항상
 * begin → point* → end 순차(중첩 begin 없음)임을 검증한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DrawingRelayGame from '@/features/games/drawing-relay/DrawingRelayGame.vue'
import type { DrawOp } from '@/api/types'
import type { HandLandmarkerResult } from '@/composables/useHandLandmarker'
import type { NormalizedPoint } from '@/features/games/drawing-relay/logic'

// 손 인식 컴포저블 mock — start()에 넘어온 프레임 콜백을 붙잡아 테스트가 직접 밀어 넣는다
let frameCb: ((result: HandLandmarkerResult) => void) | null = null
vi.mock('@/composables/useHandLandmarker', () => ({
  useHandLandmarker: () => ({
    isLoading: { value: false },
    isRunning: { value: false },
    error: { value: null },
    preload: vi.fn<() => Promise<boolean>>(),
    start: vi.fn<
      (video: HTMLVideoElement, cb: (r: HandLandmarkerResult) => void) => Promise<boolean>
    >(async (_video, cb) => {
      frameCb = cb
      return true
    }),
    stop: vi.fn<() => void>(),
  }),
}))

/** 21개 랜드마크 배열을 만들고 지정 인덱스만 좌표를 채운다 */
function handLandmarks(points: Record<number, [number, number]>): NormalizedPoint[] {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
  for (const [idx, [x, y]] of Object.entries(points)) {
    lm[Number(idx)] = { x, y }
  }
  return lm
}

/** 핀치(펜 다운) 자세 — 엄지·검지 끝이 붙어 있고(비율 0.1) 검지는 뻗어 주먹이 아니다 */
function pinchHand(x: number, y: number): NormalizedPoint[] {
  return handLandmarks({
    0: [x, y + 0.3], // 손목
    9: [x, y + 0.1], // 중지 MCP — 손 크기 0.2
    4: [x - 0.01, y], // 엄지 끝
    8: [x + 0.01, y], // 검지 끝
    6: [x + 0.01, y + 0.15], // 검지 PIP — 끝이 손목에서 더 멀다(주먹 판정 회피)
  })
}

/** 손을 편(펜 업) 자세 — 엄지·검지가 벌어져 비율 1.0 > 업 임계 */
function openHand(x: number, y: number): NormalizedPoint[] {
  return handLandmarks({
    0: [x, y + 0.3],
    9: [x, y + 0.1],
    4: [x - 0.1, y],
    8: [x + 0.1, y],
    6: [x + 0.05, y + 0.15],
  })
}

/** 주먹(지우개) 자세 — 네 손가락 끝이 모두 PIP보다 손목에 가깝다 */
function fistHand(x: number, y: number): NormalizedPoint[] {
  return handLandmarks({
    0: [x, y + 0.3],
    6: [x, y],
    8: [x, y + 0.15],
    10: [x, y - 0.02],
    12: [x, y + 0.14],
    14: [x, y],
    16: [x, y + 0.16],
    18: [x, y + 0.04],
    20: [x, y + 0.18],
    5: [x, y + 0.05], // 너클 4점 — 지우개 좌표(knuckleCenter)
    9: [x, y + 0.05],
    13: [x, y + 0.05],
    17: [x, y + 0.05],
  })
}

function feedFrame(hands: Array<['Left' | 'Right', NormalizedPoint[]]>) {
  if (!frameCb) throw new Error('hand.start가 호출되지 않았다')
  frameCb({
    landmarks: hands.map(([, lm]) => lm),
    handedness: hands.map(([label]) => [{ categoryName: label }]),
  } as unknown as HandLandmarkerResult)
}

function mountGame() {
  return mount(DrawingRelayGame, {
    props: {
      video: document.createElement('video'),
      // 내 차례(턴 0)의 그리기 단계 한가운데로 맞춘다 — handoverSec 0, 시작 1초 경과
      session: {
        sessionId: 's1',
        constellationKey: '',
        startAt: Date.now() - 1000,
        endAt: Date.now() + 89_000,
        clockOffset: 0,
        topicWord: '고양이',
        turnOrder: ['me', 'p2', 'p3'],
        turnDurationSec: 60,
        handoverSec: 0,
      },
      results: null,
      myUserId: 'me',
      drawEvents: [],
      names: {},
      roomId: 'R1',
    },
  })
}

let wrapper: ReturnType<typeof mountGame> | undefined

/** 발신된 draw emit 전체의 op를 순서대로 평탄화 */
function emittedOps(): DrawOp[] {
  const events = (wrapper!.emitted('draw') ?? []) as Array<[number, DrawOp[]]>
  return events.flatMap(([, ops]) => ops)
}

/** 수신 측(화가당 진행 중 획 1개)이 그대로 재생 못 하는 op를 모아 돌려준다 — 비면 순차 스트림 */
function sequenceViolations(ops: DrawOp[]): string[] {
  const violations: string[] = []
  let open = false
  for (const op of ops) {
    if (op.type === 'begin') {
      if (open) violations.push(`획이 열린 채 begin(${op.tool}) — 수신 측에서 획이 병합된다`)
      open = true
    } else if (op.type === 'point') {
      if (!open) violations.push('닫힌 획에 point — 수신 측에서 버려진다')
    } else if (op.type === 'end') {
      open = false
    }
  }
  return violations
}

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom에는 캔버스 2D 컨텍스트가 없다 — 그리기 호출을 받아만 주는 스텁으로 대체
  const noop = () => {}
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        fillRect: noop,
        clearRect: noop,
        drawImage: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        arc: noop,
        fill: noop,
        stroke: noop,
        save: noop,
        restore: noop,
        setLineDash: noop,
        scale: noop,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineCap: 'round',
        lineJoin: 'round',
        globalCompositeOperation: 'source-over',
        imageSmoothingQuality: 'high',
      }) as unknown as CanvasRenderingContext2D,
  )
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  frameCb = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('양손 동시 입력 — 획 상호 배제', () => {
  it('펜 획이 열려 있는 동안 왼손 주먹이 확정돼도 지우개 획을 시작하지 않는다', () => {
    wrapper = mountGame()
    // 오른손 핀치 이동 + 왼손 주먹 6프레임 — 주먹은 3프레임째 확정(버그 시나리오)
    for (let i = 0; i < 6; i++) {
      feedFrame([
        ['Right', pinchHand(0.3 + i * 0.02, 0.3)],
        ['Left', fistHand(0.7, 0.4)],
      ])
    }
    vi.advanceTimersByTime(100) // 100ms 플러시 → draw emit
    let ops = emittedOps()
    expect(sequenceViolations(ops)).toEqual([])
    expect(ops.filter((o) => o.type === 'begin' && o.tool === 'pen')).toHaveLength(1)
    expect(ops.filter((o) => o.type === 'begin' && o.tool === 'erase')).toHaveLength(0)

    // 펜을 놓으면(주먹 유지) 그제야 지우개 획이 시작된다 — end 이후에만
    feedFrame([
      ['Right', openHand(0.42, 0.3)],
      ['Left', fistHand(0.7, 0.4)],
    ])
    feedFrame([
      ['Right', openHand(0.42, 0.3)],
      ['Left', fistHand(0.7, 0.4)],
    ])
    vi.advanceTimersByTime(100)
    ops = emittedOps()
    expect(sequenceViolations(ops)).toEqual([])
    const endIdx = ops.findIndex((o) => o.type === 'end')
    const eraseIdx = ops.findIndex((o) => o.type === 'begin' && o.tool === 'erase')
    expect(endIdx).toBeGreaterThanOrEqual(0)
    expect(eraseIdx).toBeGreaterThan(endIdx)
  })

  it('지우개 획이 열려 있는 동안 펜 핀치가 인식돼도 펜 획을 시작하지 않는다', () => {
    wrapper = mountGame()
    // 왼손 주먹만 3프레임 — 지우개 획 시작
    for (let i = 0; i < 3; i++) feedFrame([['Left', fistHand(0.6, 0.4)]])
    // 이후 오른손 핀치 동반 4프레임 — 지우개 획이 열려 있어 펜은 시작 금지
    for (let i = 0; i < 4; i++) {
      feedFrame([
        ['Right', pinchHand(0.3 + i * 0.02, 0.3)],
        ['Left', fistHand(0.6 + i * 0.01, 0.4)],
      ])
    }
    vi.advanceTimersByTime(100)
    let ops = emittedOps()
    expect(sequenceViolations(ops)).toEqual([])
    expect(ops.some((o) => o.type === 'begin' && o.tool === 'erase')).toBe(true)
    expect(ops.some((o) => o.type === 'begin' && o.tool === 'pen')).toBe(false)

    // 왼손이 사라지면 지우개 획이 닫히고, 다음 프레임부터 펜이 열린다
    feedFrame([['Right', pinchHand(0.4, 0.3)]]) // 이 프레임에서 지우개 end(펜은 아직 금지)
    feedFrame([['Right', pinchHand(0.42, 0.3)]]) // 이 프레임에서 펜 begin
    vi.advanceTimersByTime(100)
    ops = emittedOps()
    expect(sequenceViolations(ops)).toEqual([])
    const endIdx = ops.findIndex((o) => o.type === 'end')
    const penIdx = ops.findIndex((o) => o.type === 'begin' && o.tool === 'pen')
    expect(penIdx).toBeGreaterThan(endIdx)
  })
})
