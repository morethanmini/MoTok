/**
 * 게임④ 아바타 리그 — 순백 캡슐 캐릭터 (기획 초안 §5-2, §5-3).
 *
 * 관절 좌표 계산은 전부 skeleton.ts(공유 솔버)가 한다 — 이 파일은 솔버 결과를
 * three.js 메시의 position/quaternion으로 옮기는 일만 한다. 판정 래스터라이저와
 * 같은 솔버를 쓰므로 화면과 판정이 어긋나지 않는다 (§9-1).
 *
 * 구(머리·손) + 캡슐(몸통·사지)만으로 만드는 프로시저럴 인형. 모델링·리깅 없음.
 */
import * as THREE from 'three'
import type { BodyFitConfig } from './config'
import {
  ARM_Z_SHOULDER,
  DEFAULT_POSE,
  HAND_R_MUL,
  HIP_HALF_WIDTH,
  LEG_LEN,
  LEG_R_MUL,
  LEG_SPLAY,
  STAGE_DROP,
  STAGE_SCALE,
  TORSO_LEN,
  TORSO_RADIUS,
  UPPER_ARM_LEN,
  FOREARM_LEN,
  createSkeletonState,
  solveSkeleton,
  type NormalizedPose,
  type SolvedSkeleton,
} from './skeleton'

export type { LandmarkPoint, NormalizedPose } from './skeleton'
export { normalizePose } from './skeleton'

/** 구멍 밖 삐져나옴을 세그먼트 단위로 빨갛게 칠하기 위한 키 (§7-4) */
export type SegmentKey =
  | 'head'
  | 'torso'
  | 'upperL'
  | 'foreL'
  | 'handL'
  | 'upperR'
  | 'foreR'
  | 'handR'

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

export class AvatarRig {
  readonly group = new THREE.Group()
  /** 기본 서기 자세의 발바닥 y — 바닥판 배치용 */
  floorY = 0
  /** 마지막으로 적용된 골격 — 판정기가 이 값을 그대로 쓴다 */
  lastSolved: SolvedSkeleton | null = null

