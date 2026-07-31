/**
 * 게임⑤ 낚시 — 캐스팅 판정 (기획 §낚싯대 던지기, S15P11A706-10).
 *
 * 기획: "낚싯대를 뒤로 젖혔다가 앞으로 던지는 모션."
 *
 * ── 신호: 양손 손목의 중점 ──
 * 양손으로 대를 쥐고 던지는 동작이므로 두 손이 함께 움직인다. 중점을 쓰면 노이즈가 단일
 * 손목의 절반이고, "양손으로 쥐었는지"가 자동으로 검증된다(한 손을 놓치면 판정이 멈춘다).
 *
 * ── 파워: 최고 속도가 아니라 **낙하 거리** ──
 * 이게 이 파일의 핵심 결정이고, 실측이 이전 설계를 뒤집었다(2026-07-30, 강 12회 / 약 9회).
 *
 *   신호          강              약              겹침
 *   최고 속도     ×6.49~12.13/s   ×3.68~7.53/s    있음  ← 이전 설계
 *   상승 거리     ×0.70~1.34      ×0.34~0.77      있음
 *   낙하 거리     ×0.97~1.28      ×0.52~0.73      없음(갭 33%)  ← 채택
 *
 * 낙하를 **최저점 기준**으로 고친 뒤 다시 측정했다(같은 날 늦게, 강 6회 / 약 10회). 결론은
 * 같지만 대역이 전부 커졌다 — 위 값들은 속도 종료가 팔로스루를 잘라먹은 값이었다:
 *
 *   신호          강              약              겹침
 *   최고 속도     ×7.28~11.19/s   ×4.22~11.42/s   있음(거의 전체)
 *   상승 거리     ×0.80~1.78      ×0.38~1.04      있음
 *   최대낙하      ×1.28~1.92      ×0.64~1.22      없음(갭 4.9%)  ← 문턱 근거
 *
 * 갭이 33%에서 4.9%로 줄어든 건 신호가 나빠진 게 아니라 **이전 측정이 좁게 잘려 있었기**
 * 때문이다. 두 세션 모두 낙하만 겹치지 않는다는 결론은 같다.
 *
 * 속도는 유저 의도를 **뒤집어 읽은 사례가 실제로 나왔다**: 강하게 던진 스윙이 ×6.49/s,
 * 약하게 던진 스윙이 ×7.53/s로 찍혔다. 같은 두 스윙을 낙하 거리로 재면 ×0.97 / ×0.72로
 * 정확히 갈린다.
 *
 * 물리적으로 당연하다 — 속도는 미분값이라 지터를 증폭하고, "세게"를 스냅으로 내는지 스트로크
 * 길이로 내는지가 사람마다·회차마다 다르다. 반면 낙하 거리는 팔로스루의 크기, 곧 던지는
 * 커밋먼트를 직접 인코딩한다.
 *
 * ── 삭제한 것: 조준 잠금 단계 ──
 * 이전 설계는 "손목을 어깨보다 위로 올려 180ms 유지(armed) → 어깨 아래로 내려꽂기"였다.
 * 실제 캐스팅에는 유지 구간이 없고, 어깨선을 기준으로 삼으면 낮게 젖히는 사람이 던질 수
 * 없다. 백스윙은 이제 "상승 거리가 문턱을 넘었다"는 조건 하나이고, 정점에서 멈출 필요가 없다.
 *
 * ── 문턱은 전부 어깨 너비 배수다 ──
 * px 문턱은 카메라 거리에 흔들린다. `normalize.ts` 참고.
 */

