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

/**
 * 감기 **유지** 문턱 비율 — 시작은 `requiredRate` 100%, 한 번 감기 시작하면 이 비율까지 인정한다.
 *
 * 슈미트 트리거다(`pump.ts`가 반전 판정에 `deadband`로 쓰는 것과 같은 패턴). 이진 판정만
 * 있으면 문턱을 한 프레임 밑돌 때 진행이 멈추는 게 아니라 `drain`(gain의 1.5배)으로 **역주행**
 * 한다 — 실기 지적 2026-07-31 "릴 감을 때 끊김이 있다"의 절반이 이것이다.
 *
 * 손목 y로 회전을 재는 건 원운동을 1차원에 투영하는 것이라 방향 전환마다 순간 속도가 내려간다.
 * 플레이어가 느려진 게 아니라 측정 방식의 한계이므로, 보정하는 게 맞다.
 */
export const REEL_HOLD_RATIO = 0.7

/**
 * 요구 속도를 넘긴 만큼 게이지를 더 준다 — 그 배수의 상한.
 *
 * `rate / requiredRate`를 gain에 곱하고 [1, 이 값]으로 자른다. **요구를 딱 맞췄을 때는 1.0**
 * 이라 기존 밸런스(expectedCatchSeconds ≈ targetSec)가 그대로 유지되고, 확실히 빠르게 감을 때만
 * 후해진다. "정확하게 측정됐을 때 후하게 준다"는 요구(2026-07-31)의 구현이다.
 *
 * 문턱 **아래**로는 이 보정을 주지 않는다 — 그러면 줄다리기 긴장이 사라져 힘겨루기가 대기
 * 시간이 된다(2026-07-30에 표를 전면 재보정한 이유가 바로 그 상태였다).
 *
 * 1.5는 실측 평균 지속 속도(2.07)를 상어 요구(1.4)로 나눈 값(1.48)을 덮는 자리다 —
 * 평균적인 사람이 제대로 감으면 보너스를 거의 다 받는다.
 */
export const GAIN_BONUS_MAX = 1.5

