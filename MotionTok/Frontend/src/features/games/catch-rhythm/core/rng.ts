/**
 * mulberry32 — 시드 기반 결정적 PRNG (캐치캐치리듬, S15P11A706-40).
 *
 * 대전 모드의 "방 전원 동일 랜덤 채보"는 서버가 배포한 seed 하나에서 출발한다.
 * 채보 생성 경로에서는 이 함수 외의 난수원(Math.random 등)을 절대 쓰지 않는다.
 */
export type Rng = () => number

/** [0, 1) 균등분포. 같은 seed면 호출 순서가 같을 때 항상 같은 수열을 낸다. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 서버 seed(Long)가 32bit를 넘어도 하위/상위 워드를 섞어 32bit 시드로 접는다. */
export function foldSeed(seed: number | string): number {
  const n = typeof seed === 'string' ? BigInt(seed) : BigInt(Math.trunc(seed))
  const lo = Number(n & 0xffffffffn)
  const hi = Number((n >> 32n) & 0xffffffffn)
  return (lo ^ hi) >>> 0
}