export interface CastConfig {
  /** 백스윙으로 인정하는 최소 상승 (어깨너비 배수) */
  riseGateSw: number
  /** 포워드 스윙 시작으로 보는 하향 속도 (어깨너비/s) */
  startVelSw: number
  /** 발사로 인정하는 최소 낙하 (어깨너비 배수) — 이 값이 파워 0이다 */
  dropMinSw: number
  /** 파워 1.0에 해당하는 낙하 (어깨너비 배수) */
  dropFullSw: number
  /** 스윙을 지켜보는 상한(ms) — 이 시간이 지나면 무조건 판정한다 */
  observeMs: number
  /**
   * 스윙 종료 = 손이 최저점에서 이만큼(어깨너비 배수) 되올라왔다.
   *
   * 예전에는 속도로 끝냈다(`vel < peakVel*0.4 || velSw < 0.73`). 그런데 낙하를 종료 순간의
   * 값으로 재기 때문에, **느린 스윙일수록 일찍 끝나 낙하가 깎였다** — 랩에서 한 던짐이
   * 낙하 -58px / 최대낙하 42px로 찍혔다(2026-07-30). 약하게 던지려는 시도가 무효로 끝나는
   * 경로 중 하나였다.
   *
   * 위치 기반이면 "팔로스루가 바닥을 찍고 되돌아왔다"는 실제 사건에 맞춰 끝난다. 지터 한
   * 프레임에 닫히지 않게 문턱을 두되, 어깨너비 배수라 카메라 거리에 안 흔들린다.
   */
  endBackSw: number
  /** 속도 계산 창(ms) */
  velWindowMs: number
  /** 조준 x를 몇 ms 전 값으로 쓸지 — 내려꽂는 동안의 흔들림 배제 */
  aimLagMs: number
  /** 발사 후 재발사 금지(ms) — 손이 되돌아오는 반동을 두 번 세지 않게 */
  cooldownMs: number
  /** 상승·낙하를 재는 창(ms) */
  spanWindowMs: number
  /**
   * reset 직후 판정을 쉬는 시간(ms). 기준점 추적은 계속하되 발사·조준만 막는다.
   *
   * 페이즈가 바뀌는 순간 남아 있던 빠른 하향 동작이 곧바로 던짐으로 읽히는 걸 막는 용도다.
   * RESULT 페이즈가 이미 1.8초라 체감 지연은 없다.
   */
  settleMs: number
  /**
   * 백스윙이 최소한 이만큼(ms) 지속돼야 포워드 스윙으로 넘어간다.
   *
   * 조준과 스윙이 거의 동시에 일어나는 건 던짐이 아니라 문턱 경계의 잡음이다
   * (실기 무효 1건이 이 경로였다: 상승 ×0.30 = 문턱 정확히 걸침, 낙하 ×0.05).
   * 실측 성공 던짐 6회는 조준→스윙 간격이 전부 **1000ms 이상**이었으니 200ms는 5배 여유다.
   * 100ms로 잡았다가 스펙에서 되돌렸다 — 3프레임짜리 잡음이 그대로 통과했다.
   *
   * 이전 설계의 `holdMs`(어깨 위에서 180ms 자세 유지)와 다르다 — 자세를 잡고 기다리라는
   * 게 아니라, 백스윙이 존재했는지만 본다.
   */
  minBackMs: number
  /**
   * 발사 시점에 손이 백스윙 최고점보다 이만큼(어깨너비 배수) **아래에 남아 있어야** 한다.
   *
   * "손을 올리는 순간 대가 발사된다"를 막는 조건이다(실기 지적 2026-07-31). 경로는 이렇다:
   * 무효로 끝난 던짐 뒤 손이 아래에 있으면 `restY`가 그 낮은 위치로 옮겨지고, 다시 올리는
   * 동안 상승 거리가 곧바로 게이트를 넘어 `back`에 들어간다. 그 시점부터 `minBackMs`(200ms)는
   * 이미 만료돼 있어서, 올리는 중에 랜드마크가 **한 프레임 아래로 튀면** velSw가 순간적으로
   * 치솟아(velWindowMs 창의 끝점이 그 값이 된다) forward로 넘어가고, 그 튐이 그대로 낙하로
   * 측정돼 발사된다.
   *
   * 속도를 "연속 N프레임" 요구하는 방법은 못 쓴다 — 얕고 빠른 던짐은 30fps에서 하향이
   * **1프레임**에 끝나고(스펙 `strong(0.46)`), 그걸 잘라내면 약한 던짐이 다시 죽는다.
   *
   * 대신 위치로 가른다: 튐은 다음 프레임에 원래 높이로 **되돌아오고**, 진짜 던짐은 팔로스루
   * 뒤에도 손이 최고점보다 훨씬 아래에 있다. 스윙 종료가 `endBackSw`(0.05) 되올라옴이므로
   * 진짜 던짐은 최소 `dropMinSw - endBackSw = 0.40` 아래에 남는다. 0.2는 그 절반이고 튐(≈0)과
   * 확실히 갈린다. 프레임률과 무관한 조건이라는 게 이 방식의 이점이다.
   */
  holdBelowPeakSw: number
}

