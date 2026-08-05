/**
 * 닉네임 문자·길이 규칙 — 서버 `@NicknameFormat` + `@Size(min = 2, max = 16)` 의 사본이다.
 *
 * 여기서 미리 거르는 이유는 왕복 없이 즉시 안내하려는 것뿐이고, **판정 권한은 서버에 있다**
 * (`utils/profanity` 가 백엔드 `ProfanityFilter` 를 미러링하는 것과 같은 구조).
 * 이 파일을 고치면 `global/validation/NicknameFormat.java` 도 함께 고쳐야 한다.
 *
 * 한글·영문·숫자만 허용한다. 공백·밑줄·문장부호·이모지는 전부 거절이다.
 *
 * 영문을 유니코드 스크립트(`\p{Script=Latin}`)가 아니라 `a-zA-Z` 로 적은 이유 —
 * **전각 라틴(`ａｄｍｉｎ`, U+FF41~)도 Script=Latin 이다.** 스크립트로 받으면 전각으로
 * `admin` 을 사칭할 수 있어 이 규칙을 만든 이유가 무너진다(서버 테스트에서 실제로 걸렸다).
 *
 * 숫자를 `0-9` 로 따로 적은 이유 — 아라비아 숫자는 Script=Common 이라 어느 스크립트에도 속하지 않는다.
 * 한글은 `\p{Script=Hangul}` 로 받는다 — 완성형 음절과 호환 자모를 함께 덮으므로 `ㅇㅇ` 같은
 * 자모 닉네임도 통과한다(전각 한글이라는 것은 없어 같은 함정이 없다).
 *
 * 허용 목록 방식이라 제로폭 공백(U+200B)·RTL override(U+202E)·BOM·개행처럼 눈에 보이지 않는
 * 문자는 열거하지 않아도 전부 걸린다.
 */
export const NICKNAME_MIN_LENGTH = 2
export const NICKNAME_MAX_LENGTH = 16

const NICKNAME_PATTERN = /^[\p{Script=Hangul}a-zA-Z0-9]+$/u

/** 안내 문구 — 세 입력 화면이 같은 말을 하도록 여기에 둔다. */
export const NICKNAME_LENGTH_MESSAGE = `닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자여야 해요.`
export const NICKNAME_FORMAT_MESSAGE = '닉네임은 한글·영문·숫자만 쓸 수 있어요(공백·특수문자 불가).'

/** 문자 종류만 본다. 길이는 {@link nicknameError} 가 함께 판정한다. */
export function hasValidNicknameChars(nickname: string | null | undefined): boolean {
  if (!nickname) return false
  return NICKNAME_PATTERN.test(nickname)
}

/**
 * 규칙 위반 안내 문구, 통과하면 null.
 *
 * 길이를 먼저 본다 — 빈 값이나 한 글자에 "특수문자 불가"라고 답하면 무엇이 틀렸는지 알 수 없다.
 * 비속어는 여기서 보지 않는다(`containsProfanity` 가 별도 관심사이고 호출부가 문구를 따로 쓴다).
 */
export function nicknameError(nickname: string | null | undefined): string | null {
  const value = (nickname ?? '').trim()
  if (value.length < NICKNAME_MIN_LENGTH || value.length > NICKNAME_MAX_LENGTH) {
    return NICKNAME_LENGTH_MESSAGE
  }
  if (!hasValidNicknameChars(value)) {
    return NICKNAME_FORMAT_MESSAGE
  }
  return null
}
