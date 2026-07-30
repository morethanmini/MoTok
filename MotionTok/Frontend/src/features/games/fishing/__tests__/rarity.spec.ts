import { describe, expect, it } from 'vitest'
import { FISH } from '../fight'
import { fishRadius, fishShape, rarityColor } from '../render/skins/cozy'

/**
 * 희귀도 표현의 불변식.
 *
 * 계측 스킨은 반지름을 `8 + (1 - requiredRate) * 14`로 계산해서, requiredRate가 가장 높은
 * 상어가 반지름 0에 가까워진다 — **제일 귀한 물고기가 제일 작게** 그려진다. 눈으로는 "작은
 * 물고기가 하나 지나갔다" 정도로만 보여서 오래 못 잡았다. 정식 스킨에서 점수 기준으로 뒤집었고,
 * 다시 뒤집히지 않게 여기서 못 박는다.
 *
 * 캔버스 렌더 자체는 jsdom에서 못 돌리므로 매핑 함수만 검사한다.
 */
describe('희귀도 표현', () => {
  const byScore = [...FISH].sort((a, b) => a.score - b.score)

  it('점수가 높을수록 크다', () => {
    for (let i = 1; i < byScore.length; i++) {
      expect(fishRadius(byScore[i]!)).toBeGreaterThan(fishRadius(byScore[i - 1]!))
    }
  })

  it('가장 귀한 어종이 가장 크다 — 계측 스킨의 뒤집힌 공식을 되풀이하지 않는다', () => {
    const cheapest = byScore[0]!
    const priciest = byScore[byScore.length - 1]!
    expect(priciest.name).toBe('상어')
    expect(fishRadius(priciest)).toBeGreaterThan(fishRadius(cheapest) * 1.8)
  })

  it('희귀도 구간마다 몸 모양이 다르다 — 색만으로는 안 읽힌다', () => {
    const shapes = new Set(FISH.map(fishShape))
    expect(shapes.size).toBeGreaterThanOrEqual(4)
    expect(fishShape(byScore[0]!)).toBe('slim')
    expect(fishShape(byScore[byScore.length - 1]!)).toBe('shark')
  })

  it('색은 구간별로 갈리고, 흔한 어종과 최고 어종이 같은 색이 아니다', () => {
    expect(rarityColor(byScore[0]!)).not.toBe(rarityColor(byScore[byScore.length - 1]!))
    expect(new Set(FISH.map(rarityColor)).size).toBeGreaterThanOrEqual(4)
  })

  it('모양과 크기가 같은 방향으로 간다 — shark가 slim보다 크다', () => {
    const slim = FISH.filter((f) => fishShape(f) === 'slim')
    const shark = FISH.filter((f) => fishShape(f) === 'shark')
    const maxSlim = Math.max(...slim.map(fishRadius))
    const minShark = Math.min(...shark.map(fishRadius))
    expect(minShark).toBeGreaterThan(maxSlim)
  })
})
