/**
 * 얼굴에 붙는 꾸미기 아이템(가면)의 위치·크기·기울기를 얼굴 검출 결과에서 뽑는다.
 *
 * <b>가면 에셋 좌표 규약</b> (scripts/fit-mask-item.mjs가 맞춰 주고 검사한다)
 *  - 두 눈의 중앙이 이미지 <b>정중앙</b>(가로·세로 모두)
 *  - 두 눈 중심 간격이 이미지 <b>가로 폭의 MASK_EYE_GAP_RATIO</b>
 *
 * 이 두 가지를 지키는 그림이면 얹는 규칙이 "이미지 중심을 두 눈 중앙에 두고, 폭을
 * 눈 간격 ÷ 비율로 잡고, 두 눈을 잇는 선만큼 기울인다"로 끝난다. 그래서 가면마다
 * 앵커 값을 따로 들고 다닐 필요가 없다(장착 배치에 저장할 것도 없다).
 *
 * 눈 두 개만 쓰는 이유 — 얼굴 폭을 코·입·귀로 재면 고개를 돌릴 때 값이 크게 흔들린다.
 * 두 눈 간격은 정면에서 가장 안정적이고, 가면이 맞아야 하는 곳도 결국 눈이다.
 */
import { PoseSmoother } from '@/features/games/body-fit/oneEuro'

/**
 * 두 눈 중심 간격 ÷ 가면 이미지 가로 폭.
 *
 * <b>고른 값이 아니라 에셋에서 측정한 값이다</b>(mong_mask.png 511x517 = 0.3161).
 * 눈이 얼마나 벌어졌는지는 그림의 성질이라 여백으로 바꿀 수 없다 — 여백을 넣으면 폭이 늘어
 * 비율이 오히려 내려간다. 그래서 그림이 아니라 이 값을 맞춘다.
 *
 * 가면을 교체·추가할 때는 {@code node scripts/fit-mask-item.mjs <그림>}을 돌린다. 그 스크립트가
 * 여기 값을 읽어 비교하고, 다르면 넣어야 할 숫자를 알려 주며 실패한다. 값이 틀리면 가면이
 * 실제 눈보다 크게/작게 그려져 눈 구멍이 어긋난다.
 *
 * ⚠ 가면이 둘 이상이 되면 이 상수 하나로는 안 된다 — 그림마다 비율이 다르므로 에셋별 값
 * (cameraEffect의 EFFECT_BY_ASSET처럼 파일명 → 비율)으로 바꿔야 한다.
 */
export const MASK_EYE_GAP_RATIO = 0.3161

/**
 * 가면을 규약 크기보다 얼마나 크게 그릴지. 1이면 <b>가면의 눈이 실제 눈에 정확히 얹힌다</b>.
 *
 * 크기를 키우고 싶을 때 위의 {@link MASK_EYE_GAP_RATIO}를 낮추면 안 된다 — 그 값은 그림에서
 * 측정한 사실이라, 건드리면 "눈이 왜 안 맞나"의 원인이 둘(그림이 바뀐 건가, 크기를 키운 건가)이
 * 되어 다음에 만지는 사람이 풀 수 없다. 의도는 여기 따로 적는다.
 *
 * <b>대가가 있다.</b> 가면은 두 눈의 중앙을 기준으로 커지므로, 키운 만큼 가면의 눈이 바깥으로
 * 밀린다 — 1.3이면 가면의 두 눈 간격이 실제보다 30% 벌어진다(눈 간격 63mm 기준 한쪽에 약 9mm).
 * 이걸 감수하는 이유는 이 가면이 눈구멍을 맞추는 물건이 아니라 <b>머리에 쓰는 탈</b>이라서다 —
 * 얼굴을 덮는 게 목적이고, 눈은 그림의 눈이 따로 있다.
 *
 * 눈을 정확히 맞춘 채로 더 크게 덮고 싶으면 코드가 아니라 <b>그림</b>을 바꿔야 한다
 * (눈 간격 대비 머리가 더 큰 그림 = 더 작은 MASK_EYE_GAP_RATIO).
 */
export const MASK_SIZE_BOOST = 1.3

/**
 * MediaPipe Face Detector(BlazeFace)가 돌려주는 6개 키포인트 순서.
 * 좌/우는 <b>피실험자 기준</b>이라 RIGHT_EYE가 화면에서는 왼쪽에 찍힌다.
 */
export const FACE_KEYPOINT = {
  RIGHT_EYE: 0,
  LEFT_EYE: 1,
  NOSE_TIP: 2,
  MOUTH: 3,
  RIGHT_EAR: 4,
  LEFT_EAR: 5,
} as const