export function createFight(initial: FishSpec): Fight {
  let spec = initial
  let progress = START_PROGRESS
  let state: FightState = 'fighting'
  let elapsed = 0
  /** 직전 프레임에 감기로 인정됐는지 — 유지 문턱(REEL_HOLD_RATIO)의 기준 */
  let wasReeling = false

  return {
    fish: () => spec,

    reset(fish) {
      spec = fish
      progress = START_PROGRESS
      state = 'fighting'
      // 이월되면 새 물고기가 첫 프레임부터 유지 문턱(70%)으로 시작한다
      wasReeling = false
      elapsed = 0
    },

    step(rate, dtSec) {
      if (state !== 'fighting') return { progress, reeling: false, state, grace: false }

      elapsed += dtSec
      const grace = elapsed <= GRACE_SEC
      // 시작은 요구 속도 100%, 유지는 REEL_HOLD_RATIO까지 — 방향 전환의 순간 저하로 역주행하지 않게
      const threshold = wasReeling ? spec.requiredRate * REEL_HOLD_RATIO : spec.requiredRate
      const reeling = rate >= threshold
      wasReeling = reeling
      // 유예 중에는 저항을 걸지 않는다 — 감으면 차고, 안 감아도 줄지 않는다
      if (reeling) {
        // 요구를 넘긴 만큼 후하게. 딱 맞추면 1.0이라 기존 밸런스가 기준선으로 남는다
        const bonus = Math.min(GAIN_BONUS_MAX, Math.max(1, rate / spec.requiredRate))
        progress += spec.gain * bonus * dtSec
      } else if (!grace) progress -= spec.drain * dtSec

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
  /*
   * 15종 — 스프라이트 시트(fish-sheet.png)의 15칸과 1:1이다.
   *
   * 기존 7종(흰동가리·금붕어·광어·붉은돔·연어·참치·상어)의 점수·요구속도·targetSec은 실측
   * 그대로다. 새로 넣은 8종은 **임의값이 아니라** 그 사이를 채운 값이다:
   *   requiredRate — 이웃 두 종 사이를 선형 보간(전 구간 단조 증가 유지)
   *   targetSec    — 이웃 두 종 사이(단조 증가 유지)
   *   gain         — targetSec에서 역산: 0.91 / (targetSec - 1)
   *                  (= MEASURED_FACTOR × (1 - START_PROGRESS) / (targetSec - WARMUP_SEC))
   *   drain        — min(DRAIN_CAP, gain × DRAIN_PER_GAIN)
   * 즉 gain·drain은 자유도가 없다. 고를 수 있는 건 점수·요구속도·targetSec 세 개뿐이고
   * 그 세 개도 기존 대역 안에 들어간다 — 새 종이 기존 종보다 쉬우면서 점수가 높은 일은 없다.
   *
   * 기존 7종의 gain·drain은 손으로 3자리까지 반올림돼 있었는데 여기서 같은 식으로 4자리
   * 재계산했다(0.152 → 0.1517 등). expectedCatchSeconds ≈ targetSec 검사가 더 정확히 맞는다.
   */
  { name: '흰동가리', score: 5, requiredRate: 0.5, gain: 0.455, drain: 0.25, targetSec: 3 },
  { name: '블루탱', score: 10, requiredRate: 0.58, gain: 0.3033, drain: 0.25, targetSec: 4 },
  { name: '금붕어', score: 15, requiredRate: 0.66, gain: 0.2275, drain: 0.25, targetSec: 5 },
  { name: '노랑탱', score: 20, requiredRate: 0.74, gain: 0.182, drain: 0.25, targetSec: 6 },
  { name: '광어', score: 25, requiredRate: 0.82, gain: 0.1517, drain: 0.2276, targetSec: 7 },
  { name: '베타', score: 30, requiredRate: 0.9, gain: 0.13, drain: 0.195, targetSec: 8 },
  { name: '붉은돔', score: 35, requiredRate: 0.98, gain: 0.1138, drain: 0.1707, targetSec: 9 },
  { name: '만다린', score: 40, requiredRate: 1.05, gain: 0.1011, drain: 0.1517, targetSec: 10 },
  { name: '연어', score: 45, requiredRate: 1.12, gain: 0.091, drain: 0.1365, targetSec: 11 },
  { name: '복어', score: 50, requiredRate: 1.18, gain: 0.0827, drain: 0.124, targetSec: 12 },
  { name: '모오리돔', score: 55, requiredRate: 1.24, gain: 0.0791, drain: 0.1187, targetSec: 12.5 },
  { name: '메기', score: 60, requiredRate: 1.29, gain: 0.0758, drain: 0.1137, targetSec: 13 },
  { name: '참치', score: 70, requiredRate: 1.34, gain: 0.07, drain: 0.105, targetSec: 14 },
  { name: '청새치', score: 100, requiredRate: 1.37, gain: 0.0674, drain: 0.1011, targetSec: 14.5 },
  /*
   * 상어만 20초 → 15초로 줄였다.
   *
   * 실기에서 26.7초 걸렸다(2026-07-30, 지속 2.41/s로 요구 1.55를 1.55배 넘겼는데도). 26초
   * 연속으로 릴을 돌리면 팔이 아파서 재미가 아니라 노동이 된다.
   *
   * 같은 세션에서 실측 배율을 역산하면 흰동가리 1.04 / 광어 1.13 / 상어 1.76이다. 평균 1.31이라
   * `MEASURED_FACTOR = 1.3`은 전역으로 잘 맞고 **상어만 이탈**한다 — 요구 속도가 높아 순간
   * 속도가 문턱 아래로 떨어지는 시간이 길기 때문이다.
   *
   * 배율을 어종별로 쪼개지 않고 gain만 올렸다. 어종별 배율은 종당 표본이 1건뿐이라 과적합이다.
   */
  { name: '상어', score: 120, requiredRate: 1.4, gain: 0.065, drain: 0.0975, targetSec: 15 },
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
