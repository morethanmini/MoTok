/**
 * 로비에서 닫아 본 친구 요청 id 보관.
 *
 * 요청은 수락·거절 전까지 서버에 계속 남아 있어서, 그것만 보고 팝업을 띄우면 로비에 들어올
 * 때마다 같은 카드가 다시 뜬다. 한 번 닫았다는 사실은 서버가 알 도리가 없으므로 여기서 든다.
 * 닫아도 요청이 사라지는 건 아니다 — 배지(요청 N개)에는 그대로 남는다.
 *
 * 계정을 바꾸면 남의 요청 id를 물려받게 되므로 키를 사용자별로 나눈다.
 */

const PREFIX = 'motiontok:dismissed-friend-requests:'

function key(userId: number) {
  return `${PREFIX}${userId}`
}

function read(userId: number): number[] {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return []
    const ids = JSON.parse(raw) as unknown
    return Array.isArray(ids) ? ids.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return [] // 저장소를 못 쓰면 매번 뜨는 쪽으로 — 놓치는 것보다 낫다
  }
}

function write(userId: number, ids: number[]) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(ids))
  } catch {
    /* 저장 실패해도 이번 세션에서는 닫힌 상태가 유지된다(호출부가 메모리에도 들고 있다) */
  }
}

export function loadDismissed(userId: number): Set<number> {
  return new Set(read(userId))
}

export function addDismissed(userId: number, requestId: number): void {
  const ids = read(userId)
  if (!ids.includes(requestId)) write(userId, [...ids, requestId])
}

/**
 * 아직 살아 있는 요청 id만 남긴다.
 *
 * 수락·거절·철회된 요청의 id를 계속 들고 있으면 저장소가 끝없이 자란다. 더 나쁜 건 id 재사용 —
 * 언젠가 같은 번호의 새 요청이 오면 뜨지도 않고 조용히 묻힌다.
 */
export function pruneDismissed(userId: number, alivePendingIds: number[]): Set<number> {
  const alive = new Set(alivePendingIds)
  const kept = read(userId).filter((id) => alive.has(id))
  write(userId, kept)
  return new Set(kept)
}
