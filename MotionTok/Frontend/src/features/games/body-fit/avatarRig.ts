/**
 * 게임④ 아바타 리그 — 순백 캡슐 캐릭터 (기획 초안 §5-2, §5-3, §5-5).
 *
 * 구(머리) + 캡슐(몸통·사지)만으로 만드는 프로시저럴 인형. 모델링·리깅 없음.
 *
 * 규칙:
 *  - 정규화: 원점 = 어깨 중점, 스케일 = 어깨너비(=1), z축은 버린다 → "카메라에 보이는 모양이 전부"
 *  - 사지 길이는 표준 골격 고정값 × limbScale — 랜드마크에서는 방향(각도)만 쓴다 (체형 차이 제거)
 *  - 렌더는 전신, 랜드마크 구동은 상반신만. 다리는 고정 서기 포즈 (§5-4)
 *  - 신뢰도 미달 관절은 마지막 방향을 유지한다 (팔이 프레임 밖으로 나가도 덜덜거리지 않게)
 */
import * as THREE from 'three'
import type { BodyFitConfig } from './config'

// MediaPipe Pose 33점 중 사용하는 인덱스
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

// 표준 골격 (어깨너비 = 1 단위) — 전원 같은 체형, 포즈만 다르다 (§5-1)
const NECK_LEN = 0.16
const UPPER_ARM_LEN = 0.42
const FOREARM_LEN = 0.38
const TORSO_LEN = 0.85
const TORSO_RADIUS = 0.3
const HIP_HALF_WIDTH = 0.2
const LEG_LEN = 0.9
/** 발끝이 살짝 벌어지는 고정 포즈 (레퍼런스 턴어라운드의 스탠스) */
const LEG_SPLAY = 0.06

// 팔 체인 z 오프셋 — 판정에서는 z를 버리지만(§5-5), 렌더에서 전부 z=0에 두면
// 팔짱·교차 포즈에서 팔이 몸통을 관통해 보인다. 어깨→팔꿈치→손목으로 갈수록
// 몸 앞쪽 레이어에 배치해 교차 시 "팔이 앞에 나온" 모습이 되게 한다.
// 정면 실루엣(x,y)은 불변이라 벽 구멍 판정과 어긋나지 않는다.
const ARM_Z_SHOULDER = 0.06
const ARM_Z_ELBOW = 0.3
const ARM_Z_WRIST = 0.5

export interface LandmarkPoint {
  x: number
  y: number
  z?: number
  visibility?: number
}

interface Pt {
  x: number
  y: number
}

/** 아바타 공간(어깨너비=1, y 위가 +)의 관절 위치. null = 이번 프레임 신뢰도 미달 */
export interface NormalizedPose {
  /** 어깨 중점 → 머리 방향 기준점 (귀 중점, 폴백은 코) */
  headUp: Pt | null
  shoulderL: Pt
  shoulderR: Pt
  elbowL: Pt | null
  elbowR: Pt | null
  wristL: Pt | null
  wristR: Pt | null
  hipMid: Pt | null
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
  const mid = (a: Pt | null, b: Pt | null): Pt | null =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null

