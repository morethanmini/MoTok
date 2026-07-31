/**
 * 반복형 radix-2 FFT — 곡 분석(analysis/) 전용의 최소 구현.
 *
 * 외부 DSP 라이브러리를 들이지 않는 이유: 필요한 건 크기 스펙트럼 하나뿐이고,
 * 이 파일이 순수 함수라 vitest로 수학적 정합(사인 → 단일 빈)을 직접 검증할 수 있다.
 */

/** N은 2의 거듭제곱이어야 한다. 비트 반전 순서 테이블을 만든다. */
function bitReverseTable(n: number): Uint32Array {
  const table = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    table[i] = r
  }
  return table
}

/** 같은 N으로 반복 호출되므로 삼각함수·순서 테이블을 캐시한다(프레임 수만큼 부른다). */
const planCache = new Map<number, { rev: Uint32Array; cos: Float32Array; sin: Float32Array }>()

function planFor(n: number) {
  let plan = planCache.get(n)
  if (!plan) {
    const cos = new Float32Array(n / 2)
    const sin = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n)
      sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
    plan = { rev: bitReverseTable(n), cos, sin }
    planCache.set(n, plan)
  }
  return plan
}

/**
 * 실수 입력의 크기 스펙트럼. 반환 길이는 N/2+1 (DC~나이퀴스트).
 * `out`을 주면 거기에 쓴다(프레임 루프에서 할당을 피하기 위해).
 */
export function fftMagnitude(input: Float32Array, out?: Float32Array): Float32Array {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error(`FFT 길이는 2의 거듭제곱이어야 합니다: ${n}`)
  const { rev, cos, sin } = planFor(n)

  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let i = 0; i < n; i++) re[rev[i]!] = input[i]!

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const tw = k * step
        const c = cos[tw]!
        const s = sin[tw]!
        const i0 = start + k
        const i1 = i0 + half
        const tr = re[i1]! * c - im[i1]! * s
        const ti = re[i1]! * s + im[i1]! * c
        re[i1] = re[i0]! - tr
        im[i1] = im[i0]! - ti
        re[i0] = re[i0]! + tr
        im[i0] = im[i0]! + ti
      }
    }
  }

  const bins = n / 2 + 1
  const mag = out ?? new Float32Array(bins)
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k]!, im[k]!)
  return mag
}

/** 해닝 창 — 프레임 경계 누설을 줄인다. N별로 캐시. */
const hannCache = new Map<number, Float32Array>()

export function hannWindow(n: number): Float32Array {
  let w = hannCache.get(n)
  if (!w) {
    w = new Float32Array(n)
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    hannCache.set(n, w)
  }
  return w
}
