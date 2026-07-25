import { describe, it, expect } from 'vitest'
import { containsProfanity } from '@/utils/profanity'

// 테스트에도 원문 비속어를 평문으로 남기지 않으려고 base64(UTF-8)로 넣고 런타임에 디코딩한다.
const d = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

describe('containsProfanity', () => {
  it('빈 값·정상 제목은 통과', () => {
    expect(containsProfanity('')).toBe(false)
    expect(containsProfanity(null)).toBe(false)
    expect(containsProfanity('신나는 토요일 모션파티')).toBe(false)
    expect(containsProfanity('개발자 모임')).toBe(false) // '개발'은 사전과 겹치지 않음
  })

  it('사전 속 비속어를 잡는다', () => {
    expect(containsProfanity(`${d('6rCc7IOI64G8')} 방`)).toBe(true) // 한국어 사전 항목
    expect(containsProfanity(`${d('7IOI64G8')} 모임`)).toBe(true) // 단독 2글자 사전 항목
    expect(containsProfanity(`${d('67OR7Iug')}들 모여라`)).toBe(true) // 한국어 사전 항목
    expect(containsProfanity(`this is ${d('c2hpdA==')}`)).toBe(true) // 영어 사전 항목
  })

  it('대소문자·공백·구분기호·삽입 자모·반복 우회를 흡수한다', () => {
    const [k0, k1] = d('7Iuc67Cc') // 2글자 한국어 사전 항목
    expect(containsProfanity(`${k0} ${k1}`)).toBe(true) // 사이 공백
    expect(containsProfanity(`${k0}-${k1}`)).toBe(true) // 사이 구분기호
    expect(containsProfanity(`${k0}ㅡ${k1}`)).toBe(true) // 사이 단독 자모(ㅡ) 삽입
    expect(containsProfanity(`${k0}1${k1}`)).toBe(true) // 사이 숫자 삽입
    expect(containsProfanity(`${k0}９${k1}`)).toBe(true) // 사이 전각 숫자 삽입

    const ew = d('ZnVjaw==') // 4글자 영어 사전 항목
    expect(containsProfanity(ew.toUpperCase())).toBe(true) // 대문자
    expect(containsProfanity(`${ew[0]}${ew[1]!.repeat(3)}${ew.slice(2)}`)).toBe(true) // 과장 반복
  })
})
