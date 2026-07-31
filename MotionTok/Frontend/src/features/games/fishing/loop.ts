/**
 * 게임⑤ 낚시 — 게임 루프 상태머신 (기획 §게임 진행, S15P11A706-10).
 *
 * IDLE(백스윙) → CASTING(찌 비행) → WAITING(깊이 조작 + 입질 대기) → BITE(챔질 QTE)
 *             → FIGHTING(힘겨루기) → RESULT → IDLE
 *
 * ── 공간 모델: 물속 단면도 (2026-07-31 전환) ──
 * x = 앵글러(좌상단 수면 위)로부터의 거리 — **좌우 조준**(aimFromHands)이 결정한다.
 * y = 깊이 — WAITING 중 양손 높이(depth.ts)로 미끼를 올리고 내린다.
 *
 * 이전에는 원근(위=멀리, 아래=가까이)이었다. 단면도 전환 직후엔 스윙 파워가 착수 x를 정했지만
 * 같은 날 조준으로 교체했다 — 파워는 사후 확정이라 예측이 안 되고 사실상 약/강 2대역인 반면,
 * 조준은 연속·정밀하고 던지기 전에 착수점을 미리 보여줄 수 있다(사용자 결정, 2026-07-31).
 * 파워는 착수 연출(물튀김 크기)로만 소비되고, 스윙 낙하 문턱(cast.ts dropMinSw)은 발사
 * 게이트로 살아 있다 — 조준만 하고 팔을 내리는 동작으로는 던져지지 않는다.
 * 어종마다 깊이 층이 달라(bandIndexOf) 노리는 층을 고르는 것이 waiting의 조작이 된다.
 *
 * 렌더링과 입력을 뺀 순수 로직이다 — 캔버스 없이 테스트할 수 있어야 밸런스를 코드로 고정할 수
 * 있다. 데모는 이 전부가 하나의 전역 객체에 렌더와 섞여 있어 판정 하나도 테스트할 수 없었다.
 *
 * 난수는 주입받는다(seed 기반). 멀티플레이에서 "두 플레이어가 동일한 맵 사용"(기획)을 하려면
 * 서버가 내려준 시드로 양쪽이 같은 물고기를 재생해야 하고, 그때 이 구조가 그대로 쓰인다 —
 * 게임④ chainSeed·리듬 battleChart와 같은 패턴이다.
 */
import { createFight, FISH, type FightState, type FishSpec } from './fight'

export type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'fighting' | 'result'

export interface LoopConfig {
  /** 무대 크기(px) — 렌더 캔버스와 같은 좌표계 */
  width: number
  height: number
  /** 수면 y — 이 아래가 물이다 */
  waterY: number
  /** 물고기 수 */
  fishCount: number
  /** 찌 비행 시간(초) */
  castFlightSec: number
  /** 입질 없이 이 시간이 지나면 찌를 회수한다(초) */
  waitTimeoutSec: number
  /** 챔질 유효 창(초) — 기획 §훅킹: 놓치면 물고기가 도망 */
  biteWindowSec: number
  /** 결과 표시 시간(초) */
  resultSec: number
  /** 찌 착수 시 이 거리 안의 물고기가 관심을 보인다(px) */
  interestRadiusPx: number
  /**
   * 관심(curious) 단계 지속 시간(초) — 이 시간이 지나야 접근을 시작한다.
   *
   * 없으면 찌가 물고기 위에 떨어졌을 때 즉시 입질해서 대기가 사라진다(2026-07-29 실기 지적:
   * "대기가 딱히 없는데?"). 데모도 착수와 거의 동시에 입질했다 — 12마리에 매 프레임 확률을
   * 굴렸기 때문. 기획 §입질의 "관심 → 접근 → 입질"은 시간이 흐르는 3단계다.
   */
  curiousSec: number
  /** 물고기가 찌에 이만큼 붙으면 입질(px) */
  biteDistPx: number
  /** 관심을 보인 물고기가 찌로 접근하는 속도(px/s) */
  approachPxS: number
  /** 조준 최좌(0)일 때 착수 x — 앵글러 바로 앞(px) */
  landNearXPx: number
  /** 조준 최우(width)일 때 착수 x — 오른쪽 끝에서 이만큼 안(px) */
  landFarMarginPx: number
  /** 미끼가 오를 수 있는 최소 깊이 — 수면에서 이만큼 아래(px) */
  depthMinMarginPx: number
  /** 미끼가 내려갈 수 있는 최대 깊이 — 화면 아래에서 이만큼 위(px). 모래바닥 위 */
  depthMaxMarginPx: number
  /** 미끼가 목표 깊이로 이동하는 속도(px/s) — 손 지터의 저역통과 역할도 한다 */
  steerPxS: number
}

