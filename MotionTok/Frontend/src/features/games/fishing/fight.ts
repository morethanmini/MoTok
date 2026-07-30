/**
 * 게임⑤ 낚시 — 힘겨루기 게이지 (기획 §힘겨루기, S15P11A706-10).
 *
 * 기획: "릴을 감으면 물고기 힘이 감소, 멈추면 회복. 즉 계속 감아야 한다."
 *
 * 핵심 설계 결정 — 진행도를 **누적 왕복 수가 아니라 감기 속도(rate)로** 굴린다.
 *
 * 왜: 3인 실측(2026-07-29)에서 펌핑 카운트가 사람마다 90~115%로 편향됐다. 누적 카운트로
 * 진행을 굴리면 그 편향이 "잡히는 물고기 / 못 잡는 물고기"로 그대로 나타난다. 반면 속도는
 * 오차가 누적되지 않아서 — 반주기 하나 놓치면 게이지가 잠깐 덜 차고 바로 회복된다 —
 * 같은 편향이 "1초쯤 더 걸린다"로 흡수된다. 그리고 기획의 힘겨루기가 원래 속도 모델이다.
 *
 * 어종별 난이도 노브는 셋이다: 요구 속도(requiredRate) · 채우는 속도(gain) · 저항(drain).
 */

export interface FishSpec {
  /** 표시 이름 */
  name: string
  /** 점수 */
  score: number
  /** 이 속도(왕복/s) 이상으로 감아야 게이지가 찬다 */
  requiredRate: number
  /** 요구 속도를 충족했을 때 초당 채워지는 진행도(0~1 기준) */
  gain: number
  /** 못 미쳤을 때 초당 빠지는 진행도 — 물고기의 저항 */
  drain: number
  /**
   * 설계 목표 소요 시간(초) — 실제 플레이에서 이만큼 걸리게 만들려는 값이다.
   *
   * gain으로 역산하지 않고 따로 적는다. 실측 소요 시간이 idealCatchSeconds의 몇 배가 되는지가
   * 어종마다 달라서다(2026-07-29: 멸치 2.4배 / 광어 2.1배 / 상어 3.3배). 요구 속도가 높을수록
   * 문턱 아래에 머무는 시간이 길어져 배율이 커진다 — 단일 배율로는 표현할 수 없다.
   * 그래서 gain은 순수 튜닝 노브, targetSec은 의도를 적어두는 자리로 분리했다.
   */
  targetSec: number
}

export interface FightSample {
  /** 진행도 0~1. 1이면 낚아올림 */
  progress: number
  /** 지금 감기고 있는지(요구 속도 충족) — DANGER 연출의 반대 조건 */
  reeling: boolean
  /** 'fighting' | 'caught' | 'escaped' */
  state: FightState
  /** 시작 유예 중 — 아직 저항이 걸리지 않는다. DANGER를 띄우면 안 되는 구간 */
  grace: boolean
}

export type FightState = 'fighting' | 'caught' | 'escaped'

export interface Fight {
  /**
   * @param rate 현재 감기 속도(왕복/s) — pump.feed의 rate를 그대로 넣는다
   * @param dtSec 지난 프레임과의 간격(초)
   */
  step(rate: number, dtSec: number): FightSample
  /** 새 물고기 */
  reset(fish: FishSpec): void
  fish(): FishSpec
}

/**
 * 시작 진행도 — 0에서 시작하면 첫 프레임에 바로 도망 판정이 날 수 있다.
 * 훅킹 직후엔 이미 물고기가 걸린 상태이므로 여유를 준다.
 */
const START_PROGRESS = 0.3

/**
 * 시작 유예(초) — 이 시간 동안은 저항이 걸리지 않는다(감기면 차긴 한다).
 *
 * 유예가 없으면 손을 올려 자리 잡기도 전에 끝난다. 실기에서 광어(drain 0.32)가 세 번 모두
 * 0.8초 만에 도망갔다(2026-07-29) — 유저가 감기 시작할 틈이 물리적으로 없었다.
 *
 * 1.5초로는 부족하다는 게 2026-07-30에 드러났다. **pump 워밍업(약 1초)을 몰랐을 때 잡은
 * 값이다** — 유예가 끝나는 시점에도 rate는 아직 0일 수 있다. 반주기 2개가 모여야 rate가
 * 나오므로, 유저가 t=1.0초에 감기를 시작하면 rate는 t=2.0초에야 나온다.
 * `WARMUP_SEC(1초) + 사람 반응(약 0.5초)`을 덮도록 2.0초로 올린다.
 */
const GRACE_SEC = 2