  return {
    headUp: mid(pt(EAR_L), pt(EAR_R)) ?? pt(NOSE),
    shoulderL: map(sl),
    shoulderR: map(sr),
    elbowL: pt(ELBOW_L),
    elbowR: pt(ELBOW_R),
    wristL: pt(WRIST_L),
    wristR: pt(WRIST_R),
    hipMid: mid(pt(HIP_L), pt(HIP_R)),
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const tmpDir = new THREE.Vector3()

/** 캡슐 메시를 두 점 사이에 놓고 그 방향으로 세운다 (CapsuleGeometry는 y축 기준) */
function setBetween(
  mesh: THREE.Mesh,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  az = 0,
  bz = 0,
) {
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
  tmpDir.set(bx - ax, by - ay, bz - az)
  const len = tmpDir.length()
  if (len < 1e-6) return
  tmpDir.divideScalar(len)
  mesh.quaternion.setFromUnitVectors(Y_AXIS, tmpDir)
}

/** 방향 벡터 갱신 — 길이가 0에 가까우면 기존 방향을 유지한다 */
function setDir(target: THREE.Vector2, x: number, y: number) {
  const len = Math.hypot(x, y)
  if (len > 1e-6) target.set(x / len, y / len)
}

/**
 * 랜드마크 2D 변위를 "투영 길이 보존" 본 벡터로 만든다 (§5-5 단축법 룰).
 * 팔을 카메라 쪽으로 뻗으면 2D 거리가 짧아진다 — 그 길이를 그대로 쓰고,
 * 본 길이보다 길면 본 길이로 클램프한다. 0이면 (0,0) = 카메라를 정면으로 향한 팔.
 */
function setProjected(target: THREE.Vector2, dx: number, dy: number, maxLen: number) {
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    target.set(0, 0)
    return
  }
  const scale = Math.min(len, maxLen) / len
  target.set(dx * scale, dy * scale)
}

/** 저장된 본 벡터를 본 길이 이내로 — limbScale 슬라이더가 줄어들 때 잔여 길이 정리 */
function clampLen(v: THREE.Vector2, maxLen: number) {
  const len = v.length()
  if (len > maxLen) v.multiplyScalar(maxLen / len)
}

export class AvatarRig {
  readonly group = new THREE.Group()
  /** 기본 서기 자세의 발바닥 y — 바닥판 배치용 */
  floorY = 0

  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
  })

  private readonly head: THREE.Mesh
  private readonly torso: THREE.Mesh
  private readonly upperArmL: THREE.Mesh
  private readonly upperArmR: THREE.Mesh
  private readonly forearmL: THREE.Mesh
  private readonly forearmR: THREE.Mesh
  private readonly handL: THREE.Mesh
  private readonly handR: THREE.Mesh
  /** 다리는 이 그룹째로 힙을 따라다닌다 — 자세는 applyConfig에서 한 번만 배치 */
  private readonly legs = new THREE.Group()
  private readonly legL: THREE.Mesh
  private readonly legR: THREE.Mesh

  // applyConfig에서 채워지는 유효 골격 치수
  private headR = 0
  private upperArmLen = 0
  private forearmLen = 0
  private leanGain = 1

  // 신뢰도 미달 프레임에서 유지할 마지막 상태.
  // 머리·힙은 단위 방향, 팔은 "투영 길이까지 담은" 본 벡터 (§5-5 단축법)
  private readonly headDir = new THREE.Vector2(0, 1)
  private readonly hipDir = new THREE.Vector2(0, -1)
  private readonly upperVecL = new THREE.Vector2(-0.15, -0.4)
  private readonly upperVecR = new THREE.Vector2(0.15, -0.4)
  private readonly foreVecL = new THREE.Vector2(-0.1, -0.35)
  private readonly foreVecR = new THREE.Vector2(0.1, -0.35)

  constructor(cfg: BodyFitConfig['avatar']) {
    const make = (parent: THREE.Object3D): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
      m.castShadow = true
      parent.add(m)
      return m
    }
    this.head = make(this.group)
    this.torso = make(this.group)
    this.upperArmL = make(this.group)
    this.upperArmR = make(this.group)
    this.forearmL = make(this.group)
    this.forearmR = make(this.group)
    this.handL = make(this.group)
    this.handR = make(this.group)
    this.group.add(this.legs)
    this.legL = make(this.legs)
    this.legR = make(this.legs)

    this.applyConfig(cfg)
    // 첫 랜드마크가 오기 전에도 기본 서기 자세로 보이게
    this.updatePose({
      headUp: null,
      shoulderL: { x: -0.5, y: 0 },
      shoulderR: { x: 0.5, y: 0 },
      elbowL: null,
      elbowR: null,
      wristL: null,
      wristR: null,
      hipMid: null,
    })
  }

  /** 슬라이더로 비율이 바뀔 때 지오메트리만 갈아 끼운다 (머티리얼·씬 그래프 유지) */
  applyConfig(cfg: BodyFitConfig['avatar']) {
    this.headR = cfg.headRadius
    this.upperArmLen = UPPER_ARM_LEN * cfg.limbScale
    this.forearmLen = FOREARM_LEN * cfg.limbScale
    this.leanGain = cfg.leanGain
    const legLen = LEG_LEN * cfg.limbScale
    const r = cfg.capsuleRadius
    const legR = r * 1.15
    const handR = r * 1.3

    const swap = (mesh: THREE.Mesh, geo: THREE.BufferGeometry) => {
      mesh.geometry.dispose()
      mesh.geometry = geo
    }
    swap(this.head, new THREE.SphereGeometry(this.headR, 32, 24))
    swap(this.torso, new THREE.CapsuleGeometry(TORSO_RADIUS, TORSO_LEN, 8, 24))
    swap(this.upperArmL, new THREE.CapsuleGeometry(r, this.upperArmLen, 6, 16))
    swap(this.upperArmR, new THREE.CapsuleGeometry(r, this.upperArmLen, 6, 16))
    swap(this.forearmL, new THREE.CapsuleGeometry(r, this.forearmLen, 6, 16))
    swap(this.forearmR, new THREE.CapsuleGeometry(r, this.forearmLen, 6, 16))
    swap(this.handL, new THREE.SphereGeometry(handR, 16, 12))
    swap(this.handR, new THREE.SphereGeometry(handR, 16, 12))
    swap(this.legL, new THREE.CapsuleGeometry(legR, legLen, 6, 16))
    swap(this.legR, new THREE.CapsuleGeometry(legR, legLen, 6, 16))

    // 다리 고정 포즈 — legs 그룹 로컬 좌표(원점 = 힙 중점)
    setBetween(this.legL, -HIP_HALF_WIDTH, 0, -HIP_HALF_WIDTH - LEG_SPLAY, -legLen)
    setBetween(this.legR, HIP_HALF_WIDTH, 0, HIP_HALF_WIDTH + LEG_SPLAY, -legLen)
    this.floorY = -(TORSO_LEN + legLen + legR)
  }

  /** 매 프레임: 정규화 포즈 → 각 메시의 position/quaternion 갱신 */
  updatePose(p: NormalizedPose) {
    // 허리 기울기 신호 — 표준 캠 프레이밍(가슴 위)에서는 힙 랜드마크가 아예 안 잡히므로
    // (visibility ~0.02), 힙이 보일 때만 힙 각도를 쓰고 평소엔 어깨선 롤로 기울기를 만든다.
    // 상체를 기울이면 어깨선이 같은 각도로 기울기 때문에 앉은 자세에서도 허리가 산다.
    let leanRaw: number
    if (p.hipMid) {
      setDir(this.hipDir, p.hipMid.x, p.hipMid.y)
      leanRaw = Math.atan2(this.hipDir.x, -this.hipDir.y)
    } else {
      leanRaw = Math.atan2(p.shoulderR.y - p.shoulderL.y, p.shoulderR.x - p.shoulderL.x)
    }
    // 기울기 증폭: leanGain배, ±75° 클램프 (추정 튐 방지)
    const lean = Math.max(-1.3, Math.min(1.3, leanRaw * this.leanGain))
    const hipX = Math.sin(lean) * TORSO_LEN
    const hipY = -Math.cos(lean) * TORSO_LEN
    setBetween(this.torso, 0, 0, hipX, hipY)

    // 머리: 어깨 중점에서 귀 중점 방향으로 목 길이 + 반경만큼
    if (p.headUp) setDir(this.headDir, p.headUp.x, p.headUp.y)
    const headDist = NECK_LEN + this.headR
    this.head.position.set(this.headDir.x * headDist, this.headDir.y * headDist, 0)

    this.updateArm(p.shoulderL, p.elbowL, p.wristL, this.upperArmL, this.forearmL, this.handL, this.upperVecL, this.foreVecL)
    this.updateArm(p.shoulderR, p.elbowR, p.wristR, this.upperArmR, this.forearmR, this.handR, this.upperVecR, this.foreVecR)

    // 다리 그룹은 힙 위치만 따라간다 (자세 고정, §5-4)
    this.legs.position.set(hipX, hipY, 0)

    // 힙 앵커: 힙을 월드 (0, -TORSO_LEN)에 고정한다. 어깨 고정 렌더는 기울여도
    // 다리만 흔들려 움직임이 압축돼 보인다 — 발을 땅에 붙이고 상체가 호를 그리게 한다.
    // 그룹 평행이동이라 실루엣 모양은 불변 (판정 영향 없음)
    this.group.position.set(-hipX, -TORSO_LEN - hipY, 0)
  }

  private updateArm(
    shoulder: Pt,
    elbow: Pt | null,
    wrist: Pt | null,
    upperMesh: THREE.Mesh,
    foreMesh: THREE.Mesh,
    handMesh: THREE.Mesh,
    upperVec: THREE.Vector2,
    foreVec: THREE.Vector2,
  ) {
    // 화면(xy) 변위는 랜드마크의 투영 길이를 그대로 쓰고, 본 길이에서 남는 만큼을
    // 카메라 쪽(z+)으로 눕힌다 → 정면으로 뻗은 팔이 실제처럼 짧아 보인다 (§5-5)
    if (elbow) setProjected(upperVec, elbow.x - shoulder.x, elbow.y - shoulder.y, this.upperArmLen)
    clampLen(upperVec, this.upperArmLen)
    const ex = shoulder.x + upperVec.x
    const ey = shoulder.y + upperVec.y
    const ez = Math.sqrt(Math.max(0, this.upperArmLen ** 2 - upperVec.lengthSq()))
    setBetween(upperMesh, shoulder.x, shoulder.y, ex, ey, ARM_Z_SHOULDER, ARM_Z_ELBOW + ez)

    if (elbow && wrist) setProjected(foreVec, wrist.x - elbow.x, wrist.y - elbow.y, this.forearmLen)
    clampLen(foreVec, this.forearmLen)
    const wx = ex + foreVec.x
    const wy = ey + foreVec.y
    const wz = ez + Math.sqrt(Math.max(0, this.forearmLen ** 2 - foreVec.lengthSq()))
    setBetween(foreMesh, ex, ey, wx, wy, ARM_Z_ELBOW + ez, ARM_Z_WRIST + wz)
    handMesh.position.set(wx, wy, ARM_Z_WRIST + wz)
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    })
    this.material.dispose()
  }
}
