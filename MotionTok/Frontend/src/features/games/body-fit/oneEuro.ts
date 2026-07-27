/**
 * One Euro Filter (Casiez et al., CHI 2012) — 직접 구현 (기획 초안 §9-1, 라이브러리 추가 금지).
 *
 * 적응형 저역 통과 필터: 신호가 느릴 때는 컷오프를 낮춰 지터를 죽이고,
 * 빨라지면 컷오프를 올려 지연을 줄인다. 컷오프 = minCutoff + beta × |속도|.
 *
 * 파라미터 튜닝(UI 스펙 §10): 정지 상태가 떨리면 minCutoff를 내리고,
 * 빠른 동작이 늦게 따라오면 beta를 올린다.
 */
export interface OneEuroParams {
  minCutoff: number
  beta: number
}

/** 속도 신호 자체의 저역 컷오프(Hz) — 원논문 권장 고정값 */
const D_CUTOFF = 1

function smoothingFactor(cutoff: number, dt: number): number {
  const r = 2 * Math.PI * cutoff * dt
  return r / (r + 1)
}

class OneEuro1D {
  private hasPrev = false
  private xPrev = 0
  private dxPrev = 0

  /** params는 참조 공유 — 호출부(슬라이더)가 값을 바꾸면 다음 프레임부터 바로 반영된다 */
  constructor(private readonly params: OneEuroParams) {}

  reset() {
    this.hasPrev = false
  }

  next(x: number, dt: number): number {
    if (!this.hasPrev) {
      this.hasPrev = true
      this.xPrev = x
      this.dxPrev = 0
      return x
    }
    const dx = (x - this.xPrev) / dt
    const aD = smoothingFactor(D_CUTOFF, dt)
    const dxHat = aD * dx + (1 - aD) * this.dxPrev
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(dxHat)
    const a = smoothingFactor(cutoff, dt)
    const xHat = a * x + (1 - a) * this.xPrev
    this.xPrev = xHat
    this.dxPrev = dxHat
    return xHat
  }
}

/**
 * 33개 포즈 랜드마크의 x·y 일괄 필터 (z는 판정에서 버리므로 필터링하지 않는다 — §5-5).
 * 랜드마크 개수·순서가 프레임마다 같다는 MediaPipe 보장에 기댄다.
 */
export class PoseSmoother {
  private readonly filters: OneEuro1D[]
  private lastT: number | null = null

  constructor(params: OneEuroParams, landmarkCount = 33) {
    this.filters = Array.from({ length: landmarkCount * 2 }, () => new OneEuro1D(params))
  }

  /** 녹화 재생 루프 시작 등 시간축이 끊길 때 호출 — 이전 상태를 버린다 */
  reset() {
    this.lastT = null
    for (const f of this.filters) f.reset()
  }

  /** tMs: 프레임 타임스탬프(ms). 원본은 건드리지 않고 필터링된 사본을 돌려준다. */
  apply<T extends { x: number; y: number }>(landmarks: T[], tMs: number): T[] {
    const dt =
      this.lastT === null ? 1 / 30 : Math.min(Math.max((tMs - this.lastT) / 1000, 1e-3), 0.1)
    this.lastT = tMs
    return landmarks.map((lm, i) => ({
      ...lm,
      x: this.filters[i * 2]!.next(lm.x, dt),
      y: this.filters[i * 2 + 1]!.next(lm.y, dt),
    }))
  }
}
