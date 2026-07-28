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
  /**
   * 신뢰도 낮은 관절 추가 감쇠 (0 = 끔, 1 = 최대).
   *
   * One Euro는 속도가 빠르면 컷오프를 올려 지연을 줄이는데, **지터는 속도처럼 보인다** —
   * 팔처럼 노이즈가 큰 관절은 beta×|속도|가 커져서 오히려 덜 필터링되는 역효과가 난다.
   * 팔을 접으면 팔꿈치가 가려지거나 전완이 카메라 축으로 단축돼 MediaPipe가 위치를
   * 확신하지 못하고, 그 불확실성이 visibility로 내려온다(2026-07-28 실기).
   *
   * 그래서 visibility가 낮은 관절만 골라 minCutoff와 beta를 함께 낮춘다.
   * 잘 보이는 관절의 반응성은 건드리지 않는다.
   */
  visTighten: number
}

/** 이 값 이상이면 신뢰도 감쇠를 걸지 않는다 — 잘 보이는 관절은 원래 반응성 유지 */
const VIS_FULL = 0.9
/** 감쇠 최대치일 때 파라미터를 몇 배까지 줄일지 — 0.15면 minCutoff·beta가 15%까지 내려간다 */
const VIS_FLOOR = 0.15

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

  /** scale: 신뢰도 감쇠 배율(1 = 원래대로, 작을수록 강하게 눌림) */
  next(x: number, dt: number, scale = 1): number {
    if (!this.hasPrev) {
      this.hasPrev = true
      this.xPrev = x
      this.dxPrev = 0
      return x
    }
    const dx = (x - this.xPrev) / dt
    const aD = smoothingFactor(D_CUTOFF, dt)
    const dxHat = aD * dx + (1 - aD) * this.dxPrev
    // minCutoff와 beta를 함께 줄인다 — beta를 그대로 두면 지터를 속도로 오인해
    // 컷오프를 도로 밀어올리므로 minCutoff만 낮춰서는 안 잡힌다(2026-07-28 실기)
    const cutoff = (this.params.minCutoff + this.params.beta * Math.abs(dxHat)) * scale
    const a = smoothingFactor(cutoff, dt)
    const xHat = a * x + (1 - a) * this.xPrev
    this.xPrev = xHat
    this.dxPrev = dxHat
    return xHat
  }
}

/**
 * 33개 포즈 랜드마크의 x·y·z 일괄 필터. z는 판정에서 버리지만(§5-5) 렌더 깊이
 * (팔 앞/뒤 방향)에 쓰이고, MediaPipe z는 x·y보다 지터가 심해 필터가 더 필요하다.
 * 랜드마크 개수·순서가 프레임마다 같다는 MediaPipe 보장에 기댄다.
 */
export class PoseSmoother {
  private readonly filters: OneEuro1D[]
  private lastT: number | null = null

  /** params는 참조 공유 — 랩 슬라이더가 값을 바꾸면 다음 프레임부터 바로 반영된다 */
  constructor(
    private readonly params: OneEuroParams,
    landmarkCount = 33,
  ) {
    this.filters = Array.from({ length: landmarkCount * 3 }, () => new OneEuro1D(params))
  }

  /** 녹화 재생 루프 시작 등 시간축이 끊길 때 호출 — 이전 상태를 버린다 */
  reset() {
    this.lastT = null
    for (const f of this.filters) f.reset()
  }

  /**
   * 신뢰도 → 컷오프 배율. visibility가 VIS_FULL 이상이면 1(원래 반응성 유지),
   * 낮을수록 VIS_FLOOR까지 내려가 강하게 눌린다. visTighten이 0이면 항상 1.
   */
  private scaleFor(visibility: number | undefined): number {
    const t = this.params.visTighten
    if (!t) return 1
    const vis = Math.min(Math.max(visibility ?? 1, 0), 1)
    const raw = VIS_FLOOR + (1 - VIS_FLOOR) * Math.min(vis / VIS_FULL, 1)
    return 1 - t * (1 - raw)
  }

  /** tMs: 프레임 타임스탬프(ms). 원본은 건드리지 않고 필터링된 사본을 돌려준다. */
  apply<T extends { x: number; y: number; z?: number; visibility?: number }>(
    landmarks: T[],
    tMs: number,
  ): T[] {
    const dt =
      this.lastT === null ? 1 / 30 : Math.min(Math.max((tMs - this.lastT) / 1000, 1e-3), 0.1)
    this.lastT = tMs
    return landmarks.map((lm, i) => {
      const s = this.scaleFor(lm.visibility)
      return {
        ...lm,
        x: this.filters[i * 3]!.next(lm.x, dt, s),
        y: this.filters[i * 3 + 1]!.next(lm.y, dt, s),
        z: lm.z === undefined ? undefined : this.filters[i * 3 + 2]!.next(lm.z, dt, s),
      }
    })
  }
}