/** 화면에 얹을 변환값. x·y·scale은 StickerSprite와 같은 단위(프레임 정규화 좌표·짧은 변 대비 비율). */
export interface FaceAnchor {
  /** 두 눈의 중앙 (프레임 기준 0~1) */
  x: number
  y: number
  /** 프레임 짧은 변 대비 가면 폭 */
  scale: number
  /** 두 눈을 잇는 선의 기울기(라디안, 시계 방향 +) */
  rotation: number
}

export interface Point {
  x: number
  y: number
}

/**
 * 키포인트 → 가면 변환값. 눈 두 점이 없거나 겹쳐 있으면 null(그리지 않는다).
 *
 * 프레임 가로·세로를 따로 받는 이유 — 정규화 좌표에서 dx·dy를 그대로 재면 4:3이든 16:9든
 * 같은 값이 나와 기울기와 간격이 프레임 비율만큼 왜곡된다. 픽셀로 환산해서 재야 맞는다.
 */
export function faceAnchorFrom(
  keypoints: readonly Point[] | undefined,
  frameWidth: number,
  frameHeight: number,
): FaceAnchor | null {
  const right = keypoints?.[FACE_KEYPOINT.RIGHT_EYE]
  const left = keypoints?.[FACE_KEYPOINT.LEFT_EYE]
  if (!right || !left || frameWidth <= 0 || frameHeight <= 0) return null

  const dx = (left.x - right.x) * frameWidth
  const dy = (left.y - right.y) * frameHeight
  const gapPx = Math.hypot(dx, dy)
  if (!gapPx) return null

  return {
    x: (right.x + left.x) / 2,
    y: (right.y + left.y) / 2,
    // 규약 크기(= 눈이 딱 맞는 크기)에 의도한 배수를 곱한다. 둘을 나눠 두는 이유는 MASK_SIZE_BOOST 주석.
    scale: (gapPx / MASK_EYE_GAP_RATIO) * MASK_SIZE_BOOST / Math.min(frameWidth, frameHeight),
    rotation: Math.atan2(dy, dx),
  }
}

/**
 * 검출이 끊겨도 이 시간 동안은 마지막 값을 유지한다.
 * BlazeFace는 눈을 감거나 고개를 살짝 돌린 프레임을 종종 놓치는데, 그때마다 가면이
 * 사라지면 정상 동작보다 더 고장 나 보인다. 짧게 붙들고 있다가 그래도 안 돌아오면 지운다.
 */
export const FACE_HOLD_MS = 400

/**
 * 필터 계수 — 가면은 얼굴에 붙어 있어야 해서 몸 인식(minCutoff 0.6 / beta 0.8)보다
 * 지터를 더 눌렀다. 정지 상태에서 떨리면 minCutoff를 내리고, 고개를 돌릴 때 가면이
 * 늦게 따라오면 beta를 올린다.
 *
 * ⚠ 실기 미검증 시작값이다.
 */
const FILTER = { minCutoff: 0.8, beta: 0.4 }

/** 얼굴 키포인트 개수(BlazeFace). */
const KEYPOINT_COUNT = 6

/**
 * 프레임마다 들어오는 검출 결과를 "지금 얹을 변환값" 하나로 정리한다.
 * 지터 제거(One Euro)와 짧은 검출 유실 보정을 여기서 함께 맡아, 화면 쪽은
 * anchor가 있으면 그리고 없으면 안 그리는 것만 하면 된다.
 */
export class FaceAnchorTracker {
  private readonly smoother = new PoseSmoother(FILTER, KEYPOINT_COUNT)
  private anchor: FaceAnchor | null = null
  private lastSeenMs = 0

  /**
   * @param keypoints 이번 프레임에서 찾은 얼굴의 키포인트(못 찾았으면 undefined)
   * @param nowMs     프레임 타임스탬프(ms) — 필터 dt와 유실 판정에 함께 쓴다
   */
  update(
    keypoints: readonly Point[] | undefined,
    frameWidth: number,
    frameHeight: number,
    nowMs: number,
  ): FaceAnchor | null {
    if (keypoints && keypoints.length >= KEYPOINT_COUNT) {
      const smoothed = this.smoother.apply(
        keypoints.map((k) => ({ x: k.x, y: k.y })),
        nowMs,
      )
      const next = faceAnchorFrom(smoothed, frameWidth, frameHeight)
      if (next) {
        this.anchor = next
        this.lastSeenMs = nowMs
        return next
      }
    }
    // 유실 — 잠깐이면 마지막 값을 유지하고, 오래되면 지운다.
    if (this.anchor && nowMs - this.lastSeenMs > FACE_HOLD_MS) {
      this.anchor = null
      // 다음에 얼굴이 돌아오면 이전 위치에서 끌려오지 않게 필터를 비운다.
      this.smoother.reset()
    }
    return this.anchor
  }

  /** 카메라 교체·화면 이탈처럼 시간축이 끊길 때. */
  reset(): void {
    this.anchor = null
    this.lastSeenMs = 0
    this.smoother.reset()
  }
}