export const DEFAULT_LOOP: LoopConfig = {
  width: 640,
  height: 480,
  waterY: 120,
  fishCount: 6,
  // 0.45초는 "찌가 너무 빨리 올라가버린다"는 지적을 받았다(2026-07-29). 던진 결과를 눈으로
  // 따라갈 시간이 필요하다 — 포물선이 보이는 게 던지는 체감의 대부분이다.
  castFlightSec: 0.75,
  waitTimeoutSec: 6,
  // 데모는 1.8초였는데 정적 포즈 판정이라 사실상 즉시 성공이었다. 순간 동작(위로 번쩍)이라
  // 반응 시간이 필요하므로 넉넉히 준다 — 짧으면 "뭐가 지나갔는지도 모르게" 놓친다.
  biteWindowSec: 1.5,
  resultSec: 1.8,
  interestRadiusPx: 220,
  biteDistPx: 26,
  approachPxS: 90,
  curiousSec: 0.8,
  landNearXPx: 150,
  landFarMarginPx: 30,
  depthMinMarginPx: 26,
  depthMaxMarginPx: 48,
  steerPxS: 150,
}

/**
 * 어종 깊이 층 — 점수가 높을수록 깊다(흰동가리 얕음 → 상어 깊음).
 *
 * 문턱 25/45/100으로 15종을 4층에 나눈다: 5~20 / 25~40 / 45~70 / 100~120.
 * 가장 깊은 층이 2종뿐인 건 의도다 — 바닥까지 내려가야만 만나는 게 청새치·상어다.
 * 층이 겹치지 않아야 "깊이를 고르는" 조작이 성립한다. 스킨이 층 경계를 그릴 수 있게
 * 여기(로직)가 소유하고 렌더는 소비만 한다.
 */
export const DEPTH_BANDS = 4

/**
 * 층 해제 히스테리시스(px) — 선택된 물고기를 놓아주는 판정에만 쓴다.
 *
 * 층 높이가 약 72px이라 14px은 그 20% 정도다. 미끼를 경계에 두고 손이 떨릴 때
 * 선택↔해제가 뒤집히는 걸 막을 만큼은 크고, 옆 층을 노린 조작을 무효로 만들 만큼 크지는 않다.
 */
const BAND_RELEASE_MARGIN_PX = 14

/**
 * 물고기가 무대 좌우 끝에서 이만큼 안쪽까지만 온다(px).
 *
 * 예전에는 화면 밖으로 나가면 반대쪽으로 순환시켰다(`x < -40` → `width + 40`). 그러면 경계에서
 * 몸이 세로로 잘린 물고기가 보이는데, 스프라이트로 바꾼 뒤로는 그 잘린 단면이 화면 오른쪽에
 * **알록달록한 세로 줄**로 읽혔다(실기 지적 2026-07-31, 2회). 순환 대신 **가장자리에서 방향을
 * 튼다** — 어떤 프레임에도 물고기가 무대 경계에 걸치지 않는다.
 *
 * 값은 가장 큰 스프라이트의 반폭보다 커야 한다: fishRadius 최대 28 → 그린 폭 28×2.6 = 73,
 * 반폭 37. 48이면 여유가 있다.
 */
