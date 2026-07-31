/**
 * 게임⑤ 낚시 — 릴 감기 판정 (S15P11A706-10).
 *
 * 화면에 그려둔 원형 궤도 위를 손이 한 방향으로 도는지 세는 섹터 전이 판정기.
 *
 * ── 왜 "화면에 궤도를 그리는" 방식인가 ──
 * 웹캠 1대로 "임의 위치의 원운동"을 재는 건 원리적으로 안 된다. 실제 릴 크랭크의 회전면은
 * 몸 방향에 따라 기울어 화면에서 타원~직선으로 납작해지고, 그러면 반경 검증이 정상 플레이를
 * 탈락시킨다. 반대로 검증을 풀면 손을 좌우로 흔들기만 해도 통과한다 — 데모 구현이 이 함정에
 * 빠져 있었다(각도 변화를 절댓값으로 누적해 회전 방향을 전혀 안 봤다).
 *
 * 그래서 궤도를 우리가 화면에 그려 **회전면 = 이미지 평면**으로 고정한다. 반경을 아는 순간
 * 방향·반경을 동시에 검증할 수 있고, "링 밖은 무효"가 유저 눈에 보이는 규칙이 된다.
 * 2011년 Rapala for Kinect가 카메라 단독에서 회전 판정을 포기하고 이산 프롬프트(때리기·
 * 포즈 유지)로 간 이유가 이 문제이고, 현역 웹캠 게임에도 회전 판정 사례가 없다.
 *
 * ── 좌표계 ──
 * 호출부의 **캔버스 픽셀 좌표**를 그대로 쓴다. 정규화 좌표(0~1)는 축마다 스케일이 달라
 * 원이 타원으로 찌그러지므로, 종횡비 보정을 호출부에 떠넘기지 않고 픽셀로 통일했다.
 */

export interface ReelConfig {
  /** 궤도 분할 수 */
  sectors: number
  /** 링 두께 — 반경 오차 허용 비율. 0.45면 R의 ±45% 안쪽이면 궤도 위로 본다 */
  band: number
  /** rate 측정 창(ms). 짧으면 반응이 빠르고 튀며, 길면 안정적이고 둔하다 */
  windowMs: number
  /**
   * 한 프레임에 허용하는 섹터 점프 수. 프레임 드롭이나 빠른 회전으로 섹터를 건너뛰어도
   * 그만큼 세어준다 — 1로 두면 "빨리 돌릴수록 안 감기는" 최악의 체감이 된다.
   * 이보다 크게 튀면 랜드마크 순간이동으로 보고 버린다.
   *
   * 검출 상한 = maxStep × fps ÷ sectors. 30fps·8섹터·maxStep 2 → 7.5 rev/s.
   * 프레임당 sectors/2를 넘으면 랩어라운드가 방향을 반대로 읽지만(30fps·8섹터 → 15 rev/s)
   * 사람이 낼 수 없는 속도다.
   */
  maxStep: number
  /**
   * rate를 인정하기 시작하는 최소 연속 전이 수. 랜드마크 지터로 섹터 경계에서
   * 깜빡이는 것과 실제 회전을 가른다.
   */
  minRun: number
  /**
   * 방향이 뒤집혔다고 인정하는 최소 연속 역방향 전이 수.
   *
   * 1이면 역방향 한 프레임에 진행도를 전부 버린다 — 랜드마크 지터나 궤도 추종으로 섹터
   * 경계에서 한 칸 되돌아가는 일이 흔해서, 7바퀴 쌓은 게 한 번에 날아갔다(2026-07-29 실기:
   * 자동 추적에서 효율 53%, 연속이 2에서 계속 끊김). 2 이상이면 순간 지터는 무시하고
   * 실제 역회전만 잡는다 — 좌우 왕복은 반전이 지속되므로 여전히 차단된다.
   */
  flipTolerance: number
}

/** 초기값 — 전부 /dev/fishing-lab 슬라이더로 실측해 확정할 대상이다 */
export const DEFAULT_REEL: ReelConfig = {
  sectors: 8,
  band: 0.45,
  windowMs: 700,
  maxStep: 2,
  minRun: 3,
  flipTolerance: 2,
}

export interface ReelSample {
  /** 최근 windowMs 기준 회전 속도(rev/s). 감김/회복(힘겨루기) 판정의 입력 */
  rate: number
  /** reset 이후 누적 회전수(소수 포함). 어종별 "N회 감기" 진행도의 입력 */
  revs: number
  /** 손이 링 위에 있는지 — "궤도를 벗어났어요" 피드백용 */
  onTrack: boolean
}

/** 랩 표시용 내부 상태 — 게임 로직은 쓰지 않는다 */
export interface ReelDebug {
  /** 인정 중인 회전 방향(+1 / -1 / 0 미정) */
  dir: number
  /** 현재 방향으로 이어진 전이 수 */
  runLen: number
  /** 이번 바퀴에서 지나온 섹터 수 */
  progress: number
  /** 완주한 바퀴 수 */
  laps: number
  /** 마지막으로 인식된 섹터 (-1 = 끊김) */
  sector: number
}

export interface Reel {
  /** 손 위치(캔버스 px)를 먹이고 현재 상태를 돌려준다. now는 ms(단조 증가) */
  feed(x: number, y: number, now: number): ReelSample
  /**
   * 궤도 교체 — 어종이 바뀌는 등 **불연속** 변경. 섹터 기준을 끊어 각도 점프를 막는다.
   * 매 프레임 호출하면 기준이 영구히 끊겨 아무것도 세지 않으므로 연속 추적에는 쓰지 마라.
   */
  moveTrack(cx: number, cy: number, rx: number, ry: number): void
  /**
   * 궤도 미세 추종 — loopFit이 매 프레임 갱신하는 **연속** 변경. 섹터 기준(위상)을 유지한다.
   * 피팅이 조금씩 움직이면서 섹터가 1칸 튈 수 있는데, 그건 maxStep 안이라 정상 카운트된다.
   */
  followTrack(cx: number, cy: number, rx: number, ry: number): void
  /** 새 물고기 — 누적 회전수와 방향을 버린다 */
  reset(): void
  debug(): ReelDebug
}

