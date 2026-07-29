/**
 * 게임⑤ 낚시 — 캐스팅 판정 (기획 §낚싯대 던지기, S15P11A706-10).
 *
 * 기획: "낚싯대를 뒤로 젖혔다가 앞으로 던지는 모션."
 *
 * ── 왜 이 형태인가 ──
 * "앞으로 던지기"는 카메라 축(z) 방향이라 2D에 거의 안 찍힌다. 릴 감기에서 겪은 투영 문제와
 * 같은 함정이다. 그래서 z를 쓰지 않고 화면에서 크게 움직이는 성분만으로 2단을 구성한다:
 *
 *   1단 젖힘  — 손목이 어깨보다 위로 올라가 잠시 머문다
 *   2단 릴리즈 — 손목이 빠르게, 그리고 **충분한 거리를** 아래로 내려간다
 *
 * ── 2026-07-29 실기에서 고친 것 3개 ──
 * ① **최소 낙하 거리**: 속도 문턱(700px/s)만 걸었더니 80ms 창에서 56px만 움직여도 발사됐다.
 *    손을 어깨 근처에 두고 있으면 저절로 던져졌다. 거리 조건을 AND로 추가한다.
 * ② **조준이 손을 따라간다**: 조준을 젖힌 순간에 고정했더니, 손 드는 위치가 늘 몸 앞이라
 *    값이 거의 안 변해 "던지는 대로 안 던져지는 느낌"이 됐다. armed 동안 계속 갱신하되,
 *    내려꽂는 동안의 흔들림이 섞이지 않게 살짝 지연된 값을 쓴다(데모는 발사 순간 x를 그대로
 *    써서 조준이 아예 작동하지 않았다).
 * ③ **거리는 스윙 최고 속도로 정한다**: 젖힌 높이(파워 낮추려면 손을 내려야 하고 그게 발사
 *    동작이라 가까이 못 던짐)와 젖힌 시간(게이지를 읽어야 해서 체감 나쁨)을 거쳤다.
 *
 *    처음에 속도 방식을 접은 이유는 "범위가 512~848(1.7배)뿐"이었는데, **그건 측정 오류였다.**
 *    문턱을 넘는 순간 발사하니 스윙의 **상승 구간**을 재고 있었고, 그래서 세게 던져도 약하게
 *    던져도 측정값이 문턱 근처로 눌렸다. 최고 속도는 그 뒤에 온다.
 *
 *    그래서 문턱을 넘으면 곧바로 쏘지 않고 releasePeakMs 동안 스윙을 지켜본 뒤 **그 구간의
 *    최고 속도**로 거리를 정한다. 지연은 스윙 중이라 체감되지 않고, "손이 다 내려간 뒤 찌가
 *    날아간다"는 그림과도 맞는다. 미리보기 게이지는 없다 — 실제 던지기처럼 손끝으로 익힌다.
 */

export interface CastConfig {
  /** 손목이 어깨보다 이만큼(px) 위로 올라가야 젖힘으로 인정 */
  raiseMarginPx: number
  /**
   * 젖힘을 푸는 문턱 — 어깨보다 이만큼 위까지 내려와야 idle로 돌아간다.
   * raiseMarginPx와 같게 두면 경계에서 idle↔raising이 떨린다.
   */
  releaseMarginPx: number
  /** 젖힘 자세를 이 시간(ms) 이상 유지해야 조준이 잠긴다 */
  holdMs: number
  /** 이 하향 속도(px/s)를 넘어야 릴리즈 — 거리 조건과 AND다 */
  releaseVelPxS: number
  /**
   * 젖힘 최고점에서 이만큼(px) 내려와야 릴리즈. 속도만 보면 작은 흔들림에 발사된다
   * (2026-07-29: 어깨 근처에 손을 두면 저절로 던져졌다).
   */
  minDropPx: number
  /** 젖힘 후 이 시간(ms) 안에 던지지 않으면 조준을 다시 잠근다(갱신) */
  timeoutMs: number
  /** 속도 계산 창(ms) */
  velWindowMs: number
  /** 조준 x를 몇 ms 전 값으로 쓸지 — 내려꽂는 동안의 흔들림 배제 */
  aimLagMs: number
  /**
   * 문턱을 넘은 뒤 스윙 최고 속도를 찾는 관찰 시간(ms).
   * 이 시간이 지나거나 속도가 최고치의 절반 아래로 떨어지면 발사한다.
   */
  releasePeakMs: number
  /** 거리 1.0(가장 멀리)에 해당하는 최고 하향 속도(px/s) */
  fullPowerVelPxS: number
}

export const DEFAULT_CAST: CastConfig = {
  raiseMarginPx: 30,
  releaseMarginPx: 8,
  holdMs: 180,
  releaseVelPxS: 700,
  // 화면 높이 480 기준 약 1/4. 이보다 작으면 "손을 툭 내리는" 동작과 구분되지 않는다
  minDropPx: 110,
  timeoutMs: 2500,
  velWindowMs: 80,
  aimLagMs: 150,
  // 30fps에서 약 4프레임 — 스윙의 피크를 담기에 충분하고 체감 지연은 없다
  releasePeakMs: 130,
  // 문턱 700에서 시작해 1900이면 최대. 실측 캐주얼 스윙이 848이었으니 세게 던지면 닿는다
  fullPowerVelPxS: 1900,
}