export function createFight(initial: FishSpec): Fight {
  let spec = initial
  let progress = START_PROGRESS
  let state: FightState = 'fighting'
  let elapsed = 0

  return {
    fish: () => spec,

    reset(fish) {
      spec = fish
      progress = START_PROGRESS
      state = 'fighting'
      elapsed = 0
    },

    step(rate, dtSec) {
      if (state !== 'fighting') return { progress, reeling: false, state, grace: false }

      elapsed += dtSec
      const grace = elapsed <= GRACE_SEC
      const reeling = rate >= spec.requiredRate
      // 유예 중에는 저항을 걸지 않는다 — 감으면 차고, 안 감아도 줄지 않는다
      if (reeling) progress += spec.gain * dtSec
      else if (!grace) progress -= spec.drain * dtSec

      if (progress >= 1) {
        progress = 1
        state = 'caught'
      } else if (progress <= 0) {
        progress = 0
        state = 'escaped'
      }
      return { progress, reeling, state, grace }
    },
  }
}

/**
 * 어종표 — 기획 §물고기 종류의 점수를 유지하고, "필요 릴 N회"를 속도 모델로 옮긴 값이다.
 *
 * ── 2026-07-30 전면 재보정 (게임 루프 실기 6전) ──
 * 실측 **지속 감기 속도가 1.45~2.41 왕복/s(평균 2.07)**로 나왔다. 이전 표의 요구 속도가
 * 0.30~0.75였으니 전 어종이 문턱의 3~7배 아래였다 — **감기만 하면 무조건 잡히고 DANGER가
 * 뜰 일이 없었다.** 힘겨루기가 씨름이 아니라 대기 시간이었다.
 *
 * (이전 표의 0.37~0.63은 릴 판정이 "양손 사이 거리"였을 때의 값이다. 크랭크 손 y로 바꾸면서
 *  같은 동작의 측정값이 3배 올라갔다. 판정 신호를 바꾸면 밸런스는 통째로 다시 재야 한다.)
 *
 * ── 요구 속도 배치 ──
 * 실측 밴드(최저 1.45 / 평균 2.07) 안에 펼친다. 멸치 0.50은 누구나 넘고, 상어 1.55는
 * 실측 최저보다 위라 **자주 문턱 아래로 떨어진다** — 그게 큰 물고기의 저항이다.
 *
 * ── 요구 속도는 게이트, gain은 타이머 ──
 * 처음엔 "요구 속도 주변에서 진행도가 차다 말다 한다"고 보고 `p·gain − (1−p)·drain`로 gain을
 * 역산했다. **시뮬레이션이 그 모델을 반박했다** — 실측 지속 속도(1.45~2.41)의 변동 폭보다
 * 어종 간 요구 속도 간격이 좁아서, 실제로는 거의 항상 문턱 위이거나 항상 아래다.
 *
 * 즉 요구 속도는 "이 속도를 낼 수 있냐"는 **게이트**이고, 걸리는 시간은 gain이 혼자 정한다.
 *
 * DANGER는 그럼 언제 뜨나 — **손을 멈추거나 자세를 고치는 순간**이다. pump의 rate는 감기를
 * 멈추면 0으로 감쇠하므로 어떤 어종에서든 즉시 문턱 아래로 떨어진다.
 *
 * ── gain은 실측 배율까지 넣어 역산한다 ──
 * `gain = 0.7/targetSec`으로 잡았더니 실제 소요가 목표의 1.3배 + 1초로 나왔다(7전 실측:
 * 멸치 3s→4.4~5.1s, 광어 7s→8.1~8.5s, 상어 20s→26.2s). 원인 두 개다.
 *
 *   ① **pump 워밍업 약 1초** — 반주기 2개가 모여야 rate가 나오므로 힘겨루기 시작 직후
 *      rate가 0이다. 시작 유예(1.5초) 덕에 저항은 안 걸리지만 진행도도 안 찬다.
 *   ② **순간 rate가 방향 전환에서 문턱 아래로 떨어지는 시간** — 지속 속도가 요구를 넉넉히
 *      넘어도(실측 2.20~2.80 vs 상어 요구 1.55) 매 순간 넘는 건 아니다.
 *
 * 둘 다 gain으로는 못 없애는 구조적 지연이라 역산식에 넣는다:
 * `WARMUP_SEC + MEASURED_FACTOR × (0.7/gain) = targetSec`.
 *
 * ── drain은 gain에 비례하되 상한이 있어야 한다 ──
 * "큰 물고기일수록 저항이 크다"는 성립할 수 없다. 잡히는 조건이 `p·gain > (1−p)·drain`인데
 * 큰 물고기는 오래 걸리게 하려고 gain을 낮추므로 **drain도 같이 낮아져야 잡을 수 있다.**
 * drain을 키우면 이전 버전에서처럼 물리적으로 불가능한 물고기가 된다.
 * `drain = 1.5 × gain`이면 요구 속도를 60% 이상 유지하는 한 항상 잡힌다.
 *
 * 다만 **작은 물고기에는 상한이 필요하다.** 비례 규칙만 쓰면 gain이 가장 큰 멸치가 drain도
 * 가장 커져(0.68) 유예가 끝난 뒤 `START_PROGRESS ÷ drain = 0.44초` 만에 게이지가 빈다.
 * pump 워밍업이 1초인데 0.44초 안에 rate를 만들 수는 없다 — 2026-07-30 실기에서 멸치 4마리 중
 * 3마리가 `관측최대=0.00`으로, 즉 **감기를 시작하지도 못한 채** 도망갔다.
 * 작은 물고기가 가장 빨리 죽는 건 말이 안 되므로 `DRAIN_CAP`으로 자른다.
 *
 * ⚠ n=1(6전). 다른 사람의 지속 속도가 1.45보다 낮으면 참치·상어를 영원히 못 잡는다.
 *   멀티플레이 공정성에 직결되므로 표본을 늘려야 한다.
 */
