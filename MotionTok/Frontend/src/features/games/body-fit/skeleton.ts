/**
 * 게임④ 공유 스켈레톤 솔버 — "보이는 것 = 판정되는 것"의 토대 (기획 초안 §9-1).
 *
 * 랜드마크 → 관절 좌표 계산을 이 모듈 하나에 모은다. 3D 리그(avatarRig)와
 * 2D 실루엣 래스터라이저(silhouette → 벽 구멍·판정 마스크)가 같은 solveSkeleton을
 * 쓰므로, 화면의 아바타와 판정되는 실루엣이 정의상 어긋날 수 없다.
 *
 * 규칙 (§5-4, §5-5):
 *  - 정규화: 원점 = 어깨 중점, 스케일 = 어깨너비(=1), z축은 판정에서 버린다
 *  - 팔은 투영 길이 보존(단축법) — 본 길이에서 남는 만큼 카메라 쪽(z+)으로 눕는다
 *  - 허리 기울기: 힙이 보이면 힙 각도, 아니면 어깨선 롤 (표준 캠 프레이밍엔 힙이 없다)
 *  - 다리는 고정 서기 포즈, 힙 앵커로 발이 땅에 붙는다
 */
import * as THREE from 'three'
import type { BodyFitConfig } from './config'

// ── MediaPipe Pose 33점 중 사용하는 인덱스 ──
const NOSE = 0
const EAR_L = 7
const EAR_R = 8
const SHOULDER_L = 11
const SHOULDER_R = 12
const ELBOW_L = 13
const ELBOW_R = 14
const WRIST_L = 15
const WRIST_R = 16
const HIP_L = 23
const HIP_R = 24

/** 이 신뢰도 미만인 관절은 이번 프레임 업데이트를 건너뛴다 */
const MIN_VIS = 0.3
/** 어깨는 정규화의 기준이라 더 엄격하게 본다 */
const MIN_SHOULDER_VIS = 0.5

// ── 표준 골격 (어깨너비 = 1 단위) — 전원 같은 체형, 포즈만 다르다 (§5-1) ──
export const NECK_LEN = 0.16
export const UPPER_ARM_LEN = 0.42
export const FOREARM_LEN = 0.38
export const TORSO_LEN = 0.85
export const TORSO_RADIUS = 0.3
export const HIP_HALF_WIDTH = 0.2
export const LEG_LEN = 0.9
/** 발끝이 살짝 벌어지는 고정 포즈 (레퍼런스 턴어라운드의 스탠스) */
export const LEG_SPLAY = 0.06
/** 손 구 반경 = 캡슐 반경 × 이 값 */
export const HAND_R_MUL = 1.3
/** 다리 캡슐 반경 = 캡슐 반경 × 이 값 */
export const LEG_R_MUL = 1.15

// 팔 체인 z 오프셋 — 렌더 전용. 팔짱·교차 포즈가 몸통을 관통해 보이지 않게
// 어깨→손목으로 갈수록 몸 앞 레이어에 둔다. 실루엣(xy)에는 영향 없다.
export const ARM_Z_SHOULDER = 0.06
export const ARM_Z_ELBOW = 0.3
export const ARM_Z_WRIST = 0.5