const EDGE_MARGIN_PX = 48

export function bandIndexOf(spec: FishSpec): number {
  if (spec.score >= 100) return 3
  if (spec.score >= 45) return 2
  if (spec.score >= 25) return 1
  return 0
}

/** i번째 층의 y 범위 — 물기둥(수면 여유 ~ 바닥 여유)을 층 수만큼 등분 */
export function bandYRange(cfg: LoopConfig, i: number): { top: number; bottom: number } {
  const top0 = cfg.waterY + cfg.depthMinMarginPx
  const bottom0 = cfg.height - cfg.depthMaxMarginPx
  const h = (bottom0 - top0) / DEPTH_BANDS
  return { top: top0 + i * h, bottom: top0 + (i + 1) * h }
}

/**
 * 조준 x(캔버스 px, 0~width) → 착수 x.
 *
 * 클램프가 아니라 **선형 리매핑**이다 — 조준 전 구간(0~width)이 착수 전 구간(nearX~farX)에
 * 대응돼야 한다. 클램프로 하면 왼쪽 1/4 조준이 전부 같은 지점(nearX)에 떨어져서, 어제 화면
 * 95%까지 넓혀놓은 조준 범위(normalize.ts AIM_SPAN_SW)의 왼쪽이 죽는다.
 * 스킨의 착수점 미리보기도 이 함수를 써야 예고와 실제 착수가 일치한다.
 */
export function landingXFromAim(cfg: LoopConfig, aimX: number): number {
  const nearX = cfg.landNearXPx
  const farX = cfg.width - cfg.landFarMarginPx
  const t = Math.min(1, Math.max(0, aimX / cfg.width))
  return nearX + t * (farX - nearX)
}

export interface SceneFish {
  id: number
  spec: FishSpec
  x: number
  y: number
  dir: 1 | -1
  speed: number
  /** none: 유영 / curious: 찌를 봤다 / approaching: 다가온다 */
  interest: 'none' | 'curious' | 'approaching'
}

export interface CatchEntry {
  name: string
  score: number
}

export interface LoopState {
  phase: Phase
  /** 찌 — visible이 false면 아직 던지지 않았다 */
  bobber: { x: number; y: number; visible: boolean }
  fishes: SceneFish[]
  /** 입질·힘겨루기 중인 물고기 */
  active: SceneFish | null
  /** 힘겨루기 진행도 0~1 */
  progress: number
  /** 지금 감기고 있는지 — DANGER 연출 조건 */
  reeling: boolean
  /** 시작 유예 중 */
  grace: boolean
  /** BITE 남은 시간(초) — 게이지 연출용 */
  biteLeftSec: number
  /** 마지막 결과 — RESULT 페이즈에 보여준다 */
  last: { name: string; score: number; outcome: FightState | 'missed' } | null
  score: number
  caught: CatchEntry[]
}

export interface Loop {
  state(): LoopState
  /**
   * IDLE에서만 유효.
   * @param aimX 조준 x(캔버스 px, cast.ts의 firedAimX) — landingXFromAim으로 착수 x가 된다.
   *             스윙 파워는 착수에 관여하지 않는다(연출 전용) — 헤더 주석 참고
   */
  cast(aimX: number): boolean
  /**
   * WAITING에서만 유효 — 미끼 목표 깊이 0~1(depth.ts). 미끼는 steerPxS 속도로 따라간다.
   * 다른 페이즈에서는 무시된다(입질·힘겨루기 중 깊이가 움직이면 판정이 흔들린다).
   */
  steer(depth01: number): void
  /** BITE에서만 유효 — 챔질 성공 여부 */
  hook(): boolean
  /** @param reelRate pump.rate (왕복/s) */
  tick(dtSec: number, reelRate: number): void
  reset(): void
}

