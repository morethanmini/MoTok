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
 * 훅킹 직후 "물고기가 걸렸다!" 연출이 지나가는 시간과 맞물린다.
 */
const GRACE_SEC = 1.5

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
 * ── 실측 재보정 (2026-07-29, 랩 3종 플레이) ──
 * 처음엔 "편안한 속도 1.1~1.7 왕복/s"로 잡았는데 **틀렸다.** 그 값은 회전 판정 화면에서 한 번
 * 스쳐본 순간값이었고 지속 가능한 속도가 아니었다. 실제로 지속되는 감기 속도는 **0.37~0.63
 * 왕복/s**였다. 그래서 상어 요구 1.30은 물리적으로 불가능한 숫자였고(측정 0.37 → 도망),
 * 멸치 0.60도 간신히 넘는 수준이었다.
 *
 * 또 하나: **실제 소요 시간이 idealCatchSeconds의 2~3배**로 나온다(멸치 1.5s→4.5s,
 * 광어 3.1s→6.0s). 요구 속도를 계속 유지하지 못해 진행도가 차다 말다 하기 때문이다.
 * 이건 정상이다 — 힘겨루기가 실제로 씨름이 된다는 뜻이라 그대로 둔다.
 * 대신 gain은 "목표 체감 시간 ÷ 2.5"를 이론 시간으로 잡아 역산했다.
 *
 * 목표 체감 시간(90초 한 판 기준): 멸치 3s → 상어 18s.
 *
 * ⚠ 세 동작(캐스팅·훅킹·릴)을 이어붙인 실제 게임 루프에서 한 번 더 확인해야 한다.
 */
export const FISH: FishSpec[] = [
  { name: '멸치', score: 5, requiredRate: 0.3, gain: 0.56, drain: 0.12, targetSec: 3 },
  { name: '고등어', score: 15, requiredRate: 0.38, gain: 0.31, drain: 0.15, targetSec: 5 },
  { name: '광어', score: 25, requiredRate: 0.45, gain: 0.21, drain: 0.18, targetSec: 7 },
  { name: '농어', score: 35, requiredRate: 0.52, gain: 0.18, drain: 0.21, targetSec: 9 },
  { name: '연어', score: 45, requiredRate: 0.58, gain: 0.16, drain: 0.24, targetSec: 11 },
  { name: '참치', score: 70, requiredRate: 0.65, gain: 0.14, drain: 0.26, targetSec: 14 },
  { name: '상어', score: 120, requiredRate: 0.75, gain: 0.115, drain: 0.28, targetSec: 20 },
]

/**
 * 요구 속도를 **끊김 없이** 유지했을 때 낚아올리기까지 걸리는 시간(초) — 하한값이다.
 * 실측 체감 시간은 이 값의 2~3배로 나온다(2026-07-29): 사람은 요구 속도를 계속 유지하지
 * 못해 진행도가 차다 말다 하기 때문이다. 밸런스는 아래 expectedCatchSeconds로 본다.
 */
export function idealCatchSeconds(fish: FishSpec): number {
  return (1 - START_PROGRESS) / fish.gain
}

/**
 * 실측 배율 = 실제 소요 ÷ idealCatchSeconds. 어종마다 다르다 (2026-07-29 실측):
 * 멸치 2.4 / 광어 2.1 / 상어 3.3. 요구 속도가 높을수록 문턱 아래 머무는 시간이 길어 커진다.
 * gain을 조정할 때 이 표를 근거로 쓴다 — 단일 상수로 쓰면 큰 물고기가 목표보다 오래 걸린다.
 */
export const MEASURED_FACTORS = { 멸치: 2.4, 광어: 2.1, 상어: 3.3 } as const