export type CastPhase = 'idle' | 'raising' | 'armed' | 'releasing'

export interface CastSample {
  phase: CastPhase
  /** armed 동안의 조준 x(캔버스 px, 손을 따라 움직인다). 그 외 null */
  aimX: number | null
  /** 이 프레임에 발사됐으면 거리 0~1(가까이~멀리), 아니면 null */
  fired: number | null
  /** 발사 시 쓰인 조준 x — fired가 null이 아닐 때만 유효 */
  firedAimX: number
  /** 현재 하향 속도(px/s) — 랩 표시용 */
  downVelPxS: number
  /** 젖힘 최고점에서 내려온 거리(px) — 랩 표시용 */
  dropPx: number
}

export interface Cast {
  /**
   * @param wristY 손목 y (캔버스 px, 아래로 갈수록 증가)
   * @param wristX 손목 x (캔버스 px)
   * @param shoulderY 같은 쪽 어깨 y (캔버스 px)
   */
  feed(wristX: number, wristY: number, shoulderY: number, now: number): CastSample
  reset(): void
}

export function createCast(config: CastConfig = DEFAULT_CAST): Cast {
  let phase: CastPhase = 'idle'
  let raisedAt = 0
  let armedAt = 0
  /** 젖힘 구간의 최고점(y 최솟값) — 낙하 거리의 기준 */
  let peakY = Infinity
  /** releasing 진입 시각 */
  let releaseAt = 0
  /** releasing 동안 관측한 최고 하향 속도 — 거리의 근거 */
  let peakVel = 0
  /** releasing 진입 시점에 잠근 조준 x — 스윙 중 흔들림이 섞이지 않게 미리 확정한다 */
  let lockedAimX = 0
  let hist: { x: number; y: number; t: number }[] = []

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

  function toIdle() {
    phase = 'idle'
    peakY = Infinity
  }

  return {
    reset() {
      toIdle()
      hist = []
    },

    feed(wristX, wristY, shoulderY, now) {
      hist.push({ x: wristX, y: wristY, t: now })
      while (hist.length && now - hist[0]!.t > Math.max(config.velWindowMs * 3, config.aimLagMs * 2))
        hist.shift()

      const rise = shoulderY - wristY
      const vel = downVel(now)
      let fired: number | null = null
      let firedAimX = 0

      // 히스테리시스 — 올라갈 때와 내려올 때 문턱을 다르게 둬 경계 떨림을 막는다
      const raisedEnough = rise >= config.raiseMarginPx
      const stillUp = rise >= config.releaseMarginPx

      if (phase !== 'idle' && wristY < peakY) peakY = wristY
      const drop = phase === 'idle' ? 0 : wristY - peakY

      switch (phase) {
        case 'idle':
          if (raisedEnough) {
            phase = 'raising'
            raisedAt = now
            peakY = wristY
          }
          break

        case 'raising':
          if (!stillUp) toIdle()
          else if (now - raisedAt >= config.holdMs) {
            phase = 'armed'
            armedAt = now
          }
          break

        case 'armed':
          // 속도 AND 거리 — 둘 다 넘으면 스윙 관찰(releasing)로 넘어간다.
          // 여기서 바로 쏘면 스윙의 상승 구간 속도를 재게 되어 세기 구분이 사라진다.
          if (vel >= config.releaseVelPxS && drop >= config.minDropPx) {
            phase = 'releasing'
            releaseAt = now
            peakVel = vel
            lockedAimX = laggedX(now)
          } else if (!stillUp && vel < config.releaseVelPxS * 0.5) {
            // 손을 **천천히** 내려 어깨 아래로 갔다 — 던진 게 아니라 그만둔 것.
            //
            // 속도 조건이 붙는 이유: 낮게 젖히면(어깨 위 35px) 필요 낙하 거리(110px)를 채우기
            // 전에 손이 어깨선을 지나므로, 속도를 안 보면 스윙 도중에 취소가 먼저 발동해
            // 영원히 발사되지 않는다. 스윙이 끝나 속도가 떨어지면 여기서 정리된다.
            toIdle()
          } else if (now - armedAt > config.timeoutMs) {
            // 낙하 기준점만 현재 위치로 당긴다 — 손을 든 채 오래 조준해도 이전 최고점 때문에
            // 낙하 거리가 미리 채워져 있어 오발하는 걸 막는다. 파워(차징)는 유지한다.
            armedAt = now
            peakY = wristY
          }
          break

        case 'releasing': {
          // 스윙이 끝날 때까지 최고 속도를 갱신한다 — 이게 던지는 세기다
          if (vel > peakVel) peakVel = vel
          const decayed = vel < peakVel * 0.5
          if (now - releaseAt >= config.releasePeakMs || decayed) {
            const span = config.fullPowerVelPxS - config.releaseVelPxS
            fired = Math.min(1, Math.max(0, (peakVel - config.releaseVelPxS) / span))
            firedAimX = lockedAimX
            toIdle()
          }
          break
        }
      }

      return {
        phase,
        aimX: phase === 'armed' ? laggedX(now) : null,
        fired,
        firedAimX,
        downVelPxS: vel,
        dropPx: drop,
      }
    },
  }
}