const TAU = Math.PI * 2

/**
 * @param rx 궤도 가로 반경(px)
 * @param ry 궤도 세로 반경(px). rx === ry면 원.
 *
 * 타원을 받는 이유 — 실제 릴 크랭크 회전면은 카메라 정면이 아니라 비스듬하게 서 있어서
 * 화면에는 **세로로 납작한 타원**으로 찍힌다(2026-07-29 실기 확인). 원으로 판정하면 손이
 * 좌우 극점을 지날 때 반경이 밴드 밖으로 떨어져 연속이 끊기고 진행도가 매번 리셋된다
 * — "평면으로 크게 돌리면 되는데 실제 릴처럼 돌리면 안 된다"의 원인이 이것이었다.
 *
 * 판정은 축을 정규화한 공간(rx, ry로 나눈 좌표)에서 하므로 원은 종횡비 1의 특수 케이스다.
 */
export function createReel(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  config: ReelConfig = DEFAULT_REEL,
): Reel {
  let lastSector = -1
  let dir = 0
  let runLen = 0
  let progress = 0
  let laps = 0
  let ticks: number[] = []
  /** 연속 역방향 전이 누적 — flipTolerance에 도달하면 진짜 역회전으로 본다 */
  let against = 0

  function rateAt(now: number): number {
    ticks = ticks.filter((t) => now - t <= config.windowMs)
    return ticks.length / config.sectors / (config.windowMs / 1000)
  }

  return {
    moveTrack(ncx, ncy, nrx, nry) {
      cx = ncx
      cy = ncy
      rx = nrx
      ry = nry
      lastSector = -1
    },

    followTrack(ncx, ncy, nrx, nry) {
      cx = ncx
      cy = ncy
      rx = nrx
      ry = nry
    },

    reset() {
      lastSector = -1
      dir = 0
      runLen = 0
      progress = 0
      laps = 0
      ticks = []
      against = 0
    },

    debug() {
      return { dir, runLen, progress, laps, sector: lastSector }
    },

    feed(x, y, now) {
      // 축 정규화 — 타원을 단위원으로 펴서 판정한다. 이 공간에서는 궤도 위가 곧 반경 1이라
      // 밴드 검사와 각도 계산이 원·타원 모두에서 똑같이 성립한다.
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      const onTrack = Math.abs(Math.hypot(nx, ny) - 1) <= config.band

      // 링을 벗어나면 전이를 끊는다 — 밖으로 나갔다 들어오며 각도가 튀는 걸 막는다.
      // dir은 남겨둔다(잠깐 벗어난 것으로 방향을 공짜로 뒤집지 못하게).
      if (!onTrack) {
        lastSector = -1
        return { rate: rateAt(now), revs: laps + progress / config.sectors, onTrack: false }
      }

      const sector = Math.floor((((Math.atan2(ny, nx) % TAU) + TAU) % TAU) / (TAU / config.sectors))

      if (lastSector >= 0 && sector !== lastSector) {
        let step = sector - lastSector
        const half = config.sectors / 2
        if (step > half) step -= config.sectors
        else if (step < -half) step += config.sectors

        const mag = Math.abs(step)
        if (mag >= 1 && mag <= config.maxStep) {
          const d = Math.sign(step)
          if (dir !== 0 && d !== dir) {
            // 역방향 전이 — 바로 버리지 않고 연속으로 몇 번 오는지 센다. 한두 프레임짜리
            // 되돌아감은 지터(또는 궤도 추종으로 중심이 움직인 탓)라 무시한다.
            against += mag
            if (against < config.flipTolerance) {
              lastSector = sector
              return { rate: rateAt(now), revs: laps + progress / config.sectors, onTrack: true }
            }
            // 진짜 역회전 — 이번 바퀴를 버리고 새 방향으로 다시 시작한다. 좌우 왕복은
            // 반전이 지속되므로 여기로 떨어져 한 바퀴를 못 채운다(치팅 차단).
            dir = d
            runLen = 0
            progress = 0
            ticks = []
            against = 0
          } else {
            if (dir === 0) dir = d
            against = 0
          }
          runLen += mag
          progress += mag
          // ponytail: rate는 큰 폭(궤도 3/4 왕복) 흔들기로 일부 올릴 수 있다. 그래도 방향이
          //   뒤집히는 순간 progress가 0으로 돌아가 revs는 절대 안 오르므로 물고기는 안 잡힌다.
          //   rate까지 막으려면 "직전 바퀴 완주"를 조건에 넣어야 하는데, 그러면 첫 바퀴 동안
          //   힘겨루기 게이지가 안 움직인다 — 그쪽이 더 나쁜 체감이다.
          if (runLen >= config.minRun) {
            for (let i = 0; i < mag; i++) ticks.push(now)
          }
          while (progress >= config.sectors) {
            progress -= config.sectors
            laps += 1
          }
        }
        // mag > maxStep = 랜드마크 순간이동/큰 프레임 드롭 → 버리고 기준만 옮긴다
      }
      lastSector = sector

      return { rate: rateAt(now), revs: laps + progress / config.sectors, onTrack: true }
    },
  }
}
