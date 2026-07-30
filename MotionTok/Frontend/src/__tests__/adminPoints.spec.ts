/**
 * 관리자 포인트 내역(-106 후속) 표기 규칙.
 *
 * 여기서 고정하는 것: 방향은 <b>amount의 부호</b>로만 판단하고(유형으로 판단하면 AI 생성과
 * 환급이 뒤집힌다), 목록 금액은 원장 그대로 부호를 유지한다는 것.
 */
import { describe, expect, it } from 'vitest'
import { POINT_TYPE_LABEL, formatPoint, pointDirectionOf } from '@/features/admin/points'

describe('포인트 방향 판정', () => {
  it('부호로 가른다', () => {
    expect(pointDirectionOf(300)).toBe('EARN')
    expect(pointDirectionOf(-120)).toBe('SPEND')
  })

  it('유형이 같아도 부호가 다르면 방향이 다르다 — AI 생성은 차감, 환급은 적립', () => {
    // 유형만 보고 판단하면 AI_GENERATE_REFUND(항상 양수)가 사용 내역으로 분류된다.
    expect(pointDirectionOf(-500)).toBe('SPEND')
    expect(pointDirectionOf(500)).toBe('EARN')
  })

  it('0은 적립으로 접는다 — 서버가 만들지 않는 값이지만 사용으로 읽으면 합계와 어긋난다', () => {
    expect(pointDirectionOf(0)).toBe('EARN')
  })
})

describe('금액 표기', () => {
  it('부호를 명시하고 천 단위를 끊는다', () => {
    expect(formatPoint(1500)).toBe('+1,500P')
    expect(formatPoint(-1200)).toBe('-1,200P')
  })

  it('0에는 부호를 붙이지 않는다', () => {
    expect(formatPoint(0)).toBe('0P')
  })
})

describe('유형 라벨', () => {
  it('서버 enum 다섯 값을 모두 덮는다 — 빠지면 목록에 raw enum이 노출된다', () => {
    expect(Object.keys(POINT_TYPE_LABEL).sort()).toEqual([
      'AI_GENERATE',
      'AI_GENERATE_REFUND',
      'GAME_REWARD',
      'GUEST_MIGRATE',
      'SHOP_PURCHASE',
    ])
  })

  it('차감과 환급을 이름으로 구분한다', () => {
    expect(POINT_TYPE_LABEL.AI_GENERATE).not.toBe(POINT_TYPE_LABEL.AI_GENERATE_REFUND)
  })
})
