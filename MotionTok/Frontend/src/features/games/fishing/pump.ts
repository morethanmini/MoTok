/**
 * 게임⑤ 낚시 — 릴 감기 판정 ②: 손목 y축 왕복(펌핑) (S15P11A706-10).
 *
 * reel.ts(회전 판정)의 대안. 회전 판정은 "피팅된 중심 기준 각도"를 쓰는데, 안정된 중심이
 * 지연 아니면 과녁 중 하나를 반드시 요구해서 실기 효율이 53~64%에서 안 올라갔다
 * (2026-07-29, 네 가지 설정 측정). 반면 손목 신호 자체는 손실률 0%·신뢰도 0.99로 깨끗했다
 * — 깨지는 건 해석 방식뿐이었다.
 *
 * 그래서 중심도, 평면도, 피팅도 필요 없는 스칼라 하나로 판정한다: **손목 y의 왕복**.
 * 원을 그리면 y가 사인파로 왕복하므로 원운동은 자동으로 통과한다. 유저 안내와 화면 연출은
 * "빙글빙글 돌려요" 그대로 두고 판정만 y축으로 한다 — 유저는 차이를 모르고, 상하 왕복은
 * 실제 낚시의 펌핑 기법이라 그럴싸함도 오히려 올라간다.
 *
 * 지터 내성은 슈미트 트리거(이중 문턱)로 공짜로 얻는다 — reel.ts가 flipTolerance로 따로
 * 처리해야 했던 문제가 여기서는 구조에 내장된다.
 */

export interface PumpConfig {
  /** 왕복 진폭이 이보다 작으면 감기로 보지 않는다(px). 미세 떨림 배제 */
  minAmpPx: number
  /** 진폭·중심을 재는 창(ms). rate 측정 창도 겸한다 */
  windowMs: number
  /**
   * 슈미트 트리거 불감대 — 진폭의 이 비율만큼 중심에서 떨어져야 반전으로 인정한다.
   * 0.25면 중앙 50% 구간의 떨림은 전부 무시된다.
   */
  deadband: number
}

/*
 * 시작 게이트(reset 후 첫 왕복을 버리는 방식)는 넣었다가 되돌렸다 — 2026-07-29 3인 실측에서
 * 오차 방향이 사람마다 달라(B +1.5 / A -0.5 / C -1.0) 전원에게서 1왕복을 빼면 평균 절대오차가
 * 0.75 → 1.25로 오히려 나빠졌다. 게다가 y 신호만으로는 "자리 잡는 첫 왕복"과 "첫 크랭크"가
 * 같은 사인파 한 주기라 원리적으로 구분되지 않는다.
 * 카운트 편향은 fight.ts가 진행도를 속도로 굴려서 흡수한다 — 그게 올바른 층이다.
 */

export const DEFAULT_PUMP: PumpConfig = {
  // 26은 너무 낮았다 — 손을 어깨 근처에 두고만 있어도 저절로 감겼다(2026-07-29 실기).
  // 실제 감기 진폭 실측치는 191~358px이므로 90은 넉넉히 아래이면서 무의식적 흔들림은 자른다.
  minAmpPx: 90,
  windowMs: 900,
  deadband: 0.25,
}

export interface PumpSample {
  /** 초당 왕복 횟수(= rev/s에 대응). 힘겨루기 게이지의 입력 */
  rate: number
  /** reset 이후 누적 왕복 수(소수 포함). 어종별 "N회 감기" 진행도의 입력 */
  revs: number
  /** 지금 감기로 인정되는 상태인지 — 진폭이 문턱을 넘고 왕복이 잡히는 중 */
  active: boolean
}

