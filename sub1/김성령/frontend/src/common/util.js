
// 공용 함수

/**
 * 입력 필드 유효성 검사 함수 모음.
 *
 * 각 함수는 "에러 메시지 문자열"을 반환하고, 유효한 경우 빈 문자열('')을 반환한다.
 * 명세서의 에러 메시지가 조건별로 나뉘어 있으므로(최소 9글자 / 최대 16글자 / 조합),
 * 하나의 정규식으로 뭉치지 않고 조건별로 순서대로 검사한다.
 */

// 영문 + 숫자 + 특수문자가 모두 포함되어야 함
const PASSWORD_COMBINATION = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/

/** 소속 / 직책 - 선택 입력, 최대 30자 */
export const validateOptionalText30 = (value) => {
  if (value && value.length > 30) return '최대 30자까지 입력 가능합니다.'
  return ''
}

/** 이름 - 필수 입력, 최대 30자 */
export const validateName = (value) => {
  if (!value) return '필수 입력 항목입니다.'
  if (value.length > 30) return '최대 30자까지 입력 가능합니다.'
  return ''
}

/** 아이디 - 필수 입력, 최대 16자 */
export const validateUserId = (value) => {
  if (!value) return '필수 입력 항목입니다.'
  if (value.length > 16) return '최대 16자까지 입력 가능합니다.'
  return ''
}

/** 회원가입 비밀번호 - 필수, 9~16자, 영문+숫자+특수문자 조합 (명세서 원문 그대로) */
export const validateRegisterPassword = (value) => {
  if (!value) return '필수 입력 항목입니다.'
  if (value.length < 9) return '최소 9글자를 입력해야 합니다.'
  if (value.length > 16) return '최대 16글자까지 입력 가능합니다.'
  if (!PASSWORD_COMBINATION.test(value)) return '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
  return ''
}

/** 회원가입 비밀번호 확인 - 위 규칙 + 비밀번호와 일치 여부 */
export const validateRegisterPasswordConfirm = (value, password) => {
  const error = validateRegisterPassword(value)
  if (error) return error
  if (value !== password) return '입력한 비밀번호와 일치하지 않습니다.'
  return ''
}

/**
 * 로그인 비밀번호 - 필수 + 최대 16자만 검사한다.
 *
 * [팀 결정] 명세서상 로그인 팝업의 비밀번호 규칙은 회원가입과 동일(9자 이상 + 조합)하지만,
 * 명세서가 제공하는 INIT.SQL 테스트 계정(test-1)의 비밀번호가 '12345'(5자, 숫자만)라서
 * 명세대로 구현하면 제공된 계정으로는 로그인 버튼이 활성화되지 않는다. (명세서 내부 모순)
 * 따라서 로그인 팝업에 한해 유효성을 완화한다.
 * 실제 비밀번호 판정은 서버가 하므로(401 '잘못된 비밀번호입니다.') 보안상 손실은 없다.
 *
 * 명세대로 되돌리려면 이 함수 대신 validateRegisterPassword 를 사용하면 된다.
 */
export const validateLoginPassword = (value) => {
  if (!value) return '필수 입력 항목입니다.'
  if (value.length > 16) return '최대 16글자까지 입력 가능합니다.'
  return ''
}
