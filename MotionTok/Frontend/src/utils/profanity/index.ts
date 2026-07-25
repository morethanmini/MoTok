/**
 * 비속어 검사 유틸 (공용).
 *
 * 사용:
 *   import { containsProfanity } from '@/utils/profanity'
 *   if (containsProfanity(title)) { ...안내... }
 *
 * 단어 목록은 ./wordlist.ts 에서 base64로 관리합니다(원문을 소스에 평문으로 두지 않기 위함).
 * ⚠️ UX 안내용 1차 필터일 뿐 우회가 가능하므로, 실제 차단은 서버 검증이 담당해야 합니다.
 */
import { ENCODED_BAD_WORDS } from './wordlist'

/** base64(UTF-8) -> 문자열. 한글 등 멀티바이트를 올바로 복원한다. */
function decodeBase64(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// 정규화에서 지울 문자들. 소스에 안 보이는 문자가 섞이지 않도록 전부 \u 이스케이프(RegExp 문자열)로 표기한다.
const RE_SPACE = new RegExp('[\\s\\u200B-\\u200D\\uFEFF]+', 'g') // 공백 + 제로폭 문자
const RE_SEP = new RegExp('[._*~|/\\u005C\\u2010-\\u2015\\u00B7\\u2022\\u2027\\u30FB\\u30FC-]+', 'g') // 구분기호·점·각종 대시·역슬래시·하이픈
const RE_JAMO = new RegExp('[\\u1100-\\u11FF\\u3130-\\u318F\\uA960-\\uA97F\\uD7B0-\\uD7FF]+', 'g') // 음절 사이 낀 단독 한글 자모(우회용)
const RE_DIGIT = new RegExp('[0-9\\uFF10-\\uFF19]+', 'g') // 음절 사이 낀 숫자(반각+전각, 우회용)
const RE_REPEAT = /(.)\1{2,}/g // 같은 문자 3회 이상 반복

/**
 * 비교용 정규화 — 대소문자·공백·구분기호·삽입 자모·삽입 숫자·과장 반복으로 하는 단순 우회를 흡수한다.
 * 예) "A B C" -> "abc", "a-b-c" -> "abc", "가ㅡ나" -> "가나", "가1나" -> "가나", "haaappy" -> "hapy"
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(RE_SPACE, '')
    .replace(RE_SEP, '')
    .replace(RE_JAMO, '')
    .replace(RE_DIGIT, '')
    .replace(RE_REPEAT, '$1')
}

// 원문 사전은 모듈 로드 시 한 번만 디코딩·정규화해 둔다(런타임 메모리에만 존재).
const NORMALIZED_WORDS = ENCODED_BAD_WORDS.map((w) => normalize(decodeBase64(w))).filter(Boolean)

/** 텍스트에 사전 속 비속어가 포함되면 true. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = normalize(text)
  return NORMALIZED_WORDS.some((word) => normalized.includes(word))
}
