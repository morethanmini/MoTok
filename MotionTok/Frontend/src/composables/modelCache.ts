/**
 * 모션 모델 파일(.task·.tflite)을 Cache Storage에 영속화하는 공용 로더 (S15P11A706-161).
 *
 * 캐시 키가 <b>모델 경로</b>라 모델이 늘어도 이 파일은 고치지 않는다(가면용 얼굴 검출기도
 * 같은 경로로 들어온다). CACHE_NAME 버전은 <b>같은 이름으로 내용을 교체할 때만</b> 올린다 —
 * 모델을 추가하는 것은 새 키라서 기존 캐시를 버릴 이유가 없다.
 *
 * 모델 인스턴스는 JS 힙 싱글턴이라 새로고침·재접속이면 사라진다 — 8인 테스트에서
 * 새로고침한 참가자들이 게임 시작 3초 안에 17MB를 다시 받지 못해 라운드에 끼지 못했다.
 * 받은 바이트를 Cache Storage에 넣어 두면 새로고침·브라우저 재시작 뒤에도 네트워크 없이
 * 즉시 복원된다. HTTP 캐시와 달리 우리가 키·수명을 직접 관리하고, persist 승격을 요청하면
 * 디스크 압박에도 잘 축출되지 않는다.
 *
 * Cache API를 못 쓰는 환경(시크릿 모드 일부·비보안 컨텍스트)이나 읽기/저장 실패는
 * 전부 조용히 네트워크 다운로드로 폴백한다 — 이 모듈이 새 실패 원인이 되면 안 된다.
 */

/** 로딩 진행률 콜백 — fraction은 0~1. */
export type LoadProgress = (fraction: number) => void

// 모델 파일은 파일명이 해시되지 않으므로, 배포에서 모델을 교체하면 이 버전을 올려
// 캐시를 통째로 갈아치운다(이전 버전 캐시는 아래 open 직후 정리).
const CACHE_NAME = 'motok-motion-models-v1'

let persistRequested = false

/** 디스크 압박 시 축출되지 않게 영속 저장을 요청한다(거부돼도 동작에는 지장 없음). */
function requestPersistentStorage() {
  if (persistRequested) return
  persistRequested = true
  try {
    void navigator.storage?.persist?.()
  } catch {
    /* 미지원 브라우저 */
  }
}

/** 이전 버전 캐시 정리 — 모델 버전을 올릴 때 구버전 17MB가 디스크에 남지 않게. */
async function cleanupOldCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((k) => k.startsWith('motok-motion-models-') && k !== CACHE_NAME)
      .map((k) => caches.delete(k)),
  )
}

/** 네트워크에서 스트리밍으로 받아 실제 바이트 진행률을 콜백으로 흘려보낸다. */
async function downloadModel(
  modelPath: string,
  modelWeight: number,
  onProgress?: LoadProgress,
): Promise<Uint8Array> {
  const res = await fetch(modelPath)
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`)

  const total = Number(res.headers.get('Content-Length')) || 0
  // 스트림·Content-Length를 못 쓰는 환경은 통짜로 받고 진행률만 건너뛴다.
  if (!res.body || !total) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onProgress?.(modelWeight)
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(Math.min(received / total, 1) * modelWeight)
  }

  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * 모델 바이트를 가져온다: Cache Storage 히트 → 즉시 복원, 미스 → 네트워크 다운로드 후 저장.
 *
 * @param modelWeight 로딩바에서 다운로드 구간에 배정된 비중(0~1) — 진행률 콜백의 상한
 */
export async function fetchModelBuffer(
  modelPath: string,
  modelWeight: number,
  onProgress?: LoadProgress,
): Promise<Uint8Array> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(modelPath)
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer())
      onProgress?.(modelWeight)
      return buf
    }
  } catch {
    /* Cache API 불가 — 네트워크로 */
  }

  const out = await downloadModel(modelPath, modelWeight, onProgress)

  // 다음 방문(새로고침 포함)을 위해 저장 — 실패해도 이번 게임에는 지장 없다.
  try {
    requestPersistentStorage()
    const cache = await caches.open(CACHE_NAME)
    await cache.put(modelPath, new Response(out.slice(), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }))
    void cleanupOldCaches().catch(() => {})
  } catch {
    /* 저장 공간 부족 등 — 다음에 다시 받는다 */
  }
  return out
}
