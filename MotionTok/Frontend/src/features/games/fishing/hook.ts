/**
 * 게임⑤ 낚시 — 훅킹(챔질) 판정 (기획 §훅킹, S15P11A706-10).
 *
 * 기획: "찌가 흔들리면 사용자는 낚싯대를 위로 번쩍 들어올린다."
 *
 * 캐스팅 릴리즈(빠른 하향)의 거울상이다 — **빠른 상향**. 같은 y 신호를 쓰는 이유는 실측에서
 * 손목 y가 손실률 0%·신뢰도 0.99로 가장 믿을 수 있는 값이었기 때문이다(2026-07-29).
 *
 * 데모는 이걸 "양손 손바닥 펴기"라는 정적 포즈로 만들어서 타이밍이 사라졌다 — 입질 전에 미리
 * 손을 펴고 있으면 입질 프레임에 즉시 챔질돼 QTE가 무의미했다. 순간 속도 이벤트여야 한다.
 *
 * 캐스팅과 충돌하지 않는다: 훅킹은 입질(BITE) 페이즈에서만 활성이고, 그때 캐스팅은 꺼져 있다.
 */

export interface HookConfig {
  /** 이 상향 속도(px/s)를 넘어야 챔질 — 거리 조건과 AND다 */
  upVelPxS: number
  /**
   * 최근 최저점에서 이만큼(px) 올라와야 챔질.
   *
   * 속도만 보면 80ms 창에서 42px만 움직여도 발사돼, 손을 어깨 근처에 두고 있으면 저절로
   * 챔질됐다(2026-07-29 실기). 거리 조건을 AND로 걸어 "번쩍 들어올리는" 동작만 인정한다.
   */
  minRisePx: number
  /** 최저점을 찾는 창(ms) — 이보다 오래된 위치는 기준으로 삼지 않는다 */
  riseWindowMs: number
  /** 속도 계산 창(ms) — 캐스팅과 같은 값을 쓴다(휘두르는 순간의 peak를 살린다) */
  velWindowMs: number
}

export const DEFAULT_HOOK: HookConfig = {
  // 캐스팅 릴리즈(700)보다 낮게 둔다. 챔질은 짧고 반사적인 동작이라 하향 스윙만큼
  // 크게 휘두르지 않는다. 입질 창(1.5초) 안에서만 판정되므로 오발 위험도 작다.
  upVelPxS: 520,
  // 캐스팅 낙하(110px)보다 작게 — 챔질은 손목을 튕기는 짧은 동작이다
  minRisePx: 80,
  riseWindowMs: 400,
  velWindowMs: 80,
}

export interface HookSample {
  /** 이 프레임에 챔질됐는지 */
  fired: boolean
  /** 현재 상향 속도(px/s). 양수 = 위로 — 랩·연출 표시용 */
  upVelPxS: number
  /** 최근 최저점에서 올라온 거리(px) — 랩 표시용 */
  risePx: number
}

export interface Hook {
  /** 손목 y(캔버스 px, 아래로 갈수록 증가)를 넣는다 */
  feed(wristY: number, now: number): HookSample
  reset(): void
}

export function createHook(config: HookConfig = DEFAULT_HOOK): Hook {
  let hist: { y: number; t: number }[] = []

  return {
    reset() {
      hist = []
    },

    feed(wristY, now) {
      hist.push({ y: wristY, t: now })
      while (hist.length && now - hist[0]!.t > Math.max(config.velWindowMs * 3, config.riseWindowMs))
        hist.shift()

      // 최근 창의 최저점(y 최댓값)에서 얼마나 올라왔는지
      let lowest = wristY
      for (const s of hist) {
        if (now - s.t <= config.riseWindowMs && s.y > lowest) lowest = s.y
      }
      const risePx = lowest - wristY

      const w = hist.filter((s) => now - s.t <= config.velWindowMs)
      if (w.length < 2) return { fired: false, upVelPxS: 0, risePx }
      const a = w[0]!
      const b = w[w.length - 1]!
      const dt = (b.t - a.t) / 1000
      if (dt <= 0) return { fired: false, upVelPxS: 0, risePx }

      // y는 아래로 갈수록 커지므로 위로 움직이면 (a.y - b.y)가 양수
      const up = (a.y - b.y) / dt
      // 속도 AND 거리 — 둘 다 넘어야 챔질이다
      return { fired: up >= config.upVelPxS && risePx >= config.minRisePx, upVelPxS: up, risePx }
    },
  }
}