export const FISH: FishSpec[] = [
  { name: '멸치', score: 5, requiredRate: 0.5, gain: 0.455, drain: 0.25, targetSec: 3 },
  { name: '고등어', score: 15, requiredRate: 0.7, gain: 0.228, drain: 0.25, targetSec: 5 },
  { name: '광어', score: 25, requiredRate: 0.9, gain: 0.152, drain: 0.228, targetSec: 7 },
  { name: '농어', score: 35, requiredRate: 1.1, gain: 0.114, drain: 0.171, targetSec: 9 },
  { name: '연어', score: 45, requiredRate: 1.25, gain: 0.091, drain: 0.137, targetSec: 11 },
  { name: '참치', score: 70, requiredRate: 1.4, gain: 0.07, drain: 0.105, targetSec: 14 },
  { name: '상어', score: 120, requiredRate: 1.55, gain: 0.048, drain: 0.072, targetSec: 20 },
]

/** 어종표의 불변식 — drain은 gain에 비례한다. 이 비율이 깨지면 못 잡는 물고기가 생긴다 */
export const DRAIN_PER_GAIN = 1.5
/**
 * drain 상한. 유예가 끝난 직후 게이지(START_PROGRESS)가 비기까지 걸리는 시간이
 * **최소 1.2초**는 되도록 자른다 — 0.3 ÷ 0.25 = 1.2초.
 * 이보다 짧으면 pump 워밍업(1초) 때문에 감기 시작이 조금만 늦어도 손쓸 수 없이 도망간다.
 */
export const DRAIN_CAP = 0.25

/**
 * pump가 왕복을 인식하기까지의 워밍업(초).
 * 반주기 2개가 모여야 rate가 나오므로 힘겨루기 시작 직후에는 진행도가 안 찬다.
 */
export const WARMUP_SEC = 1
/**
 * 실제 소요 ÷ 이론 소요. 2026-07-30 7전 실측에서 어종 무관하게 약 1.3이었다
 * (지속 속도가 요구를 넉넉히 넘어도 방향 전환에서 순간 rate가 문턱 아래로 떨어진다).
 */
export const MEASURED_FACTOR = 1.3

/**
 * 요구 속도를 **끊김 없이** 유지했을 때 낚아올리기까지 걸리는 시간(초) — 구조적 지연을 뺀 하한.
 * 실제 체감은 아래 expectedCatchSeconds로 본다.
 */
export function idealCatchSeconds(fish: FishSpec): number {
  return (1 - START_PROGRESS) / fish.gain
}

/**
 * 실측 기반 예상 소요 시간(초). gain을 이 값이 targetSec과 같아지도록 역산했으므로
 * 둘이 어긋나면 표를 손댈 때 한쪽만 고친 것이다.
 */
export function expectedCatchSeconds(fish: FishSpec): number {
  return WARMUP_SEC + MEASURED_FACTOR * idealCatchSeconds(fish)
}

/**
 * 감기를 완전히 멈췄을 때 게이지가 가득 찬 상태에서 비기까지 걸리는 시간(초).
 * DANGER 연출이 위협으로 느껴지려면 이 값이 그 어종의 targetSec보다 충분히 짧아야 한다.
 */
export function drainSeconds(fish: FishSpec): number {
  return 1 / fish.drain
}

/**
 * 유예가 끝난 직후부터 게이지가 빌 때까지의 시간(초) — **감기를 시작할 수 있는 마지막 시각**이다.
 * `GRACE_SEC + 이 값`이 pump 워밍업(1초)보다 넉넉히 커야 손쓸 수 없이 도망가는 일이 없다.
 */
export function reactionSeconds(fish: FishSpec): number {
  return GRACE_SEC + START_PROGRESS / fish.drain
}
