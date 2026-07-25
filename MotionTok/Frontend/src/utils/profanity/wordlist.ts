/**
 * 비속어 사전 (필터 조정 지점) — 원문을 리포지토리에 평문으로 남기지 않으려고 base64로 보관합니다.
 * (난독화 수준의 조치입니다. 번들에서 디코딩 가능하며, 실제 차단은 서버 검증이 담당해야 합니다.)
 *
 * 단어 추가/삭제 방법:
 *   - 브라우저 콘솔 등에서 인코딩:  btoa(unescape(encodeURIComponent('추가할단어')))
 *   - 나온 문자열을 아래 배열에 넣거나(추가), 해당 항목을 지우세요(삭제).
 *   - 검사는 소문자·공백·구분기호 제거 후 "부분 문자열 포함"으로 동작하므로,
 *     정상 제목에 우연히 들어갈 만큼 짧거나 흔한 토큰은 넣지 마세요(오탐 유발).
 */
export const ENCODED_BAD_WORDS: readonly string[] = [
  '7JSo67Cc', '7Iuc67Cc', '7JSo67mo', '7Iuc7YyU', '7JSo7YyU', '7JSo67Cc64aI',
  '7Iuc67aA65+0', '7JSo67aA656E', '6rCc7IOI64G8', '6rCc7IOJ64G8', '6rCc7IOJ6riw',
  '6rCc7IS464G8', '7IOI64G8', '7IyN64aI', '7IyN64WE', '6rCc64WE', '6rCc64aI',
  '67OR7Iug', '67iF7Iug', '67mZ7Iug', '65Ox7Iug', '66i47KCA66as',
  '7KeA656E', '7KeA65+0', '7KKG', '7KG064KY', '7KG064K0', '7KGw6rmM', '65Kk7KC4', '64ul7LOQ',
  '64uI66+4', '7JWg66+4', '7JWg67mE', '7Jeg7LC9', '7JeE7LC9',
  '67O07KeA', '7J6Q7KeA', '7KKG6rCZ', '6ry066Ck', '7IS57Iqk', '7J6Q7JyE', '7ZuE7J6l', '7LC964WA', '6rG466CI',
  'ZnVjaw==', 'ZnVr', 'ZnZjaw==', 'c2hpdA==', 'Yml0Y2g=', 'YXNzaG9sZQ==', 'YmFzdGFyZA==',
  'ZGljaw==', 'cHVzc3k=', 'Y3VudA==', 'c2x1dA==', 'd2hvcmU=', 'bmlnZ2Vy', 'ZmFn', 'bW90aGVyZnVja2Vy',
]
