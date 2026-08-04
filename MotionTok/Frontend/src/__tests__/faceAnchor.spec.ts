/**
 * 가면을 얼굴에 얹는 계산 — 두 눈에서 위치·크기·기울기를 뽑는다.
 *
 * 여기서 못박는 건 <b>프레임 비율을 픽셀로 환산해서 잰다</b>는 것이다. 정규화 좌표(0~1)에서
 * dx·dy를 그대로 재면 4:3이든 16:9든 같은 숫자가 나와, 가로가 긴 화면일수록 눈 간격이
 * 실제보다 짧게 잡히고(가면이 작아지고) 고개를 기울일 때 각도가 어긋난다.
 *
 * 그리고 <b>검출이 끊겨도 잠깐은 버틴다</b>. BlazeFace는 눈을 감거나 고개를 살짝 돌린 프레임을
 * 종종 놓치는데, 그때마다 가면이 사라졌다 나타나면 정상 동작보다 더 고장 나 보인다.
 */
import { describe, expect, it } from 'vitest'
import {
  FACE_HOLD_MS,
  FaceAnchorTracker,
  MASK_EYE_GAP_RATIO,
  MASK_SIZE_BOOST,
  faceAnchorFrom,
  type Point,
} from '@/features/decor/faceAnchor'

/** 두 눈만 채운 키포인트 6개(코·입·귀는 계산에 쓰지 않는다). */
function eyes(right: Point, left: Point): Point[] {
  const filler = { x: 0.5, y: 0.5 }
  return [right, left, filler, filler, filler, filler]
}

/** 정면·수평인 얼굴. 눈 간격은 가로 0.2(1280px 폭이면 256px). */
const FRONTAL = eyes({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 })

describe('faceAnchorFrom', () => {
  it('두 눈의 한가운데에 놓는다', () => {
    const anchor = faceAnchorFrom(FRONTAL, 1280, 720)

    expect(anchor?.x).toBeCloseTo(0.5)
    expect(anchor?.y).toBeCloseTo(0.5)
  })

  it('가면 폭은 눈 간격 ÷ 에셋 규약 비율 × 확대 배수', () => {
    const anchor = faceAnchorFrom(FRONTAL, 1280, 720)

    // 눈 간격 0.2 × 1280 = 256px, 짧은 변은 720
    expect(anchor?.scale).toBeCloseTo((256 / MASK_EYE_GAP_RATIO) * MASK_SIZE_BOOST / 720)
  })

  it('확대 배수는 규약 크기와 곱해지는 별개의 값 — 둘을 섞으면 눈이 왜 안 맞는지 못 가린다', () => {
    const anchor = faceAnchorFrom(FRONTAL, 720, 720)
    const exact = 0.2 / MASK_EYE_GAP_RATIO // 눈이 딱 맞는 크기(짧은 변 대비)

    expect(anchor!.scale / exact).toBeCloseTo(MASK_SIZE_BOOST)
    // 키운 만큼 가면의 눈이 바깥으로 밀린다 — 감수하는 대가라 여기 적어 둔다
    expect(MASK_SIZE_BOOST).toBeGreaterThanOrEqual(1)
  })

  it('프레임 비율을 픽셀로 환산해서 잰다 — 정규화 좌표로 재면 16:9와 4:3이 같아진다', () => {
    const wide = faceAnchorFrom(FRONTAL, 1280, 720)
    const square = faceAnchorFrom(FRONTAL, 720, 720)

    // 같은 정규화 간격(0.2)이라도 가로 픽셀이 다르면 실제 눈 간격이 다르다
    expect(wide!.scale).toBeGreaterThan(square!.scale)
  })

  it('고개를 기울이면 두 눈을 잇는 선만큼 기울어진다', () => {
    // 오른쪽 눈이 위, 왼쪽 눈이 아래 — 정사각 프레임이라 45°가 그대로 나온다
    const tilted = eyes({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 })

    expect(faceAnchorFrom(tilted, 720, 720)?.rotation).toBeCloseTo(Math.PI / 4)
    expect(faceAnchorFrom(FRONTAL, 720, 720)?.rotation).toBeCloseTo(0)
  })

  it('눈이 없거나 겹쳐 있으면 null — 그리지 않는다', () => {
    expect(faceAnchorFrom(undefined, 1280, 720)).toBeNull()
    expect(faceAnchorFrom([], 1280, 720)).toBeNull()
    // 두 눈이 같은 점이면 폭이 0이라 얹을 수 없다(0으로 나눠 Infinity가 되는 것도 막는다)
    expect(faceAnchorFrom(eyes({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), 1280, 720)).toBeNull()
  })

  it('프레임 크기를 모르면 null — 영상 메타데이터 전에 0으로 나누지 않는다', () => {
    expect(faceAnchorFrom(FRONTAL, 0, 0)).toBeNull()
  })
})

describe('FaceAnchorTracker', () => {
  it('검출이 잠깐 끊겨도 마지막 자리를 유지한다 — 깜빡이면 더 고장 나 보인다', () => {
    const tracker = new FaceAnchorTracker()
    const first = tracker.update(FRONTAL, 1280, 720, 0)
    expect(first).not.toBeNull()

    // 유예 안쪽 — 아직 붙들고 있다
    expect(tracker.update(undefined, 1280, 720, FACE_HOLD_MS - 1)).not.toBeNull()
  })

  it('오래 못 찾으면 지운다 — 얼굴이 없는데 가면만 떠 있으면 안 된다', () => {
    const tracker = new FaceAnchorTracker()
    tracker.update(FRONTAL, 1280, 720, 0)

    expect(tracker.update(undefined, 1280, 720, FACE_HOLD_MS + 1)).toBeNull()
  })

  it('한 번도 못 찾았으면 처음부터 null', () => {
    expect(new FaceAnchorTracker().update(undefined, 1280, 720, 0)).toBeNull()
  })

  it('reset하면 다음 얼굴이 이전 위치에서 끌려오지 않는다', () => {
    const tracker = new FaceAnchorTracker()
    tracker.update(FRONTAL, 1280, 720, 0)
    tracker.reset()
    expect(tracker.update(undefined, 1280, 720, 1)).toBeNull()

    // 화면 반대쪽에 나타난 얼굴 — 필터가 비어 있으므로 첫 프레임부터 그 자리다
    const right = eyes({ x: 0.7, y: 0.3 }, { x: 0.9, y: 0.3 })
    expect(tracker.update(right, 720, 720, 100)?.x).toBeCloseTo(0.8, 2)
  })

  it('키포인트가 모자라면 검출로 치지 않는다 — 6점이 다 와야 눈 번호가 의미를 갖는다', () => {
    const tracker = new FaceAnchorTracker()

    expect(tracker.update([{ x: 0.4, y: 0.5 }], 1280, 720, 0)).toBeNull()
  })
})
