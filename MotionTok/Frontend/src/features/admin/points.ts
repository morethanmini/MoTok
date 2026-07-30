/**
 * 관리자 포인트 내역 화면의 순수 로직 — 유형 라벨과 부호 표기.
 *
 * 뷰에서 떼어낸 이유는 `suspension.ts`와 같다 — 부호를 다루는 규칙이 화면 여러 곳
 * (목록 행·요약 카드·필터)에 흩어지면 한 곳에서 뒤집힌 값을 놓친다.
 */
import type { PointDirection, PointType } from '@/api'

/**
 * 적립·사용을 유형 이름에 드러낸다 — 목록에서 부호와 유형을 따로 읽게 하면
 * "AI 생성"이 차감인지 환급인지 매번 금액을 보고 되짚어야 한다.
 */
export const POINT_TYPE_LABEL: Record<PointType, string> = {
  GAME_REWARD: '게임 보상',
  SHOP_PURCHASE: '상점 구매',
  AI_GENERATE: 'AI 아이템 생성',
  AI_GENERATE_REFUND: 'AI 생성 환급',
  GUEST_MIGRATE: '게스트 기록 이관',
}

export const POINT_DIRECTION_LABEL: Record<PointDirection, string> = {
  EARN: '받아 간 내역',
  SPEND: '쓴 내역',
}

/**
 * 내역 한 줄의 방향. `amount`의 부호가 단일 원천이라 유형으로 판단하지 않는다 —
 * AI_GENERATE는 차감이고 AI_GENERATE_REFUND는 환급이어서 유형만으로는 알 수 없다.
 *
 * amount가 0인 행은 서버가 만들지 않지만, 들어오면 '적립'으로 접는다(부호 없는 0을
 * '사용'으로 읽으면 합계와 어긋난다).
 */
export function pointDirectionOf(amount: number): PointDirection {
  return amount < 0 ? 'SPEND' : 'EARN'
}

/**
 * 금액 표기 — 부호를 명시하고 천 단위를 끊는다.
 *
 * 사용 내역을 `-1,200P`로 그대로 보여 주는 이유: 요약 카드의 '쓴 금액'은 서버가 양수로
 * 뒤집어 주지만 목록은 원장 그대로여야 한다. 같은 행의 `balanceAfter`와 부호가 맞아떨어져야
 * 관리자가 잔액 흐름을 눈으로 검산할 수 있다.
 */
export function formatPoint(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  return `${sign}${Math.abs(amount).toLocaleString('ko-KR')}P`
}
