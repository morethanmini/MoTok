/**
 * 게임④ 랜덤 출제 — 생성 포즈가 카메라 포즈와 같은 파이프라인을 그대로 통과하는지.
 *
 * randomPose()는 아바타 공간에서 각도로 포즈를 정의하고 이미지 좌표로 되돌려 내보낸다.
 * 그 역변환이 틀리면 벽 구멍이 어긋나는데, 화면으로는 "좀 이상한 포즈"로만 보여서 안 잡힌다.
 * 여기서 왕복(생성 → normalizePose → solveSkeleton)을 고정한다.
 *
 * 무작위 표본이 아니라 <b>원형을 인덱스로 전부 순회</b>한다 — 원형이 늘어날 때 새로 넣은
 * 항목만 각도가 틀려도 확률로 넘어가지 않고 반드시 걸린다. 좌우 반전·지터는 그 안에서 랜덤이라
 * 원형마다 여러 번 돌린다.
 */
import { describe, expect, it } from 'vitest'
import { POSE_COUNT, randomPose } from '@/features/games/body-fit/randomPose'
import {
  FOREARM_LEN,
  UPPER_ARM_LEN,
  normalizePose,
  solveSkeleton,
  createSkeletonState,
} from '@/features/games/body-fit/skeleton'
import { poseDifficulty } from '@/features/games/body-fit/judge'
import { defaultConfig } from '@/features/games/body-fit/config'

const cfg = defaultConfig()
/** 원형당 표본 수 — 좌우 반전(50%)과 각도 지터를 여러 번 밟게 한다 */
const PER_POSE = 12
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** 원형 i를 PER_POSE번씩, 전 원형에 대해 (원형이름, 풀린 골격) 목록으로 */
function everyPose() {
  const out: { name: string; solved: ReturnType<typeof solveSkeleton> }[] = []
  for (let i = 0; i < POSE_COUNT; i++) {
    for (let n = 0; n < PER_POSE; n++) {
      const p = randomPose(i)
      const normalized = normalizePose(p.landmarks, true)
      // 어깨가 안 잡히면 포즈 자체가 성립하지 않는다 — 여기서 끊고 알려준다
      expect(normalized, `${p.name}: 정규화 실패`).not.toBeNull()
      out.push({
        name: p.name,
        solved: solveSkeleton(normalized!, cfg.avatar, createSkeletonState()),
      })
    }
  }
  return out
}

describe('randomPose', () => {
  it('어깨가 ±0.5로 정확히 되돌아온다 — 이미지 좌표 역변환 검증', () => {
    for (let i = 0; i < POSE_COUNT; i++) {
      const n = normalizePose(randomPose(i).landmarks, true)!
      // 아바타 공간의 어깨 위치(skeleton.ts DEFAULT_POSE와 같은 값)
      expect(n.shoulderL.x).toBeCloseTo(-0.5, 6)
      expect(n.shoulderR.x).toBeCloseTo(0.5, 6)
      expect(n.shoulderL.y).toBeCloseTo(0, 6)
      expect(n.shoulderR.y).toBeCloseTo(0, 6)
      // 팔·머리·힙이 전부 신뢰도 통과 상태여야 포즈가 온전히 재현된다
      expect(n.elbowL).not.toBeNull()
      expect(n.elbowR).not.toBeNull()
      expect(n.wristL).not.toBeNull()
      expect(n.wristR).not.toBeNull()
      expect(n.headUp).not.toBeNull()
      expect(n.hipMid).not.toBeNull()
    }
  })

  it('팔이 화면 안에 쭉 뻗은 상태로 풀린다 — 단축법에 각도가 깎이지 않는다', () => {
    const upper = UPPER_ARM_LEN * cfg.avatar.limbScale
    const fore = FOREARM_LEN * cfg.avatar.limbScale
    for (const { name, solved: s } of everyPose()) {
      // REF 길이(skeleton.ts)로 만들었으므로 본이 완전히 뻗는다 = 투영 길이 == 본 길이
      expect(dist(s.shoulderL, s.elbowL), name).toBeCloseTo(upper, 6)
      expect(dist(s.shoulderR, s.elbowR), name).toBeCloseTo(upper, 6)
      expect(dist(s.elbowL, s.wristL), name).toBeCloseTo(fore, 6)
      expect(dist(s.elbowR, s.wristR), name).toBeCloseTo(fore, 6)
    }
  })

  it('차렷 같은 맹탕 포즈는 어떤 원형에서도 나오지 않는다', () => {
    // 랩 측정 기준(judge.ts 주석): 차렷 0.04. 차렷의 3배면 "팔을 뭔가 했다"고 볼 수 있다.
    // 0.12라는 숫자의 근거 — 지터(±12°) 전 조합을 다 훑어 나온 최악값이 브이자 0.133,
    // 주전자 0.148이다. 이 아래로 내려가는 원형을 새로 넣으면 여기서 걸린다.
    for (const { name, solved } of everyPose()) {
      expect(poseDifficulty(solved), name).toBeGreaterThan(0.12)
    }
  })

  it('난이도 별점이 한쪽에 쏠리지 않는다 — 2★~5★가 다 나온다', () => {
    const diffs = everyPose().map((p) => poseDifficulty(p.solved))
    expect(Math.min(...diffs)).toBeLessThan(0.3) // 쉬운 문제도 있다
    expect(Math.max(...diffs)).toBeGreaterThan(0.5) // 어려운 문제도 있다
  })

  it('원형이 넉넉하다 — 60번 뽑아 대부분 다른 포즈가 나온다', () => {
    const names = new Set(Array.from({ length: 60 }, () => randomPose().name))
    expect(names.size).toBeGreaterThan(12)
  })
})
