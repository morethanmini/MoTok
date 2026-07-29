/**
 * 게임④ 랜덤 출제 — 사람 대신 코드가 벽 구멍 포즈를 만든다.
 *
 * <p>출력이 MediaPipe Pose와 같은 33점 랜드마크 배열이라는 게 이 모듈의 전부다. 그래서
 * 카메라로 잡은 포즈와 <b>완전히 같은 경로</b>(normalizePose → solveSkeleton → wall.build,
 * 멀티는 POSE_SET 전송)를 타고, 아래 파이프라인은 이게 사람인지 생성물인지 알 필요가 없다.
 * 판정·구멍·썸네일·난이도 별점이 전부 그대로 동작한다.</p>
 *
 * <p>포즈는 아바타 공간(어깨너비=1, y 위가 +)에서 각도로 정의하고 마지막에 이미지 좌표로
 * 되돌린다 — `normalizePose(lm, true)`의 정확한 역변환이라, 여기 적은 각도가 그대로
 * 아바타에 재현된다. 팔은 REF 길이만큼 뻗은 상태로 만들어 화면 안(z=0)에 눕는다:
 * 단축법(§5-5)이 개입하지 않으니 "적은 각도 = 보이는 각도"가 보장된다.</p>
 */
import { REF_FORE_INIT, REF_UPPER_INIT, type LandmarkPoint } from './skeleton'

/** 팔 각도는 도(degree), 아바타 공간에서 +x가 0°이고 반시계가 +다 (90° = 위) */
type Arm = readonly [upper: number, fore: number]

/**
 * 출제 포즈 원형 — 사람이 실제로 따라할 수 있고, 실루엣이 차렷과 확실히 다른 것만 골랐다.
 * 완전 무작위 각도는 팔이 몸통에 파묻히거나 재현 불가능한 그림이 나와서 쓰지 않는다.
 * 여기가 이 기능의 튜닝 노브다 — 재미없으면 각도를 고치거나 항목을 늘리면 된다.
 */
const ARCHETYPES: readonly { name: string; l: Arm; r: Arm }[] = [
  // 대칭 — 거울로 따라하기 쉬운 쪽(2~4★)
  { name: 'T자', l: [180, 180], r: [0, 0] },
  { name: '만세', l: [130, 130], r: [50, 50] },
  { name: '선인장', l: [180, 90], r: [0, 90] },
  { name: '주전자', l: [250, 340], r: [290, 200] },
  { name: '팔짱', l: [250, 10], r: [290, 170] },
  { name: '머리위삼각', l: [110, 20], r: [70, 160] },
  { name: 'W자', l: [205, 120], r: [335, 60] },
  { name: '하트', l: [95, 5], r: [85, 175] },
  { name: '브이자', l: [205, 205], r: [335, 335] },
  { name: '엑스자', l: [100, 350], r: [80, 190] },
  { name: '로봇', l: [180, 0], r: [0, 180] },
  { name: '다이빙', l: [95, 85], r: [85, 95] },
  { name: '문틀', l: [180, 270], r: [0, 270] },
  { name: '항아리', l: [225, 315], r: [315, 225] },
  { name: '올려막기', l: [200, 60], r: [340, 120] },
  { name: '하이파이브', l: [150, 100], r: [30, 80] },
  { name: '헤드폰', l: [150, 20], r: [30, 160] },
  { name: '나팔', l: [110, 180], r: [70, 0] },
  { name: '근육자랑', l: [210, 70], r: [330, 110] },
  { name: '노젓기', l: [235, 195], r: [305, 345] },
  // 비대칭 — 좌우 반전이 새 모양이 되는 쪽(3~5★)
  { name: '한손번쩍', l: [130, 130], r: [285, 285] },
  { name: '지그재그', l: [180, 90], r: [0, 275] },
  { name: '경례', l: [255, 255], r: [60, 170] },
  { name: '사선', l: [180, 180], r: [60, 60] },
  { name: '웨이터', l: [250, 340], r: [60, 60] },
  { name: '바람', l: [20, 20], r: [20, 20] },
  { name: '디스코', l: [135, 135], r: [315, 315] },
  { name: '스트레칭', l: [250, 255], r: [70, 200] },
  { name: '가로막기', l: [290, 170], r: [0, 0] },
  { name: '갈고리', l: [175, 265], r: [20, 105] },
  { name: '어깨동무', l: [250, 250], r: [30, 165] },
  { name: '국기게양', l: [90, 90], r: [0, 0] },
  { name: '에스자', l: [100, 30], r: [290, 200] },
  { name: '세시십오분', l: [180, 180], r: [270, 270] },
  { name: '백조', l: [110, 60], r: [320, 320] },
  { name: '낫', l: [180, 270], r: [60, 60] },
  { name: '반만세', l: [130, 130], r: [70, 180] },
  { name: '균형', l: [90, 90], r: [270, 270] },
]

/** 원형 개수 — 테스트가 전 원형을 빠짐없이 돌 수 있게 노출한다 */
export const POSE_COUNT = ARCHETYPES.length

/** 원형을 알아볼 수 있을 만큼만 흔든다(도) — 라운드마다 같은 T자가 나오면 금방 질린다 */
const JITTER_DEG = 12
/** 머리·허리 기울기 흔들기(도). solveSkeleton이 headGain·leanGain으로 증폭하므로 작게 준다 */
const TILT_DEG = 9

