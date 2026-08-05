import { describe, it, expect } from 'vitest'
import {
  hasValidNicknameChars,
  nicknameError,
  NICKNAME_FORMAT_MESSAGE,
  NICKNAME_LENGTH_MESSAGE,
} from '@/utils/nickname'

/**
 * 서버 `NicknameFormatTest` 와 같은 케이스를 태운다 — 두 규칙이 갈라지면 여기서 먼저 드러난다.
 * (프론트가 통과시킨 값을 서버가 400으로 거절하면 사용자는 무엇이 틀렸는지 알 수 없다.)
 */
describe('닉네임 문자 규칙', () => {
  it.each([
    ['모션톡', '한글 음절'],
    ['MoToK', '영문 대소문자'],
    ['test1', '영문 + 숫자'],
    ['IQ50', ''],
    ['테스트1', '한글 + 숫자'],
    ['ㅇㅇ', '호환 자모 — Script=Hangul 에 포함된다'],
    ['ㅁㄴㅇㄹㄻㄴㅇ', ''],
    ['dong99u', ''],
    ['WInterI5Coming', ''],
  ])('통과: %s %s', (nickname) => {
    expect(hasValidNicknameChars(nickname)).toBe(true)
    expect(nicknameError(nickname)).toBeNull()
  })

  it.each([
    ['T1도란 나가라', 'DB에 실제로 있던 형태'],
    ['하피는 똥싸개 유튜버', 'DB에 실제로 있던 형태'],
    ['모션 톡', '가운데 공백'],
  ])('공백 거절: %s (%s)', (nickname) => {
    expect(hasValidNicknameChars(nickname)).toBe(false)
    expect(nicknameError(nickname)).toBe(NICKNAME_FORMAT_MESSAGE)
  })

  it.each([
    ['감사합니다.', 'DB에 실제로 있던 형태'],
    ['3명이서회식이될까요?', 'DB에 실제로 있던 형태'],
    ['모션톡!', ''],
    ['mo_tok', '밑줄도 특수문자다'],
    ['mo-tok', ''],
    ['mo@tok', ''],
    ["'OR'1'='1", '주입 시도 형태 — 애초에 저장되지 않는다'],
    ['<script>', ''],
    ['모션톡😀', '이모지'],
  ])('특수문자 거절: %s %s', (nickname) => {
    expect(hasValidNicknameChars(nickname)).toBe(false)
    expect(nicknameError(nickname)).toBe(NICKNAME_FORMAT_MESSAGE)
  })

  it.each([
    ['모션톡​', '제로폭 공백 — 눈에 같은 닉네임을 여럿 만든다'],
    ['모션톡‮', 'RTL override — 표시 순서를 뒤집는다'],
    ['모션톡﻿', 'BOM'],
    ['모션\t톡', '탭'],
    ['모션\n톡', '개행 — trim() 을 통과해 로그를 위조한다'],
  ])('비가시 문자 거절 (%s: %s)', (nickname) => {
    expect(hasValidNicknameChars(nickname)).toBe(false)
  })

  it.each([
    ['аdmin', '첫 글자가 키릴 а(U+0430) — 라틴 a 가 아니다'],
    ['𝗮dmin', '수학 볼드 𝗮'],
    ['ａｄｍｉｎ', '전각 라틴 — Script=Latin 이므로 스크립트로 받으면 통과해 버린다'],
  ])('사칭 스크립트 거절: %s (%s)', (nickname) => {
    expect(hasValidNicknameChars(nickname)).toBe(false)
  })

  it('전각 라틴이 통과하지 않는다 — a-zA-Z 로 좁힌 이유', () => {
    // \p{Script=Latin} 으로 받으면 아래가 true 가 되어 admin 사칭이 가능하다.
    expect(/^[\p{Script=Latin}]+$/u.test('ａｄｍｉｎ')).toBe(true)
    expect(hasValidNicknameChars('ａｄｍｉｎ')).toBe(false)
  })
})

describe('닉네임 길이 규칙', () => {
  it.each([['', '빈 값'], ['a', '1자'], ['가', '1자']])(
    '짧으면 길이 안내가 먼저 나온다: %s (%s)',
    (nickname) => {
      expect(nicknameError(nickname)).toBe(NICKNAME_LENGTH_MESSAGE)
    },
  )

  it('17자는 거절한다', () => {
    expect(nicknameError('a'.repeat(17))).toBe(NICKNAME_LENGTH_MESSAGE)
  })

  it('16자는 통과한다', () => {
    expect(nicknameError('a'.repeat(16))).toBeNull()
  })

  it('양끝 공백은 trim 뒤에 판정한다 — 서버도 trim 한다', () => {
    expect(nicknameError('  모션톡  ')).toBeNull()
  })

  it('공백만 있으면 길이 위반이다 — "특수문자 불가"라고 답하면 무엇이 틀렸는지 알 수 없다', () => {
    expect(nicknameError('   ')).toBe(NICKNAME_LENGTH_MESSAGE)
  })

  it('null·undefined 를 그대로 받는다', () => {
    expect(nicknameError(null)).toBe(NICKNAME_LENGTH_MESSAGE)
    expect(nicknameError(undefined)).toBe(NICKNAME_LENGTH_MESSAGE)
    expect(hasValidNicknameChars(null)).toBe(false)
  })
})