export const DEFAULT_CAST: CastConfig = {
  // 실측 약한 던짐의 상승 하한이 ×0.34, 팔을 내리는 동작이 ×0.16~0.43이었다.
  // 0.3은 약한 던짐을 살리면서 "던지지 않고 팔만 내리는" 경로 대부분을 자른다.
  riseGateSw: 0.3,
  /*
   * 3.5 — 실제 던짐과 중단 동작을 가르는 자리.
   *
   * 1.5였을 때 랩 기록 8개 중 3개가 던짐이 아니었다. 중단·복귀 동작은 ×2.0~2.8/s에 몰리고
   * 최대낙하가 ×0.17~0.25뿐이라, 1.5를 통과한 뒤 낙하 문턱에서 무효로 끝났다 — 유저에게는
   * "던졌는데 아무 일도 안 일어난다"로 보인다.
   *
   * 한 번 5.0으로 올렸다가 되돌렸다. 약한 던짐 실측이 ×4.22~11.42/s였고(2026-07-30, n=10)
   * 5.0은 가장 약한 3회를 잘라내 문제를 더 키운다. 3.5는 두 무리 사이(기하평균 3.44)이고
   * 아래로 25%, 위로 20% 여유가 있다. 여유가 좁은 건 두 무리가 실제로 붙어 있기 때문이다.
   */
  startVelSw: 3.5,
  // 약한 던짐 최대낙하 하한 ×0.64 아래. 문턱을 넘지 못하면 발사되지 않는다
  dropMinSw: 0.45,
  /*
   * 1.9 — 강한 던짐 최대낙하 상한(×1.92)에 맞춘 값.
   *
   * 1.3이었을 때가 "약하게 던져도 멀리 간다"의 원인이었다. 같은 측정 방식으로 강/약을 다 받아
   * 보니(2026-07-30, 강 6회 / 약 10회) 대역이 이랬다:
   *   약 최대낙하 ×0.64~1.22
   *   강 최대낙하 ×1.28~1.92   ← 겹치지 않는다(갭 4.9%)
   * 1.3은 약한 던짐의 위쪽 절반을 이미 파워 1.0 근처로 밀어올렸다(×1.22 → 0.91).
   * 1.9로 올리면 약 0.13~0.53 / 강 0.57~1.00으로 경계가 0.55에 떨어진다.
   *
   * 상승 거리는 이 대역에서 겹친다(약 최대 ×1.04 > 강 최소 ×0.80). 그래서 파워는 계속 낙하다.
   */
  dropFullSw: 1.9,
  // 실측 스윙이 전부 500ms 안에 끝났다. 팔을 내린 채 멈춰 있으면 되올라옴이 안 오므로 상한이 필요하다
  observeMs: 700,
  // 어깨너비 192px에서 약 10px — 지터(2~3px)보다 크고 팔로스루 반동(30px+)보다 작다
  endBackSw: 0.05,
  velWindowMs: 80,
  aimLagMs: 150,
  cooldownMs: 400,
  spanWindowMs: 1500,
  settleMs: 700,
  minBackMs: 200,
  // 진짜 던짐은 0.40 이상 아래에 남는다(dropMinSw 0.45 - endBackSw 0.05). 그 절반
  holdBelowPeakSw: 0.2,
}

/** idle: 대기 / back: 백스윙 인정(조준 중) / forward: 스윙 관찰 중 */
export type CastPhase = 'idle' | 'back' | 'forward'

export interface CastSample {
  phase: CastPhase
  /** back 동안의 조준 x(캔버스 px, 손을 따라간다). 그 외 null */
  aimX: number | null
  /** 이 프레임에 발사됐으면 파워 0~1(가까이~멀리), 아니면 null */
  fired: number | null
  /** 발사 시 쓰인 조준 x — fired가 null이 아닐 때만 유효 */
  firedAimX: number
  /** 상승 거리(어깨너비 배수) — 랩·연출 표시용 */
  riseSw: number
  /** 낙하 거리(어깨너비 배수) — 파워의 원본값 */
  dropSw: number
  /** 하향 속도(어깨너비/s) — 표시용. 판정에는 스윙 시작·종료에만 쓴다 */
  velSw: number
}

