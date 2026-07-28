import { describe, it, expect } from 'vitest'
import {
  TOTAL_SECONDS,
  PINCH_DOWN_RATIO,
  PINCH_UP_RATIO,
  RELEASE_TRIM_MS,
  computeTurnSeconds,
  handRole,
  knuckleCenter,
  pinchRatio,
  pinchMidpoint,
  applyPinchHysteresis,
  isFist,
  trimStrokeTail,
  scoreForRank,
  findAnswerRank,
  parseGuesses,
  type NormalizedPoint,
  type StrokePoint,
} from '../features/games/drawing-relay/logic'

/** 21개 랜드마크 배열을 만들고 지정 인덱스만 좌표를 채운다 */
function handLandmarks(points: Record<number, [number, number]>): NormalizedPoint[] {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
  for (const [idx, [x, y]] of Object.entries(points)) {
    lm[Number(idx)] = { x, y }
  }
  return lm
}

describe('computeTurnSeconds', () => {
  it('총 150초를 인원수로 나눈다 (5명 → 30초, 6명 → 25초)', () => {
    expect(TOTAL_SECONDS).toBe(150)
    expect(computeTurnSeconds(2)).toBe(75)
    expect(computeTurnSeconds(5)).toBe(30)
    expect(computeTurnSeconds(6)).toBe(25)
    expect(computeTurnSeconds(1)).toBe(150)
  })

  it('나눠떨어지지 않으면 올림한다 (4명 → 38초, 8명 → 19초)', () => {
    expect(computeTurnSeconds(4)).toBe(38)
    expect(computeTurnSeconds(7)).toBe(22)
    expect(computeTurnSeconds(8)).toBe(19)
    expect(computeTurnSeconds(9)).toBe(17)
  })

  it('0 이하 인원은 0초', () => {
    expect(computeTurnSeconds(0)).toBe(0)
  })
})

describe('pinchRatio / applyPinchHysteresis', () => {
  it('엄지-검지 거리를 손 크기로 나눈 비율을 돌려준다', () => {
    // 손 크기(0→9) = 0.2, 엄지-검지 거리 = 0.05 → 비율 0.25
    const lm = handLandmarks({ 0: [0.5, 0.8], 9: [0.5, 0.6], 4: [0.4, 0.4], 8: [0.45, 0.4] })
    expect(pinchRatio(lm)).toBeCloseTo(0.25)
  })

  it('손 크기가 0이면 null', () => {
    const lm = handLandmarks({ 0: [0.5, 0.5], 9: [0.5, 0.5] })
    expect(pinchRatio(lm)).toBeNull()
  })

  it('히스테리시스 — 다운 임계 아래에서 내려가고 업 임계 위에서만 올라온다', () => {
    expect(applyPinchHysteresis(false, PINCH_DOWN_RATIO - 0.01)).toBe(true)
    expect(applyPinchHysteresis(false, PINCH_DOWN_RATIO + 0.01)).toBe(false)
    // 이미 다운이면 중간 구간에서도 유지
    expect(applyPinchHysteresis(true, (PINCH_DOWN_RATIO + PINCH_UP_RATIO) / 2)).toBe(true)
    expect(applyPinchHysteresis(true, PINCH_UP_RATIO + 0.01)).toBe(false)
  })

  it('손 미검출(null)이면 무조건 펜 업', () => {
    expect(applyPinchHysteresis(true, null)).toBe(false)
  })
})

describe('pinchMidpoint', () => {
  it('엄지·검지 끝의 중점을 돌려준다', () => {
    const lm = handLandmarks({ 4: [0.4, 0.4], 8: [0.5, 0.5] })
    expect(pinchMidpoint(lm)).toEqual({ x: 0.45, y: 0.45 })
  })

  it('랜드마크가 모자라면 null', () => {
    expect(pinchMidpoint([])).toBeNull()
  })
})

describe('isFist', () => {
  // 손목 (0.5, 0.9). 펴진 손가락은 끝이 PIP보다 손목에서 멀고, 접힌 손가락은 더 가깝다.
  const FOLDED: Record<number, [number, number]> = {
    0: [0.5, 0.9],
    6: [0.5, 0.6], 8: [0.5, 0.75],   // 검지: PIP 거리 0.3 > 끝 거리 0.15
    10: [0.5, 0.58], 12: [0.5, 0.74],
    14: [0.5, 0.6], 16: [0.5, 0.76],
    18: [0.5, 0.64], 20: [0.5, 0.78],
  }

  it('네 손가락 끝이 모두 PIP보다 손목에 가까우면 주먹', () => {
    expect(isFist(handLandmarks(FOLDED))).toBe(true)
  })

  it('한 손가락이라도 펴져 있으면 주먹이 아니다 (핀치 자세 오인 방지)', () => {
    // 검지만 앞으로 뻗은 자세 — 끝(0.3)이 PIP(0.6)보다 손목에서 멀다
    expect(isFist(handLandmarks({ ...FOLDED, 8: [0.5, 0.3] }))).toBe(false)
  })

  it('손목 랜드마크가 없으면 false', () => {
    const lm = handLandmarks(FOLDED)
    lm.length = 0
    expect(isFist(lm)).toBe(false)
  })
})