/** mulberry32 — 시드 하나로 재현 가능한 난수. 서버 시드를 그대로 넣을 수 있다 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 어종 추첨 — 큰 물고기가 드물다. 기획 §희귀도.
 * 점수가 높을수록 확률이 낮아지도록 역가중을 준다.
 */
function pickSpec(rnd: () => number): FishSpec {
  const weights = FISH.map((f) => 1 / f.score)
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rnd() * total
  for (let i = 0; i < FISH.length; i++) {
    r -= weights[i]!
    if (r <= 0) return FISH[i]!
  }
  return FISH[0]!
}

export function createLoop(config: LoopConfig = DEFAULT_LOOP, seed = 1): Loop {
  let rnd = seededRng(seed)
  const fight = createFight(FISH[0]!)

  let phase: Phase = 'idle'
  let bobber = { x: config.width / 2, y: config.waterY, visible: false }
  let castFrom = { x: 0, y: 0 }
  let castTo = { x: 0, y: 0 }
  let castT = 0
  let waitT = 0
  /** 관심을 준 뒤 흐른 시간 — curiousSec 판정 기준. waitT가 아니라 선택 시점부터 센다 */
  let curiousT = 0
  /** WAITING 중 미끼 목표 y — steer가 갱신하고 tick이 따라간다 */
  let steerY = 0
  let biteT = 0
  let resultT = 0
  let active: SceneFish | null = null
  let last: LoopState['last'] = null
  let score = 0
  let caught: CatchEntry[] = []
  let fishes: SceneFish[] = []
  let nextId = 1
  let progress = 0
  let reeling = false
  let grace = false

  function spawnFish(atEdge: boolean): SceneFish {
    const dir: 1 | -1 = rnd() < 0.5 ? 1 : -1
    const spec = pickSpec(rnd)
    // 어종의 깊이 층 안에서만 스폰한다 — 층이 섞이면 깊이를 고르는 조작이 무의미해진다
    const band = bandYRange(config, bandIndexOf(spec))
    return {
      id: nextId++,
      spec,
      // 화면 밖에서 들어오게 두면 등장 순간 경계에 걸쳐 잘린다 — 안쪽 여백에서 시작한다
      x: atEdge
        ? dir > 0
          ? EDGE_MARGIN_PX
          : config.width - EDGE_MARGIN_PX
        : EDGE_MARGIN_PX + rnd() * Math.max(1, config.width - EDGE_MARGIN_PX * 2),
      y: band.top + rnd() * (band.bottom - band.top),
      dir,
      // 큰 물고기가 느리다 — 요구 속도로 크기를 대신 표현한다
      speed: 26 + (1 - spec.requiredRate) * 40,
      interest: 'none',
    }
  }

  function initFishes() {
    fishes = Array.from({ length: config.fishCount }, () => spawnFish(false))
  }

  /**
   * 미끼가 이 물고기의 깊이 층 안에 있나.
   *
   * 선택·해제의 유일한 기준이다. 거리(interestRadiusPx)는 "가까운 것부터"를 고르는 데만 쓰고
   * 층 조건이 자격을 정한다 — 반경 220px이 층 높이 약 72px의 3배라, 거리만 보면 노린 층이
   * 아닌 물고기가 먼저 걸린다.
   *
   * @param margin 히스테리시스(px). 해제 판정에만 준다 — 경계에 미끼를 두면 선택↔해제가
   *               매 프레임 뒤집혀 물고기가 다가오다 멈추는 걸 반복한다.
   */
  function inBobberBand(f: SceneFish, margin = 0): boolean {
    const { top, bottom } = bandYRange(config, bandIndexOf(f.spec))
    return bobber.y >= top - margin && bobber.y <= bottom + margin
  }

  function releaseActive() {
    if (active) active.interest = 'none'
    active = null
  }

  function toIdle() {
    phase = 'idle'
    bobber.visible = false
    releaseActive()
    progress = 0
    reeling = false
    grace = false
  }

  initFishes()

  return {
    state: () => ({
      phase,
      bobber: { ...bobber },
      fishes,
      active,
      progress,
      reeling,
      grace,
      biteLeftSec: Math.max(0, config.biteWindowSec - biteT),
      last,
      score,
      caught,
    }),

    reset() {
      rnd = seededRng(seed)
      nextId = 1
      score = 0
      caught = []
      last = null
      initFishes()
      toIdle()
    },

    cast(aimX) {
      if (phase !== 'idle') return false
      // 단면도: 오른쪽으로 조준할수록 **멀리** 떨어진다. 앵글러가 좌상단 수면 위에 있다.
      // 낚싯대 끝 근처에서 출발 — 렌더의 rodTip과 정확히 일치할 필요는 없다(줄은 스킨이 긋는다)
      castFrom = { x: config.width * 0.27, y: config.waterY * 0.5 }
      castTo = { x: landingXFromAim(config, aimX), y: config.waterY + config.depthMinMarginPx }
      castT = 0
      bobber = { ...castFrom, visible: true }
      phase = 'casting'
      return true
    },

    steer(depth01) {
      if (phase !== 'waiting') return
      const top = config.waterY + config.depthMinMarginPx
      const bottom = config.height - config.depthMaxMarginPx
      const d = Math.min(1, Math.max(0, depth01))
      steerY = top + d * (bottom - top)
    },

    hook() {
      if (phase !== 'bite' || !active) return false
      phase = 'fighting'
      fight.reset(active.spec)
      progress = 0
      return true
    },

    tick(dtSec, reelRate) {
      // 물고기 유영 — 입질·힘겨루기 중인 개체는 찌에 붙어 있다
      for (const f of fishes) {
        if (f === active && (phase === 'bite' || phase === 'fighting')) {
          f.x += (bobber.x - f.x) * 0.15
          f.y += (bobber.y - f.y) * 0.15
          continue
        }
        if (f.interest === 'curious') {
          // 찌를 봤지만 아직 안 문다 — 속도를 줄여 서성인다. 이 구간이 대기의 긴장감이다
          f.x += f.dir * f.speed * 0.25 * dtSec
          continue
        }
        if (f.interest === 'approaching') {
          const dx = bobber.x - f.x
          const dy = bobber.y - f.y
          const d = Math.hypot(dx, dy) || 1
          f.x += (dx / d) * config.approachPxS * dtSec
          f.y += (dy / d) * config.approachPxS * dtSec
          f.dir = dx >= 0 ? 1 : -1
          continue
        }
        f.x += f.dir * f.speed * dtSec
        // 가장자리에서 방향을 튼다 — 경계에 걸쳐 잘린 물고기가 안 생긴다(EDGE_MARGIN_PX 주석)
        if (f.x < EDGE_MARGIN_PX) {
          f.x = EDGE_MARGIN_PX
          f.dir = 1
        } else if (f.x > config.width - EDGE_MARGIN_PX) {
          f.x = config.width - EDGE_MARGIN_PX
          f.dir = -1
        }
      }

      switch (phase) {
        case 'casting': {
          castT += dtSec
          const p = Math.min(1, castT / config.castFlightSec)
          bobber.x = castFrom.x + (castTo.x - castFrom.x) * p
          // 포물선 — 던지는 체감의 대부분이 이 곡선에서 나온다
          bobber.y = castFrom.y + (castTo.y - castFrom.y) * p - Math.sin(p * Math.PI) * 70
          if (p >= 1) {
            bobber = { ...castTo, visible: true }
            phase = 'waiting'
            waitT = 0
            // 물고기 선택은 WAITING의 매 틱에서 한다 — 착수 후 깊이를 조작해 노리는 층을
            // 바꿀 수 있으므로 착수 순간 한 번의 선택으로는 조작이 반영되지 않는다.
            steerY = castTo.y
          }
          break
        }

        case 'waiting': {
          waitT += dtSec

          // 깊이 조작 — 목표 깊이로 유한 속도로 이동. steer 입력의 지터도 여기서 걸러진다
          const dy = steerY - bobber.y
          const step = config.steerPxS * dtSec
          bobber.y += Math.abs(dy) <= step ? dy : Math.sign(dy) * step

          if (!active) {
            // 미끼 근처 + **미끼와 같은 깊이 층**의 물고기가 관심을 보인다 (기획: 관심 → 접근 → 입질).
            // 층 조건이 없으면 조작이 성립하지 않는다 — interestRadiusPx(220)가 층 높이(약 72px)의
            // 3배라, 상어를 노리고 바닥까지 내려도 두 층 위의 멸치가 먼저 선택됐다.
            const near = fishes
              .filter(
                (f) =>
                  inBobberBand(f) &&
                  Math.hypot(f.x - bobber.x, f.y - bobber.y) <= config.interestRadiusPx,
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - bobber.x, a.y - bobber.y) -
                  Math.hypot(b.x - bobber.x, b.y - bobber.y),
              )
            const chosen = near[0]
            if (chosen) {
              // 먼저 '관심' — curiousSec이 지난 뒤에야 접근을 시작한다(기획 §입질 3단계)
              chosen.interest = 'curious'
              active = chosen
              curiousT = 0
            }
          } else {
            curiousT += dtSec
            // 미끼를 그 물고기의 층 밖으로 옮기면 흥미를 잃는다 — 이게 "다른 물고기를 노린다"의
            // 조작이다. 거리로만 판정하면 안 된다: approaching 물고기는 approachPxS로 미끼를
            // 쫓아오므로 거리가 좁혀져 반경을 벗어나는 일이 거의 없고, 바닥까지 따라 내려온다
            // (실기 지적 2026-07-31: "상어를 노렸는데 딴 물고기가 끝까지 따라옴").
            if (!inBobberBand(active, BAND_RELEASE_MARGIN_PX)) {
              releaseActive()
            } else if (active.interest === 'curious' && curiousT >= config.curiousSec) {
              // 관심 → 접근 전환. 이 지연이 없으면 미끼가 물고기 옆에 가는 즉시 입질한다.
              active.interest = 'approaching'
            }
          }

          const arrived =
            active !== null &&
            active.interest === 'approaching' &&
            Math.hypot(active.x - bobber.x, active.y - bobber.y) <= config.biteDistPx
          if (arrived) {
            phase = 'bite'
            biteT = 0
          } else if (waitT >= config.waitTimeoutSec) {
            toIdle()
          }
          break
        }

        case 'bite': {
          biteT += dtSec
          if (biteT >= config.biteWindowSec) {
            // 놓쳤다 — 기획: 실패하면 물고기가 도망간다
            last = { name: active?.spec.name ?? '', score: 0, outcome: 'missed' }
            phase = 'result'
            resultT = 0
            bobber.visible = false
            releaseActive()
          }
          break
        }

        case 'fighting': {
          const s = fight.step(reelRate, dtSec)
          progress = s.progress
          reeling = s.reeling
          grace = s.grace
          if (s.state !== 'fighting') {
            const spec = fight.fish()
            const won = s.state === 'caught'
            if (won) {
              score += spec.score
              caught = [...caught, { name: spec.name, score: spec.score }]
            }
            last = { name: spec.name, score: won ? spec.score : 0, outcome: s.state }
            phase = 'result'
            resultT = 0
            bobber.visible = false
            // 잡힌 물고기는 사라지고 새 물고기가 들어온다
            if (won && active) {
              const i = fishes.indexOf(active)
              if (i >= 0) fishes[i] = spawnFish(true)
            }
            releaseActive()
          }
          break
        }

        case 'result': {
          resultT += dtSec
          if (resultT >= config.resultSec) {
            last = null
            toIdle()
          }
          break
        }
      }
    },
  }
}