export interface LandmarkPoint {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface Pt {
  x: number
  y: number
}

/** z: 어깨 중점 기준 상대 깊이 (+ = 카메라 쪽). 판정은 안 쓰고 렌더 깊이에만 쓴다 */
export interface PtZ extends Pt {
  z: number
}

/** 아바타 공간(어깨너비=1, y 위가 +)의 관절 위치. null = 이번 프레임 신뢰도 미달 */
export interface NormalizedPose {
  /** 어깨 중점 → 머리 방향 기준점 (귀 중점, 폴백은 코) */
  headUp: Pt | null
  shoulderL: Pt
  shoulderR: Pt
  elbowL: PtZ | null
  elbowR: PtZ | null
  wristL: PtZ | null
  wristR: PtZ | null
  hipMid: Pt | null
}

/** 첫 랜드마크가 오기 전 기본 서기 자세 */
export const DEFAULT_POSE: NormalizedPose = {
  headUp: null,
  shoulderL: { x: -0.5, y: 0 },
  shoulderR: { x: 0.5, y: 0 },
  elbowL: null,
  elbowR: null,
  wristL: null,
  wristR: null,
  hipMid: null,
}

/**
 * 랜드마크(이미지 좌표, y 아래가 +) → 아바타 공간 정규화.
 * 어깨가 안 보이면 null — 호출부는 마지막 포즈를 유지하면 된다.
 * mirror=true면 x를 뒤집어 거울처럼 움직인다(셀프뷰 표준).
 */
export function normalizePose(lm: LandmarkPoint[], mirror: boolean): NormalizedPose | null {
  const sl = lm[SHOULDER_L]
  const sr = lm[SHOULDER_R]
  if (!sl || !sr) return null
  if ((sl.visibility ?? 1) < MIN_SHOULDER_VIS || (sr.visibility ?? 1) < MIN_SHOULDER_VIS)
    return null

  const midX = (sl.x + sr.x) / 2
  const midY = (sl.y + sr.y) / 2
  const sw = Math.hypot(sl.x - sr.x, sl.y - sr.y)
  if (sw < 1e-3) return null

  const sx = mirror ? -1 : 1
  const map = (p: LandmarkPoint): Pt => ({
    x: ((p.x - midX) / sw) * sx,
    y: -((p.y - midY) / sw),
  })
  const pt = (i: number): Pt | null => {
    const p = lm[i]
    return p && (p.visibility ?? 1) >= MIN_VIS ? map(p) : null
  }
  // z: MediaPipe는 음수가 카메라 쪽 → 아바타 공간(+z = 카메라 쪽)으로 뒤집고,
  // 어깨 중점 깊이를 0 기준으로 삼아 어깨너비로 정규화한다 (x·y와 같은 스케일)
  const midZ = ((sl.z ?? 0) + (sr.z ?? 0)) / 2
  const ptZ = (i: number): PtZ | null => {
    const p = lm[i]
    if (!p || (p.visibility ?? 1) < MIN_VIS) return null
    return { ...map(p), z: -(((p.z ?? 0) - midZ) / sw) }
  }
  const mid = (a: Pt | null, b: Pt | null): Pt | null =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null

  return {
    headUp: mid(pt(EAR_L), pt(EAR_R)) ?? pt(NOSE),
    shoulderL: map(sl),
    shoulderR: map(sr),
    elbowL: ptZ(ELBOW_L),
    elbowR: ptZ(ELBOW_R),
    wristL: ptZ(WRIST_L),
    wristR: ptZ(WRIST_R),
    hipMid: mid(pt(HIP_L), pt(HIP_R)),
  }
}

// 사용자 팔 길이 기준값(어깨너비 단위) — 인체 표준 비율로 시작해서, 관측된 최대
// 투영 길이로 자동 캘리브레이션한다 (팔을 한 번 쭉 뻗으면 그 사용자 기준으로 수렴).
// 캡은 트래킹 스파이크가 기준을 영구히 부풀리는 것을 막는다.
const REF_UPPER_INIT = 0.72
const REF_FORE_INIT = 0.62
const REF_UPPER_CAP = 0.9
const REF_FORE_CAP = 0.8

/** 팔 하나가 프레임 사이에 유지하는 상태 — 마지막 본 벡터와 앞/뒤 깊이 부호 */
export interface ArmState {
  upperVec: THREE.Vector2
  foreVec: THREE.Vector2
  /** 깊이 부호 (+1 앞 / −1 뒤) — 측정 z가 애매한 구간에서는 마지막 값 유지(히스테리시스) */
  signUpper: 1 | -1
  signFore: 1 | -1
}

/** 신뢰도 미달 프레임에서 유지할 마지막 상태 — 소비자(리그/판정기)별로 하나씩 만든다 */
export interface SkeletonState {
  headDir: THREE.Vector2
  hipDir: THREE.Vector2
  armL: ArmState
  armR: ArmState
  /** 이 사용자의 최대 관측 상완 투영 길이 — 비율 매핑의 분모 */
  refUpper: number
  refFore: number
}

export function createSkeletonState(): SkeletonState {
  return {
    headDir: new THREE.Vector2(0, 1),
    hipDir: new THREE.Vector2(0, -1),
    armL: {
      upperVec: new THREE.Vector2(-0.15, -0.4),
      foreVec: new THREE.Vector2(-0.1, -0.35),
      signUpper: 1,
      signFore: 1,
    },
    armR: {
      upperVec: new THREE.Vector2(0.15, -0.4),
      foreVec: new THREE.Vector2(0.1, -0.35),
      signUpper: 1,
      signFore: 1,
    },
    refUpper: REF_UPPER_INIT,
    refFore: REF_FORE_INIT,
  }
}

/** z: 렌더용 깊이 (판정은 x·y만 쓴다) */
export interface SolvedJoint {
  x: number
  y: number
  z: number
}

/** 한 프레임의 완성된 골격 — 리그는 3D로 세우고, 래스터라이저는 xy만 그린다 */
export interface SolvedSkeleton {
  /** 힙 앵커 그룹 오프셋 — 힙을 월드 (0, -TORSO_LEN)에 고정 */
  anchor: Pt
  head: Pt
  shoulderL: Pt
  shoulderR: Pt
  elbowL: SolvedJoint
  wristL: SolvedJoint
  elbowR: SolvedJoint
  wristR: SolvedJoint
  hip: Pt
}

/** 방향 벡터 갱신 — 길이가 0에 가까우면 기존 방향을 유지한다 */
function setDir(target: THREE.Vector2, x: number, y: number) {
  const len = Math.hypot(x, y)
  if (len > 1e-6) target.set(x / len, y / len)
}

/**
 * 랜드마크 2D 변위를 "비율 매핑" 본 벡터로 만든다 (§5-5 단축법 룰).
 * 아바타 변위 = 본 길이 × (관측 투영 길이 / 그 사용자의 최대 관측 길이).
 * 실제 인체 팔은 어깨너비 대비 아바타 팔보다 길어서, 투영 길이를 그대로 쓰면
 * 항상 클램프에 걸려 교차 포즈(팔짱·X자)가 몸 중앙까지 닿지 못한다.
 * 완전히 뻗으면 아바타도 완전히 뻗고, 정면으로 뻗으면 여전히 짧아 보인다.
 */
function setMapped(target: THREE.Vector2, dx: number, dy: number, boneLen: number, ref: number) {
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    target.set(0, 0)
    return
  }
  const scale = (boneLen * Math.min(1, len / ref)) / len
  target.set(dx * scale, dy * scale)
}

