import { describe, it, expect } from 'vitest'
import { CONSTELLATIONS } from '../features/games/finger-star/constellations'

/**
 * 별자리 데이터 기하 검증 — 게임 제약(logic.ts 상수)에서 유도한 규칙.
 * scripts/generate-constellations.mjs의 생성 시 검증과 같은 취지로,
 * 손으로 추가·수정된 데이터까지 포함해 이 테스트가 최종 게이트가 된다.
 */

/** 별 개수: 열 손가락 상한 10, 판정·점수가 의미 있으려면 최소 5 */
const MIN_STARS = 5
const MAX_STARS = 10
/**
 * 최소 점간 거리 — 판정 반경 비율(HIT_RADIUS_RATIO 0.08)과 같은 단위.
 * 기존 오리온 벨트(≈0.069)가 플레이 가능이 실증된 하한이라 그 아래만 차단한다.
 */
const MIN_PAIR_DIST = 0.065

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

describe('CONSTELLATIONS 데이터 검증', () => {
  it('key가 고유하다', () => {
    const keys = CONSTELLATIONS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it(`별 개수가 ${MIN_STARS}~${MAX_STARS}개다`, () => {
    for (const c of CONSTELLATIONS) {
      expect(c.pts.length, c.key).toBeGreaterThanOrEqual(MIN_STARS)
      expect(c.pts.length, c.key).toBeLessThanOrEqual(MAX_STARS)
    }
  })

  it('모든 좌표가 0~1 범위다', () => {
    for (const c of CONSTELLATIONS) {
      for (const [x, y] of c.pts) {
        expect(x, c.key).toBeGreaterThanOrEqual(0)
        expect(x, c.key).toBeLessThanOrEqual(1)
        expect(y, c.key).toBeGreaterThanOrEqual(0)
        expect(y, c.key).toBeLessThanOrEqual(1)
      }
    }
  })

  it('별끼리 판정 원이 겹치지 않을 만큼 떨어져 있다', () => {
    for (const c of CONSTELLATIONS) {
      for (let i = 0; i < c.pts.length; i++) {
        for (let j = i + 1; j < c.pts.length; j++) {
          expect(dist(c.pts[i]!, c.pts[j]!), `${c.key} 점 ${i}-${j}`).toBeGreaterThanOrEqual(
            MIN_PAIR_DIST,
          )
        }
      }
    }
  })

  it('도안이 정규화 박스를 채운다 (큰 축 span ≈ 1)', () => {
    for (const c of CONSTELLATIONS) {
      const xs = c.pts.map((p) => p[0])
      const ys = c.pts.map((p) => p[1])
      const span = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      )
      expect(span, c.key).toBeGreaterThanOrEqual(0.95)
    }
  })

  it('난이도 티어가 모두 채워져 있다 (도전 모드 덱 전제)', () => {
    for (const tier of ['EASY', 'NORMAL', 'HARD'] as const) {
      expect(
        CONSTELLATIONS.filter((c) => c.difficulty === tier).length,
        tier,
      ).toBeGreaterThanOrEqual(1)
    }
  })
})