describe('handRole', () => {
  it('기본: 오른손=펜, 왼손=지우개', () => {
    expect(handRole('Right')).toBe('pen')
    expect(handRole('Left')).toBe('erase')
  })

  it('왼손잡이 모드(swapHands)면 역할이 반대', () => {
    expect(handRole('Right', true)).toBe('erase')
    expect(handRole('Left', true)).toBe('pen')
  })

  it('라벨이 없거나 알 수 없으면 null', () => {
    expect(handRole(undefined)).toBeNull()
    expect(handRole('Unknown')).toBeNull()
  })
})

describe('knuckleCenter', () => {
  it('네 손가락 MCP 관절의 중심을 돌려준다', () => {
    const lm = handLandmarks({ 5: [0.4, 0.4], 9: [0.5, 0.4], 13: [0.6, 0.4], 17: [0.7, 0.4] })
    const c = knuckleCenter(lm)
    expect(c?.x).toBeCloseTo(0.55)
    expect(c?.y).toBeCloseTo(0.4)
  })

  it('관절 랜드마크가 모자라면 null', () => {
    expect(knuckleCenter([])).toBeNull()
  })
})

describe('trimStrokeTail', () => {
  const pts = (ts: number[]): StrokePoint[] => ts.map((t, i) => ({ x: i, y: i, t }))

  it('펜을 놓기 직전 구간의 꼬리 점을 삭제한다', () => {
    const stroke = pts([0, 50, 100, 150, 200, 250, 300])
    const trimmed = trimStrokeTail(stroke, 300, 160)
    expect(trimmed.map((p) => p.t)).toEqual([0, 50, 100]) // 140(=300-160) 이후는 꼬리
  })

  it('획 전체가 꼬리 구간이면 첫 점(찍은 점)만 남긴다', () => {
    const stroke = pts([0, 30, 60, 90])
    expect(trimStrokeTail(stroke, 100, RELEASE_TRIM_MS)).toEqual(stroke.slice(0, 1))
  })

  it('점이 하나뿐이면 그대로 둔다', () => {
    const stroke = pts([0])
    expect(trimStrokeTail(stroke, 1000)).toEqual(stroke)
  })
})

describe('scoreForRank', () => {
  it('1순위 100점, 3순위 60점, 5순위 20점', () => {
    expect(scoreForRank(1)).toBe(100)
    expect(scoreForRank(2)).toBe(80)
    expect(scoreForRank(3)).toBe(60)
    expect(scoreForRank(4)).toBe(40)
    expect(scoreForRank(5)).toBe(20)
  })

  it('순위 밖(0, 6)은 0점', () => {
    expect(scoreForRank(0)).toBe(0)
    expect(scoreForRank(6)).toBe(0)
  })
})

describe('findAnswerRank', () => {
  it('정확히 일치하는 추측의 순위(1-based)를 돌려준다', () => {
    expect(findAnswerRank('사과', ['수박', '사과', '공'])).toBe(2)
    expect(findAnswerRank('사과', ['사과'])).toBe(1)
  })

  it('공백·대소문자·따옴표를 무시하고 비교한다', () => {
    expect(findAnswerRank('아이스크림', ['"아이스 크림"'])).toBe(1)
    expect(findAnswerRank('Robot', ['robot'])).toBe(1)
  })

  it('두 글자 이상이면 포함 관계도 정답 ("사과나무" ↔ "사과")', () => {
    expect(findAnswerRank('사과', ['사과나무'])).toBe(1)
    expect(findAnswerRank('사과나무', ['수박', '사과'])).toBe(2)
  })

  it('한 글자 주제는 포함 관계를 인정하지 않는다 ("배" ↔ "배구")', () => {
    expect(findAnswerRank('배', ['배구', '바다'])).toBe(0)
    expect(findAnswerRank('배', ['배'])).toBe(1)
  })

  it('추측에 없으면 0', () => {
    expect(findAnswerRank('사과', ['수박', '공', '달'])).toBe(0)
  })
})

describe('parseGuesses', () => {
  it('JSON 배열 응답을 파싱한다 (앞뒤 설명이 있어도)', () => {
    expect(parseGuesses('추측 결과: ["사과","수박","공","달","바퀴"] 입니다')).toEqual([
      '사과', '수박', '공', '달', '바퀴',
    ])
  })

  it('번호 목록 응답을 파싱한다', () => {
    expect(parseGuesses('1. 사과\n2) 수박\n- 공')).toEqual(['사과', '수박', '공'])
  })

  it('최대 5개까지만 돌려준다', () => {
    expect(parseGuesses('["a","b","c","d","e","f"]')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