/** 저장된 본 벡터를 본 길이 이내로 — limbScale 슬라이더가 줄어들 때 잔여 길이 정리 */
function clampLen(v: THREE.Vector2, maxLen: number) {
  const len = v.length()
  if (len > maxLen) v.multiplyScalar(maxLen / len)
}

/** 측정 z가 이 값을 넘을 때만 앞/뒤 부호를 바꾼다 — 0 근처 노이즈로 팔이 앞뒤로 튀는 것 방지 */
const Z_SIGN_HYSTERESIS = 0.08

function depthSign(dz: number, last: 1 | -1): 1 | -1 {
  if (dz > Z_SIGN_HYSTERESIS) return 1
  if (dz < -Z_SIGN_HYSTERESIS) return -1
  return last
}

function solveArm(
  shoulder: Pt,
  elbow: PtZ | null,
  wrist: PtZ | null,
  arm: ArmState,
  upperLen: number,
  foreLen: number,
  state: SkeletonState,
): { elbow: SolvedJoint; wrist: SolvedJoint } {
  if (elbow) {
    const dx = elbow.x - shoulder.x
    const dy = elbow.y - shoulder.y
    state.refUpper = Math.min(REF_UPPER_CAP, Math.max(state.refUpper, Math.hypot(dx, dy)))
    setMapped(arm.upperVec, dx, dy, upperLen, state.refUpper)
    // 깊이 방향은 측정 z의 부호에서, 크기는 본 길이 보존에서 (§5-5)
    arm.signUpper = depthSign(elbow.z, arm.signUpper)
  }
  clampLen(arm.upperVec, upperLen)
  const ex = shoulder.x + arm.upperVec.x
  const ey = shoulder.y + arm.upperVec.y
  const ez = arm.signUpper * Math.sqrt(Math.max(0, upperLen ** 2 - arm.upperVec.lengthSq()))

  if (elbow && wrist) {
    const dx = wrist.x - elbow.x
    const dy = wrist.y - elbow.y
    state.refFore = Math.min(REF_FORE_CAP, Math.max(state.refFore, Math.hypot(dx, dy)))
    setMapped(arm.foreVec, dx, dy, foreLen, state.refFore)
    arm.signFore = depthSign(wrist.z - elbow.z, arm.signFore)
  }
  clampLen(arm.foreVec, foreLen)
  const wx = ex + arm.foreVec.x
  const wy = ey + arm.foreVec.y
  const wz = ez + arm.signFore * Math.sqrt(Math.max(0, foreLen ** 2 - arm.foreVec.lengthSq()))

  return {
    elbow: { x: ex, y: ey, z: ARM_Z_ELBOW + ez },
    wrist: { x: wx, y: wy, z: ARM_Z_WRIST + wz },
  }
}