  // "납작한 배경 + 입체 주인공" — 무대는 unlit 단색이고 아바타만 조명을 받는다.
  // 무대 재질이 전부 MeshBasicMaterial이라 조명·환경맵을 통째로 무시하므로,
  // 조명을 켜도 여기에만 걸린다(격리가 공짜다).
  // sheen이 매트 표면에 옅은 산란을 얹어 레퍼런스의 점토/석고 같은 부드러움을 낸다.
  private readonly material = new THREE.MeshPhysicalMaterial({
    color: 0xe8dcc4, // 크림 — 순백은 무대에서 떠 보였고, 사암 단색은 너무 가라앉았다
    roughness: 0.82,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.55,
    sheenColor: 0xfff0d8,
  })
  /** 삐져나온 세그먼트용 — UI 스펙 §1-3 --overflow */
  private readonly overflowMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdb4f30,
    roughness: 0.75,
    metalness: 0,
    emissive: 0xdb4f30,
    emissiveIntensity: 0.4,
  })

  private readonly head: THREE.Mesh
  private readonly torso: THREE.Mesh
  private readonly upperArmL: THREE.Mesh
  private readonly upperArmR: THREE.Mesh
  private readonly forearmL: THREE.Mesh
  private readonly forearmR: THREE.Mesh
  private readonly handL: THREE.Mesh
  private readonly handR: THREE.Mesh
  // 관절 구 — 급하게 꺾인 팔의 이음새를 둥글게. 반경 = 캡슐 반경(실루엣 불변)
  private readonly jointShoulderL: THREE.Mesh
  private readonly jointShoulderR: THREE.Mesh
  private readonly jointElbowL: THREE.Mesh
  private readonly jointElbowR: THREE.Mesh
  /** 다리는 이 그룹째로 힙을 따라다닌다 — 자세는 applyConfig에서 한 번만 배치 */
  private readonly legs = new THREE.Group()
  private readonly legL: THREE.Mesh
  private readonly legR: THREE.Mesh

  private cfg: BodyFitConfig['avatar']
  private readonly state = createSkeletonState()

  constructor(cfg: BodyFitConfig['avatar']) {
    this.cfg = cfg
    // 무대 구도용 축소 — 골격 계산은 전부 원래 단위로 하고 표시만 줄인다
    this.group.scale.setScalar(STAGE_SCALE)
    const make = (parent: THREE.Object3D): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
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
    this.jointShoulderL = make(this.group)
    this.jointShoulderR = make(this.group)
    this.jointElbowL = make(this.group)
    this.jointElbowR = make(this.group)
    this.group.add(this.legs)
    this.legL = make(this.legs)
    this.legR = make(this.legs)

    this.applyConfig(cfg)
    this.updatePose(DEFAULT_POSE)
  }

  private segmentMeshes(key: SegmentKey): THREE.Mesh[] {
    switch (key) {
      case 'head':
        return [this.head]
      case 'torso':
        return [this.torso]
      case 'upperL':
        return [this.upperArmL, this.jointShoulderL]
      case 'foreL':
        return [this.forearmL, this.jointElbowL]
      case 'handL':
        return [this.handL]
      case 'upperR':
        return [this.upperArmR, this.jointShoulderR]
      case 'foreR':
        return [this.forearmR, this.jointElbowR]
      case 'handR':
        return [this.handR]
    }
  }

  /** 구멍 밖으로 나간 세그먼트만 빨강으로. 빈 배열이면 전부 순백 복귀 (§7-4) */
  setOverflow(keys: readonly SegmentKey[]) {
    const set = new Set(keys)
    const all: SegmentKey[] = ['head', 'torso', 'upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR']
    for (const key of all) {
      const mat = set.has(key) ? this.overflowMaterial : this.material
      for (const mesh of this.segmentMeshes(key)) mesh.material = mat
    }
  }

  /** 슬라이더로 비율이 바뀔 때 지오메트리만 갈아 끼운다 (머티리얼·씬 그래프 유지) */
  applyConfig(cfg: BodyFitConfig['avatar']) {
    this.cfg = cfg
    const upperLen = UPPER_ARM_LEN * cfg.limbScale
    const foreLen = FOREARM_LEN * cfg.limbScale
    const legLen = LEG_LEN * cfg.limbScale
    const r = cfg.capsuleRadius
    const legR = r * LEG_R_MUL
    const handR = r * HAND_R_MUL

    const swap = (mesh: THREE.Mesh, geo: THREE.BufferGeometry) => {
      mesh.geometry.dispose()
      mesh.geometry = geo
    }
    swap(this.head, new THREE.SphereGeometry(cfg.headRadius, 32, 24))
    swap(this.torso, new THREE.CapsuleGeometry(TORSO_RADIUS, TORSO_LEN, 8, 24))
    swap(this.upperArmL, new THREE.CapsuleGeometry(r, upperLen, 6, 16))
    swap(this.upperArmR, new THREE.CapsuleGeometry(r, upperLen, 6, 16))
    swap(this.forearmL, new THREE.CapsuleGeometry(r, foreLen, 6, 16))
    swap(this.forearmR, new THREE.CapsuleGeometry(r, foreLen, 6, 16))
    swap(this.handL, new THREE.SphereGeometry(handR, 16, 12))
    swap(this.handR, new THREE.SphereGeometry(handR, 16, 12))
    for (const joint of [this.jointShoulderL, this.jointShoulderR, this.jointElbowL, this.jointElbowR])
      swap(joint, new THREE.SphereGeometry(r, 16, 12))
    swap(this.legL, new THREE.CapsuleGeometry(legR, legLen, 6, 16))
    swap(this.legR, new THREE.CapsuleGeometry(legR, legLen, 6, 16))

    // 다리 고정 포즈 — legs 그룹 로컬 좌표(원점 = 힙 중점)
    setBetween(this.legL, -HIP_HALF_WIDTH, 0, -HIP_HALF_WIDTH - LEG_SPLAY, -legLen)
    setBetween(this.legR, HIP_HALF_WIDTH, 0, HIP_HALF_WIDTH + LEG_SPLAY, -legLen)
    // STAGE_SCALE을 곱해 월드 값으로 내보낸다 — 소비자(stage.setFloorY)는 월드 Y를 기대하고,
    // group에 같은 배율이 걸려 있어 실제 발바닥도 이 높이에 온다. STAGE_DROP까지 더해야
    // 포디움이 내려앉은 아바타를 그대로 따라간다.
    this.floorY = -(TORSO_LEN + legLen + legR) * STAGE_SCALE + STAGE_DROP
  }

  /** 매 프레임: 정규화 포즈 → 공유 솔버 → 각 메시의 position/quaternion 갱신 */
  updatePose(p: NormalizedPose) {
    this.applySolved(solveSkeleton(p, this.cfg, this.state))
  }

  /**
   * 이미 풀린 골격을 그대로 입힌다 — 출제 포즈처럼 솔버를 다시 돌릴 필요가 없을 때.
   * 목표 포즈 썸네일(createPoseThumb)이 판정·벽과 <b>같은</b> SolvedSkeleton을 쓰게 하는 통로다.
   */
  applySolved(s: SolvedSkeleton) {
    this.lastSolved = s

    setBetween(this.torso, 0, 0, s.hip.x, s.hip.y)
    this.head.position.set(s.head.x, s.head.y, 0)

    setBetween(this.upperArmL, s.shoulderL.x, s.shoulderL.y, s.elbowL.x, s.elbowL.y, ARM_Z_SHOULDER, s.elbowL.z)
    setBetween(this.forearmL, s.elbowL.x, s.elbowL.y, s.wristL.x, s.wristL.y, s.elbowL.z, s.wristL.z)
    this.handL.position.set(s.wristL.x, s.wristL.y, s.wristL.z)
    this.jointShoulderL.position.set(s.shoulderL.x, s.shoulderL.y, ARM_Z_SHOULDER)
    this.jointElbowL.position.set(s.elbowL.x, s.elbowL.y, s.elbowL.z)

    setBetween(this.upperArmR, s.shoulderR.x, s.shoulderR.y, s.elbowR.x, s.elbowR.y, ARM_Z_SHOULDER, s.elbowR.z)
    setBetween(this.forearmR, s.elbowR.x, s.elbowR.y, s.wristR.x, s.wristR.y, s.elbowR.z, s.wristR.z)
    this.handR.position.set(s.wristR.x, s.wristR.y, s.wristR.z)
    this.jointShoulderR.position.set(s.shoulderR.x, s.shoulderR.y, ARM_Z_SHOULDER)
    this.jointElbowR.position.set(s.elbowR.x, s.elbowR.y, s.elbowR.z)

    // 다리 그룹은 힙 위치만 따라간다 (자세 고정, §5-4)
    this.legs.position.set(s.hip.x, s.hip.y, 0)

    // 힙 앵커: 힙을 월드 (0, -TORSO_LEN)에 고정 — 발이 땅에 붙고 상체가 호를 그린다.
    // 앵커는 아바타 단위라 STAGE_SCALE을 곱해야 한다 — group.position은 자신의 scale을
    // 받지 않으므로, 안 곱하면 몸을 기울일 때 구멍과 아바타가 어긋난다(2026-07-28).
    this.group.position.set(
      s.anchor.x * STAGE_SCALE,
      s.anchor.y * STAGE_SCALE + STAGE_DROP,
      0,
    )
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    })
    this.material.dispose()
    this.overflowMaterial.dispose()
  }
}
