/**
 * 게임⑤ 낚시 — 훅킹(챔질) 판정 (기획 §훅킹, S15P11A706-10).
 *
 * 기획: "찌가 흔들리면 사용자는 낚싯대를 위로 번쩍 들어올린다."
 *
 * 캐스팅 포워드 스윙(빠른 하향)의 거울상이다 — **빠른 상향**. 신호도 같은 것을 쓴다:
 * **양손 손목의 중점 y**. 훅킹 시점(BITE)에는 아직 양손으로 대를 쥐고 있고, 캐스팅과 같은
 * 신호계를 쓰면 페이즈가 넘어갈 때 좌표계가 바뀌지 않는다.
 *
 * 데모는 이걸 "양손 손바닥 펴기"라는 정적 포즈로 만들어서 타이밍이 사라졌다 — 입질 전에 미리
 * 손을 펴고 있으면 입질 프레임에 즉시 챔질돼 QTE가 무의미했다. 순간 속도 이벤트여야 한다.
 *
 * 캐스팅과 충돌하지 않는다: 훅킹은 입질(BITE) 페이즈에서만 활성이고, 그때 캐스팅은 꺼져 있다.
 *
 * ⚠ **문턱은 미실측이다.** 캐스팅·릴은 2026-07-30에 실측으로 확정했지만 훅킹은 재지 않았다.
 * 아래 값은 이전 px 문턱(520px/s·80px)을 그때 어깨너비(약 190px)로 나눈 환산값이라 자리는
 * 맞지만 근거가 약하다. 캐스팅이 "속도보다 거리가 낫다"로 뒤집힌 전례가 있으니, 실기에서
 * 안 걸리거나 오발하면 랩으로 재서 확정해야 한다.
 */

export interface HookConfig {
  /** 이 상향 속도(어깨너비/s)를 넘어야 챔질 — 거리 조건과 AND다 */
  upVelSw: number
  /**
   * 최근 최저점에서 이만큼(어깨너비 배수) 올라와야 챔질.
   *
   * 속도만 보면 짧은 흔들림에 발사된다(2026-07-29 실기: 손을 어깨 근처에 두고 있으면 저절로
   * 챔질됐다). 거리 조건을 AND로 걸어 "번쩍 들어올리는" 동작만 인정한다.
   */
  minRiseSw: number
  /** 최저점을 찾는 창(ms) — 이보다 오래된 위치는 기준으로 삼지 않는다 */
  riseWindowMs: number
  /** 속도 계산 창(ms) — 캐스팅과 같은 값을 쓴다(휘두르는 순간의 peak를 살린다) */
  velWindowMs: number
}

export const DEFAULT_HOOK: HookConfig = {
  /*
   * 2026-07-30 실기로 내린 값이다. 성공 6/6이었는데 **그게 문제였다** — 관측값이 문턱을
   * 겨우 넘고 있었다:
   *
   *   상향 속도  ×2.89 ~ 6.92/s   (당시 문턱 2.7 → 최솟값이 1.07배)
   *   상승 거리  ×0.45 ~ 0.57     (당시 문턱 0.42 → 최솟값이 1.07배)
   *
   * 여유 7%는 성공이 아니라 운이다. 조금만 작게 휘두르면 실패하고, 실패 로그가 하나도
   * 없어서 아래쪽 분포를 모르는 상태였다. 그래서 양쪽 다 낮춘다 — 실측 최솟값의 약 70%.
   *
   * 오발 비용이 낮아서 낮추는 쪽이 안전하다: 훅킹은 BITE 1.5초 창에서만 활성이고, 그 창에
   * 들어오려면 이미 던져서 입질까지 와 있어야 한다.
   */
  upVelSw: 2.0,
  minRiseSw: 0.32,
  riseWindowMs: 400,
  velWindowMs: 80,
}

export interface HookSample {
  /** 이 프레임에 챔질됐는지 */
  fired: boolean
  /** 상향 속도(어깨너비/s). 양수 = 위로 — 랩·연출 표시용 */
  upVelSw: number
  /** 최근 최저점에서 올라온 거리(어깨너비 배수) — 랩 표시용 */
  riseSw: number
}

export interface Hook {
  /**
   * @param midY 양손 손목 중점 y (캔버스 px, 아래로 갈수록 증가)
   * @param sw   어깨 너비(px) — 0이면 판정하지 않는다
   */
  feed(midY: number, sw: number, now: number): HookSample
  reset(): void
}

export function createHook(config: HookConfig = DEFAULT_HOOK): Hook {
  let hist: { y: number; t: number }[] = []

  return {
    reset() {
      hist = []
    },

    feed(midY, sw, now) {
      hist.push({ y: midY, t: now })
      while (hist.length && now - hist[0]!.t > Math.max(config.velWindowMs * 3, config.riseWindowMs))
        hist.shift()

      if (!(sw > 0)) return { fired: false, upVelSw: 0, riseSw: 0 }

      // 최근 창의 최저점(y 최댓값)에서 얼마나 올라왔는지
      let lowest = midY
      for (const s of hist) {
        if (now - s.t <= config.riseWindowMs && s.y > lowest) lowest = s.y
      }
      const riseSw = (lowest - midY) / sw

      const w = hist.filter((s) => now - s.t <= config.velWindowMs)
      if (w.length < 2) return { fired: false, upVelSw: 0, riseSw }
      const a = w[0]!
      const b = w[w.length - 1]!
      const dt = (b.t - a.t) / 1000
      if (dt <= 0) return { fired: false, upVelSw: 0, riseSw }

      // y는 아래로 갈수록 커지므로 위로 움직이면 (a.y - b.y)가 양수
      const upVelSw = (a.y - b.y) / dt / sw
      // 속도 AND 거리 — 둘 다 넘어야 챔질이다
      return {
        fired: upVelSw >= config.upVelSw && riseSw >= config.minRiseSw,
        upVelSw,
        riseSw,
      }
    },
  }
}