/** 매 프레임: 정규화 포즈 + 이전 상태 → 완성된 골격 */
export function solveSkeleton(
  p: NormalizedPose,
  cfg: BodyFitConfig['avatar'],
  state: SkeletonState,
): SolvedSkeleton {
  // 허리 기울기 신호 — 힙이 보이면 힙 각도, 아니면(표준 앉은 프레이밍) 어깨선 롤
  let leanRaw: number
  if (p.hipMid) {
    setDir(state.hipDir, p.hipMid.x, p.hipMid.y)
    leanRaw = Math.atan2(state.hipDir.x, -state.hipDir.y)
  } else {
    leanRaw = Math.atan2(p.shoulderR.y - p.shoulderL.y, p.shoulderR.x - p.shoulderL.x)
  }
  // 기울기 증폭: leanGain배, ±75° 클램프 (추정 튐 방지)
  const lean = Math.max(-1.3, Math.min(1.3, leanRaw * cfg.leanGain))
  const hip: Pt = { x: Math.sin(lean) * TORSO_LEN, y: -Math.cos(lean) * TORSO_LEN }

  if (p.headUp) setDir(state.headDir, p.headUp.x, p.headUp.y)
  const headDist = NECK_LEN + cfg.headRadius
  const head: Pt = { x: state.headDir.x * headDist, y: state.headDir.y * headDist }

  const upperLen = UPPER_ARM_LEN * cfg.limbScale
  const foreLen = FOREARM_LEN * cfg.limbScale
  const armL = solveArm(p.shoulderL, p.elbowL, p.wristL, state.armL, upperLen, foreLen, state)
  const armR = solveArm(p.shoulderR, p.elbowR, p.wristR, state.armR, upperLen, foreLen, state)

  return {
    anchor: { x: -hip.x, y: -TORSO_LEN - hip.y },
    head,
    shoulderL: p.shoulderL,
    shoulderR: p.shoulderR,
    elbowL: armL.elbow,
    wristL: armL.wrist,
    elbowR: armR.elbow,
    wristR: armR.wrist,
    hip,
  }
}
