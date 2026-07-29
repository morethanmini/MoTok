/**
 * 비속어 검사 유틸 (공용).
 *
 * 사용:
 *   import { containsProfanity } from '@/utils/profanity'
 *   if (containsProfanity(title)) { ...안내... }
 *
 * 사전은 이중화되어 있다(S15P11A706-152):
 *   - 번들 내장본(./wordlist.ts) — 즉시 사용 가능한 폴백
 *   - 서버 정본(GET /api/v1/profanity/wordlist) — loadRemoteWordlist()가 받아서 교체.
 *     BE 검증·마스킹과 같은 리소스 파일이라 판정이 서버와 일치하게 된다.
 * ⚠️ UX 안내용 1차 필터일 뿐 우회가 가능하므로, 실제 차단(닉네임·방 제목 거절)과
 *    채팅 마스킹은 서버가 담당한다.
 */
import { ENCODED_BAD_WORDS } from './wordlist'
import { http } from '@/api/http'

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

/**
 * 인코딩 사전 -> 정규화 사전. BE(ProfanityFilter)와 같은 규칙:
 * 정규화 결과가 1글자로 "줄어든" 항목은 정상 문장을 마구 잡으므로 버린다
 * (원문부터 1글자인 항목은 큐레이터 의도로 보고 유지).
 */
function buildNormalized(encoded: readonly string[]): string[] {
  return encoded
    .map((w) => decodeBase64(w))
    .filter((raw) => raw.length === 1 || normalize(raw).length >= 2)
    .map((raw) => normalize(raw))
    .filter(Boolean)
}

// 번들 내장본으로 시작하고, 서버 정본을 받으면 통째로 교체한다.
let normalizedWords: string[] = buildNormalized(ENCODED_BAD_WORDS)
let remoteLoaded = false

/**
 * 서버 정본 사전을 받아 교체한다(실패해도 던지지 않음 — 번들 폴백 유지).
 * 여러 번 불러도 다운로드는 한 번이다. 앱 시작 시 fire-and-forget으로 부른다.
 */
export async function loadRemoteWordlist(): Promise<void> {
  if (remoteLoaded) return
  try {
    const data = await http.get<{ words?: string[] }>('/v1/profanity/wordlist')
    if (Array.isArray(data.words) && data.words.length > 0) {
      normalizedWords = buildNormalized(data.words)
      remoteLoaded = true
    }
  } catch {
    // 서버 미연동/오프라인 — 번들 내장본으로 계속 간다. 최종 강제는 어차피 서버.
  }
}

/** 텍스트에 사전 속 비속어가 포함되면 true. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = normalize(text)
  return normalizedWords.some((word) => normalized.includes(word))
}