export interface PumpDebug {
  /** 현재 창의 왕복 진폭(px) */
  ampPx: number
  /** 누적 반주기 수 — 2개가 1왕복 */
  halves: number
  /** 마지막으로 확정된 방향 ('up' | 'down' | null) */
  phase: 'up' | 'down' | null
  /**
   * 첫 / 마지막 반주기 확정 시각(ms). 0이면 아직 반주기가 없다.
   *
   * **지속 속도**를 재기 위한 값이다. feed가 돌려주는 rate는 마지막 반주기 간격의 역수라
   * 순간값이고, 밸런스(어종표 requiredRate)는 지속 속도로 정해져야 한다. 순간값을 지속
   * 속도로 착각해 어종표를 잘못 잡은 적이 있다(fight.ts 어종표 주석: "한 번 스쳐본
   * 순간값이었고 지속 가능한 속도가 아니었다"). 두 숫자를 구분해서 볼 수 있게 노출한다.
   *
   * 리셋 기준 경과가 아니라 첫~마지막 반주기 구간을 쓴다 — 손을 들기 전과 내린 뒤 시간이
   * 섞이면 "지속"이 아니다.
   */
  firstTick: number
  lastTick: number
}

export interface Pump {
  /** 손목 y(캔버스 px)를 넣고 현재 상태를 돌려준다 */
  feed(y: number, now: number): PumpSample
  reset(): void
  debug(): PumpDebug
}

export function createPump(config: PumpConfig = DEFAULT_PUMP): Pump {
  let hist: { y: number; t: number }[] = []
  /** 마지막 두 반주기 시각 — rate는 이 간격의 역수로 낸다 */
  let lastTick = 0
  let prevTick = 0
  /** 첫 반주기 시각 — 지속 속도의 구간 시작점 */
  let firstTick = 0
  let halves = 0
  let phase: 'up' | 'down' | null = null
  let amp = 0

  /**
   * 감기 속도(왕복/s) = 1 / (반주기 간격 × 2).
   *
   * 창 안의 반주기 **개수**를 세는 방식은 양자화가 너무 거칠었다 — 900ms 창이면 나올 수 있는
   * 값이 0.56 / 1.11 / 1.67…로 0.56 단위로 띄어져서, 요구 속도 0.6이 실질적으로 1.11을
   * 요구했다(2026-07-29 실기: 멸치조차 `요구 0.60 / 현재 0.56`으로 도망). 간격의 역수는
   * 연속값이라 이 문제가 없다.
   *
   * 멈추면: 마지막 반주기 이후 경과가 간격보다 길어지면 그 경과로 나눠 자연히 0으로 감쇠한다.
   */
  function rateAt(now: number): number {
    if (halves < 2 || prevTick === 0) return 0
    const halfPeriodMs = lastTick - prevTick
    if (halfPeriodMs <= 0) return 0
    const effectiveMs = Math.max(halfPeriodMs, now - lastTick)
    return 1000 / (2 * effectiveMs)
  }

  /** 반주기 확정 — 시각을 기록해 rate의 근거로 쓴다 */
  function tick(now: number) {
    halves++
    prevTick = lastTick
    lastTick = now
    if (firstTick === 0) firstTick = now
  }

  return {
    reset() {
      hist = []
      lastTick = 0
      prevTick = 0
      firstTick = 0
      halves = 0
      phase = null
      amp = 0
    },

    debug() {
      return { ampPx: amp, halves, phase, firstTick, lastTick }
    },

    feed(y, now) {
      hist.push({ y, t: now })
      while (hist.length && now - hist[0]!.t > config.windowMs) hist.shift()

      const revs = halves / 2
      if (hist.length < 4) return { rate: rateAt(now), revs, active: false }

      let lo = Infinity
      let hi = -Infinity
      for (const p of hist) {
        if (p.y < lo) lo = p.y
        if (p.y > hi) hi = p.y
      }
      amp = hi - lo
      if (amp < config.minAmpPx) {
        // 진폭 부족 = 정지 또는 미세 떨림. 위상은 유지한다(잠깐 느려진 것으로 방향을 잃지 않게)
        return { rate: rateAt(now), revs, active: false }
      }

      // 슈미트 트리거 — 중심에서 불감대를 넘어야 반전으로 인정한다
      const mid = (hi + lo) / 2
      const band = amp * config.deadband
      if (y > mid + band) {
        if (phase === 'down') tick(now)
        phase = 'up'
      } else if (y < mid - band) {
        if (phase === 'up') tick(now)
        phase = 'down'
      }

      return { rate: rateAt(now), revs: halves / 2, active: true }
    },
  }
}