export interface Cast {
  /**
   * @param midX 양손 손목 중점 x (캔버스 px)
   * @param midY 양손 손목 중점 y (캔버스 px, 아래로 갈수록 증가)
   * @param sw   어깨 너비(px) — 0이면 판정하지 않는다
   */
  feed(midX: number, midY: number, sw: number, now: number): CastSample
  reset(): void
}

const IDLE_SAMPLE: CastSample = {
  phase: 'idle',
  aimX: null,
  fired: null,
  firedAimX: 0,
  riseSw: 0,
  dropSw: 0,
  velSw: 0,
}

export function createCast(config: CastConfig = DEFAULT_CAST): Cast {
  let phase: CastPhase = 'idle'
  let hist: { x: number; y: number; t: number }[] = []
  /*
   * 백스윙 기준점 두 개. **창 안의 min/max로 계산하면 안 된다** — 내려가는 동안 최저점이
   * 함께 갱신돼서 "순수 하강"이 상승으로 읽히고, 팔을 내릴 때마다 발사된다(스펙이 잡은 버그).
   * 순서를 가진 상태로 들고 있어야 "올렸다가 내렸다"와 "그냥 내렸다"가 구분된다.
   */
  /**
   * 백스윙 시작 높이 = 가장 최근에 손이 도달한 최저 위치(y 최댓값).
   *
   * **reset이 이 값을 버리면 안 된다.** 물고기를 잡은 직후 손은 릴을 감던 높이(어깨 라인)에
   * 있는데, 거기서 기준점을 새로 잡으면 또 riseGateSw만큼 더 올려야 조준이 걸린다 —
   * 실기에서 "잡은 뒤 다시 던질 때 어깨 아래로 내렸다 올려야 작동한다"로 나타났다(2026-07-30).
   *
   * 기준점은 "손이 쉬는 높이"라는 자세 값이라 페이즈가 바뀌어도 유지되는 게 맞다. 그러면
   * 잡은 직후 손이 어깨 라인에 있는 것 자체가 이미 충분한 상승으로 읽혀 곧바로 조준된다.
   */
  let restY = 0
  /** 백스윙 최고점(y 최솟값) — 낙하의 기준점 */
  let peakY = 0
  let primed = false
  /** 정착 구간 종료 시각 — reset 후 첫 프레임에 정해진다 */
  let settleUntil = 0
  /**
   * reset 직후인지 — 다음 feed에서 정착 구간을 시작한다.
   * 처음 만들었을 때도 true다. 생성 직후와 reset 직후가 다르게 동작할 이유가 없다.
   */
  let settlePending = true
  /** back 진입 시각 — minBackMs를 재는 기준 */
  let backAt = 0
  /** forward 진입 시각 */
  let releaseAt = 0
  /** forward 동안의 최고 하향 속도(px/s) — 표시용 */
  let peakVel = 0
  /** 낙하의 기준점 = 백스윙 최고점(y 최솟값) */
  let dropFrom = 0
  /**
   * forward 동안 손이 도달한 최저 y — 낙하는 이 값으로 잰다.
   *
   * 종료 순간의 y가 아니라 **최저점**이어야 팔로스루의 크기가 된다. 종료 순간을 쓰면 되올라오는
   * 중의 위치가 섞여 낙하가 작아진다.
   */
  let bottomY = 0
  /** forward 진입 시점에 잠근 조준 x */
  let lockedAimX = 0
  let cooldownUntil = 0

  /** 창 양 끝의 기울기로 낸 하향 속도(px/s). 양수 = 아래로 */
  function downVel(now: number): number {
    const w = hist.filter((s) => now - s.t <= config.velWindowMs)
    if (w.length < 2) return 0
    const a = w[0]!
    const b = w[w.length - 1]!
    const dt = (b.t - a.t) / 1000
    return dt > 0 ? (b.y - a.y) / dt : 0
  }

  /** aimLagMs 전의 x — 없으면 가장 오래된 값 */
  function laggedX(now: number): number {
    const target = now - config.aimLagMs
    let best = hist[0]
    for (const s of hist) {
      if (s.t <= target) best = s
      else break
    }
    return best?.x ?? 0
  }

  return {
    reset() {
      phase = 'idle'
      hist = []
      peakVel = 0
      cooldownUntil = 0
      settlePending = true
      /*
       * restY는 유지하고 peakY만 되돌린다.
       *
       * peakY까지 남기면 이전 백스윙의 최고점에서 낙하를 재게 되어 파워가 항상 1.0이 된다.
       * restY로 되돌리면 "아직 백스윙 없음" 상태가 되고, 손이 이미 올라가 있으면 첫 프레임에
       * peakY가 그 위치로 내려가면서 정상적인 상승 거리가 잡힌다.
       */
      peakY = restY
    },

    feed(midX, midY, sw, now) {
      hist.push({ x: midX, y: midY, t: now })
      while (hist.length && now - hist[0]!.t > config.spanWindowMs) hist.shift()

      if (!primed) {
        restY = midY
        peakY = midY
        primed = true
      }
      if (settlePending) {
        settleUntil = now + config.settleMs
        settlePending = false
      }

      // 어깨를 못 봤으면 문턱을 계산할 수 없다 — 신호만 쌓고 판정은 건너뛴다
      if (!(sw > 0)) return { ...IDLE_SAMPLE, phase }

      const settling = now < settleUntil
      const vel = downVel(now)
      const velSw = vel / sw

      let fired: number | null = null
      let firedAimX = 0
      let dropSw = 0

      switch (phase) {
        case 'idle':
          if (midY >= restY) {
            // 새 최저점 — 백스윙 기준을 여기로 옮긴다. 순수 하강은 여기만 반복하므로
            // rise가 0에 머물고 절대 게이트를 넘지 못한다
            restY = midY
            peakY = midY
          } else if (midY < peakY) {
            peakY = midY
          }
          // 백스윙 게이트 — 어깨선 기준은 없다. 올린 거리 하나만 본다
          if (
            !settling &&
            (restY - peakY) / sw >= config.riseGateSw &&
            now >= cooldownUntil
          ) {
            phase = 'back'
            backAt = now
          }
          break

        case 'back':
          if (midY < peakY) peakY = midY
          // 백스윙이 존재했어야 한다 — 조준과 스윙이 같은 프레임이면 잡음이다
          if (velSw >= config.startVelSw && now - backAt >= config.minBackMs) {
            phase = 'forward'
            releaseAt = now
            peakVel = vel
            // 낙하는 백스윙 최고점부터 잰다
            dropFrom = peakY
            bottomY = midY
            // 조준은 내려꽂기 직전 위치로 잠근다 — 스윙 중 흔들림이 섞이지 않게
            lockedAimX = laggedX(now)
          } else if (midY >= restY) {
            // 던지지 않고 천천히 내렸다 — 취소. 기준을 여기로 옮긴다
            phase = 'idle'
            restY = midY
            peakY = midY
          }
          break

        case 'forward': {
          if (vel > peakVel) peakVel = vel
          if (midY > bottomY) bottomY = midY
          // 최저점 기준 — 되올라오는 중에도 값이 줄지 않는다
          dropSw = (bottomY - dropFrom) / sw
          const ended =
            now - releaseAt >= config.observeMs ||
            (bottomY - midY) / sw >= config.endBackSw
          if (ended) {
            // 손이 최고점 아래에 남아 있는가 — 한 프레임 튐은 원위치로 되돌아와 여기서 걸린다
            // (holdBelowPeakSw 주석: "손을 올리는 순간 발사" 경로)
            const heldBelow = (midY - dropFrom) / sw >= config.holdBelowPeakSw
            // 낙하가 문턱을 못 넘으면 던진 게 아니다 — 팔을 툭 내린 경로가 여기서 걸린다
            if (dropSw >= config.dropMinSw && heldBelow) {
              const denom = config.dropFullSw - config.dropMinSw
              fired = Math.min(1, Math.max(0, (dropSw - config.dropMinSw) / denom))
              firedAimX = lockedAimX
            }
            phase = 'idle'
            // 다음 백스윙은 지금 위치에서 새로 잰다 — 이번 낙하가 상승으로 새지 않게
            restY = midY
            peakY = midY
            cooldownUntil = now + config.cooldownMs
          }
          break
        }
      }

      return {
        phase,
        aimX: phase === 'back' ? laggedX(now) : null,
        fired,
        firedAimX,
        riseSw: (restY - peakY) / sw,
        dropSw,
        velSw,
      }
    },
  }
}
