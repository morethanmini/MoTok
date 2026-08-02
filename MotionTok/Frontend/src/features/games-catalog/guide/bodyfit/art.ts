/**
 * 몸 끼워 맞추기 안내 그림 공용 색·포즈.
 *
 * 색은 실제 게임(body-fit/BodyFitGame.vue의 --bf-* 변수, wall.ts, avatarRig.ts)에서 가져왔다.
 *
 * 사람은 관절 각도로 그린다 — 포즈가 이 게임의 전부라, 장마다 같은 몸으로 각도만 바꿔야
 * "같은 사람이 다른 포즈를 취한다"가 읽힌다. 벽 구멍도 같은 포즈 데이터로 뚫으므로
 * 사람과 구멍이 저절로 맞물린다(핑거 스타에서 별을 손끝 좌표로 잡은 것과 같은 방식).
 */

export const VIEW_W = 320
export const VIEW_H = 220

export const BG = '#221d1a'
export const FLOOR = '#3a332e'
export const SLAB = '#4a4038'
export const SLAB_EDGE = '#7d7059'
/** 구멍 테두리 — 실제 화면에서 금색으로 빛난다. */
export const RIM = '#ffd45d'
export const RIM_GLOW = '#ffbd3e'
/** 아바타(크림) · 구멍 밖으로 삐져나온 부위(주황빨강). */
export const AVATAR = '#e8dcc4'
export const OVERFLOW = '#db4f30'
export const TEXT = '#f2e6d2'
export const MUTED = '#a8977f'
/** 카메라 앞의 진짜 사람 — 화면 속 아바타(크림)와 구분되게 조금 어둡게. */
export const PLAYER = '#b9a88c'
/** 등급 색 — PERFECT 보라 · GREAT 이끼 · PASS 금 · FAIL 테라코타. */
export const PERFECT = '#c9a6ff'
export const GREAT = '#7fb98a'
export const GOLD = '#e8b84b'
export const FAIL = '#d9694f'

/** 관절 각도(도) — 0 = 어깨에서 바깥쪽 수평, 음수 = 위로. */
export interface Pose {
  /** [위팔, 아래팔] 각도. 왼쪽(화면 기준) 팔. */
  armL: [number, number]
  armR: [number, number]
  /** 다리 벌림(도). */
  legs: number
}

/** 만세 — 두 팔을 위로. */
export const POSE_CHEER: Pose = { armL: [-72, -80], armR: [-72, -80], legs: 14 }
/**
 * 한손 번쩍 — 한쪽만 위로, 다른 쪽은 옆으로.
 * 팔을 수직으로 세우면 머리 옆에 붙어 사람이 아니라 글자처럼 보인다(첫 시안). 바깥으로 벌린다.
 */
export const POSE_ONE_UP: Pose = { armL: [-56, -70], armR: [12, 28], legs: 12 }
/** 주전자 — 한 손은 허리, 한 손은 옆으로 꺾어 올림. */
export const POSE_TEAPOT: Pose = { armL: [30, 110], armR: [-10, -66], legs: 10 }
/**
 * 주전자에서 <b>왼팔만</b> 어긋난 포즈 — 실패 장(7장) 전용.
 * 두 팔이 다 어긋나면 "구멍과 다르다"가 아니라 "아예 딴 포즈"로 보여서, 어디가 틀렸는지
 * 짚을 수 없다. 하나만 틀려야 그 하나가 빨개지는 그림이 성립한다.
 */
export const POSE_MISS: Pose = { armL: [-68, -76], armR: [-10, -66], legs: 10 }

/**
 * 어깨에서 뻗는 두 마디(위팔·아래팔) 끝점. dir은 화면 왼팔이면 -1, 오른팔이면 +1.
 * 각도는 바깥쪽 수평이 0이고 위로 갈수록 음수라, 아이가 보는 그림과 부호가 같다.
 */
export function armPoints(
  shoulder: { x: number; y: number },
  angles: [number, number],
  dir: -1 | 1,
  upper: number,
  fore: number,
) {
  const a0 = (angles[0] * Math.PI) / 180
  const elbow = { x: shoulder.x + dir * upper * Math.cos(a0), y: shoulder.y + upper * Math.sin(a0) }
  const a1 = (angles[1] * Math.PI) / 180
  const hand = { x: elbow.x + dir * fore * Math.cos(a1), y: elbow.y + fore * Math.sin(a1) }
  return { elbow, hand }
}
