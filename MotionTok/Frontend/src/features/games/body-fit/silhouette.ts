/**
 * 게임④ 실루엣 래스터라이저 — 아바타 골격을 2D 캔버스에 그린다.
 *
 * 한 함수가 세 군데에 쓰인다 (기획 §8, §9-1): ① 벽 alphaMap의 구멍,
 * ② 구멍 안 옅은 원본 윤곽(등급 목표), ③ 판정 마스크(128×128 픽셀 카운트).
 * 같은 solveSkeleton 출력 + 같은 도형(원 + 라운드 캡 선 = 캡슐의 정사영)을 쓰므로
 * "보이는 것과 판정되는 것"이 정의상 일치한다.
 *
 * 마진은 세그먼트별 배율(UI 스펙 §2-2)로 준다 — 몸통은 조금, 손끝은 많이.
 */
import type { BodyFitConfig } from './config'
import {
  HAND_R_MUL,
  HIP_HALF_WIDTH,
  LEG_LEN,
  LEG_R_MUL,
  LEG_SPLAY,
  LEG_TOP_DROP,
  TORSO_RADIUS,
  type Pt,
  type SolvedSkeleton,
} from './skeleton'
import type { SegmentKey } from './avatarRig'

/**
 * 아바타 공간 → 캔버스 뷰포트 (어깨너비=1 단위, 힙 앵커 적용 후 월드 기준).
 * 정사각형이라 어느 캔버스 크기든 등방 스케일이 된다. 벽 평면(three.js)도
 * 같은 뷰포트로 배치해야 구멍과 아바타가 픽셀 단위로 정렬된다.
 */
export const VIEW = {
  halfWidth: 2,
  top: 1.2,
  bottom: -2.8,
} as const
export const VIEW_SIZE = VIEW.halfWidth * 2 // = top - bottom = 3.8 (정사각형)

/** 삐져나옴을 검사하는 세그먼트 목록 — 다리는 앵커 덕에 전원 동일해서 제외 */
export const OVERFLOW_SEGMENTS: readonly SegmentKey[] = [
  'head',
  'torso',
  'upperL',
  'foreL',
  'handL',
  'upperR',
  'foreR',
  'handR',
]

function toCanvas(size: number, anchor: Pt, p: { x: number; y: number }): [number, number] {
  const scale = size / VIEW_SIZE
  return [size / 2 + (p.x + anchor.x) * scale, (VIEW.top - (p.y + anchor.y)) * scale]
}

/**
 * 골격을 현재 ctx 스타일(fillStyle/strokeStyle)로 그린다.
 * margin: 아바타 공간 단위의 기본 마진 폭. 세그먼트별 배율은 cfg.judge.marginMul.
 * segments 생략 시 전체(다리 포함), 지정 시 해당 세그먼트만 — 삐져나옴 검사용.
 */
export function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  solved: SolvedSkeleton,
  cfg: BodyFitConfig,
  margin: number,
  segments?: readonly SegmentKey[],
) {
  const size = ctx.canvas.width
  const scale = size / VIEW_SIZE
  const { anchor } = solved
  const mul = cfg.judge.marginMul
  const r = cfg.avatar.capsuleRadius
  const wants = segments ? new Set(segments) : null

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const circle = (p: { x: number; y: number }, radius: number) => {
    const [cx, cy] = toCanvas(size, anchor, p)
    ctx.beginPath()
    ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2)
    ctx.fill()
  }
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, width: number) => {
    const [ax, ay] = toCanvas(size, anchor, a)
    const [bx, by] = toCanvas(size, anchor, b)
    ctx.lineWidth = width * scale
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
  const want = (key: SegmentKey) => !wants || wants.has(key)

  if (want('head')) circle(solved.head, cfg.avatar.headRadius + margin * mul.headTorso)
  if (want('torso'))
    line({ x: 0, y: 0 }, solved.hip, 2 * (TORSO_RADIUS + margin * mul.headTorso))

  if (want('upperL')) line(solved.shoulderL, solved.elbowL, 2 * (r + margin * mul.upperArm))
  if (want('foreL')) line(solved.elbowL, solved.wristL, 2 * (r + margin * mul.forearm))
  if (want('handL')) circle(solved.wristL, r * HAND_R_MUL + margin * mul.hand)
  if (want('upperR')) line(solved.shoulderR, solved.elbowR, 2 * (r + margin * mul.upperArm))
  if (want('foreR')) line(solved.elbowR, solved.wristR, 2 * (r + margin * mul.forearm))
  if (want('handR')) circle(solved.wristR, r * HAND_R_MUL + margin * mul.hand)

  // 다리 — 고정 포즈라 세그먼트 지정 시(삐져나옴 검사)에는 그리지 않는다
  if (!wants) {
    const legLen = LEG_LEN * cfg.avatar.limbScale
    const legW = 2 * (r * LEG_R_MUL + margin * mul.upperArm)
    const hip = solved.hip
    line(
      { x: hip.x - HIP_HALF_WIDTH, y: hip.y - LEG_TOP_DROP },
      { x: hip.x - HIP_HALF_WIDTH - LEG_SPLAY, y: hip.y - legLen },
      legW,
    )
    line(
      { x: hip.x + HIP_HALF_WIDTH, y: hip.y - LEG_TOP_DROP },
      { x: hip.x + HIP_HALF_WIDTH + LEG_SPLAY, y: hip.y - legLen },
      legW,
    )
  }
}