// ── 랜드마크 인덱스 (skeleton.ts가 읽는 11개만 채운다) ──
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
const LANDMARK_COUNT = 33

/** 이미지 좌표계 배치 — 어깨 중점 위치와 어깨너비(프레임 폭 대비). 손이 프레임을 벗어나지 않는 값 */
const FRAME_CX = 0.5
const FRAME_CY = 0.42
const FRAME_SW = 0.22

/** 몸통 길이·힙 반폭 — 아바타 공간. skeleton.ts의 TORSO_LEN·HIP_HALF_WIDTH와 같은 뜻이지만
 *  여기서는 "랜드마크를 어디 찍을까"라서 정확히 일치할 필요가 없다(방향만 읽힌다) */
const HIP_DIST = 0.85
const HIP_HALF = 0.2
/** 귀 중점이 headUp이 된다 — 두 귀를 이 폭만큼 벌려 중점이 의도한 머리 방향에 오게 한다 */
const EAR_HALF = 0.08
const HEAD_DIST = 0.5

interface Vec {
  x: number
  y: number
}

const rad = (deg: number) => (deg * Math.PI) / 180
const jitter = (rng: Rng, deg: number, spread: number) => deg + (rng() * 2 - 1) * spread
const step = (from: Vec, deg: number, len: number): Vec => ({
  x: from.x + Math.cos(rad(deg)) * len,
  y: from.y + Math.sin(rad(deg)) * len,
})

/** 좌우 반전 — x축 반사(각도 θ → 180−θ)에 팔 교환까지. 비대칭 포즈의 가짓수가 공짜로 두 배 */
function flip(a: { name: string; l: Arm; r: Arm }): { name: string; l: Arm; r: Arm } {
  const mirror = ([u, f]: Arm): Arm => [180 - u, 180 - f]
  return { name: a.name, l: mirror(a.r), r: mirror(a.l) }
}

export interface RandomPose {
  /** 원형 이름 — UI에 "지금 무슨 포즈인지" 보여줄 때 쓴다(판정과 무관) */
  name: string
  /** MediaPipe Pose와 같은 33점 랜드마크 — 카메라 캡처와 같은 경로로 흘려보낸다 */
  landmarks: LandmarkPoint[]
}

/** 0 이상 1 미만 난수 생성기 — 방에서는 서버 시드로 만든 것을 넣어 전원이 같은 포즈를 받는다 */
export type Rng = () => number

/**
 * 랜덤 출제 포즈 하나.
 *
 * <p>원형 하나를 골라 좌우를 뒤집을지 정하고, 각도에 지터를 준 뒤 랜드마크로 굽는다.</p>
 *
 * <p>난수를 인자로 받는 이유 — 원형 선택·좌우 반전·지터·기울기가 모두 난수를 쓰므로, 방에서
 * 같은 벽을 보려면 이 네 곳이 <b>전부</b> 같은 수열을 써야 한다. pick만 맞춰도 실루엣이 갈린다.</p>
 *
 * @param pick 원형 인덱스 — 기본은 랜덤. 테스트가 전 원형을 빠짐없이 돌기 위한 이음새다.
 * @param rng 난수원 — 기본은 Math.random(솔로). 연속 모드 멀티는 시드 PRNG를 넘긴다.
 */
export function randomPose(pick?: number, rng: Rng = Math.random): RandomPose {
  const base = ARCHETYPES[(pick ?? Math.floor(rng() * ARCHETYPES.length)) % ARCHETYPES.length]!
  const a = rng() < 0.5 ? base : flip(base)

  const shoulderL: Vec = { x: -0.5, y: 0 }
  const shoulderR: Vec = { x: 0.5, y: 0 }
  const arm = (shoulder: Vec, [upper, fore]: Arm) => {
    const elbow = step(shoulder, jitter(rng, upper, JITTER_DEG), REF_UPPER_INIT)
    return { elbow, wrist: step(elbow, jitter(rng, fore, JITTER_DEG), REF_FORE_INIT) }
  }
  const armL = arm(shoulderL, a.l)
  const armR = arm(shoulderR, a.r)

  // 머리는 위(90°), 힙은 아래(270°) 기준에서 살짝 기울인다
  const head = step({ x: 0, y: 0 }, jitter(rng, 90, TILT_DEG), HEAD_DIST)
  const hip = step({ x: 0, y: 0 }, jitter(rng, 270, TILT_DEG), HIP_DIST)

  const lm: LandmarkPoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }))
  // 아바타 공간 → 이미지 좌표: normalizePose(mirror=true)의 역변환
  const put = (i: number, p: Vec) => {
    lm[i] = { x: FRAME_CX - p.x * FRAME_SW, y: FRAME_CY - p.y * FRAME_SW, z: 0, visibility: 1 }
  }
  put(NOSE, head)
  put(EAR_L, { x: head.x + EAR_HALF, y: head.y })
  put(EAR_R, { x: head.x - EAR_HALF, y: head.y })
  put(SHOULDER_L, shoulderL)
  put(SHOULDER_R, shoulderR)
  put(ELBOW_L, armL.elbow)
  put(WRIST_L, armL.wrist)
  put(ELBOW_R, armR.elbow)
  put(WRIST_R, armR.wrist)
  put(HIP_L, { x: hip.x + HIP_HALF, y: hip.y })
  put(HIP_R, { x: hip.x - HIP_HALF, y: hip.y })

  return { name: a.name, landmarks: lm }
}
