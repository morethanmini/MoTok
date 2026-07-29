/**
 * 게임⑤ 낚시 — 손이 그리는 루프를 실시간으로 찾아내는 타원 피터 (S15P11A706-10).
 *
 * 왜 이게 필요한가 — 릴 판정(reel.ts)은 궤도(중심·장단축)를 알아야 한다. 처음에는 궤도를
 * 화면에 그려놓고 유저가 그 위를 따라 돌게 했는데, 실기에서 답답했다. 회전면을 고정하는
 * 방법이 "유저를 궤도에 맞추기"만 있는 게 아니다 — **궤도를 유저에게 맞추면** 결과는
 * 같고(회전면이 정해진다) 부담을 유저가 아니라 우리가 진다.
 *
 * 2026-07-29 실기: 궤적에 궤도를 맞췄을 때 전이 41개가 전부 인정되어 누적 회전이 정확히
 * 1:1로 올랐다(연속 41 ÷ 8섹터 = 5.125 = 누적 5.13). 그 한 번의 맞춤을 매 프레임 하는 것이
 * 이 모듈이다.
 *
 * 치팅 방어는 여기가 아니라 reel.ts의 "방향 뒤집히면 진행도 0"이 담당한다. 피팅이 궤적을
 * 따라가도 좌우 왕복은 방향이 계속 반전돼 한 바퀴를 못 채운다. 여기서는 회전이 아닌 것
 * (정지·직선 왕복)만 퇴화 조건으로 걸러 reel에 아예 넘기지 않는다.
 */

export interface LoopFitConfig {
  /** 피팅에 쓰는 궤적 길이(ms). 짧으면 민첩하고 튀며, 길면 안정적이고 변화에 둔하다 */
  windowMs: number
  /** 이상치 절단 백분위(0~0.5). 손을 올리거나 내리는 구간이 장축을 부풀리는 걸 막는다 */
  trim: number
  /** 이 프레임 수 미만이면 아직 판단하지 않는다 (30fps에서 12프레임 ≈ 0.4초) */
  minSamples: number
  /** 장축 반경(px)이 이보다 작으면 "정지"로 본다 — 회전이 아니다 */
  minMajorPx: number
  /**
   * 단축÷장축이 이보다 작으면 직선 왕복으로 본다. 실측 크랭크 종횡비가 0.55였으므로
   * 0.18은 넉넉한 하한이다 — 아주 비스듬한 크랭크는 통과, 순수 직선은 거부.
   */
  minAspect: number
  /**
   * 궤도 저역통과 계수(0~1). 1이면 매 프레임 원값을 그대로 쓴다.
   *
   * 루프는 준정적이라 30Hz로 흔들릴 이유가 없는데, 슬라이딩 윈도 때문에 중심·반경이
   * 매 프레임 조금씩 움직인다. 그 움직임이 손의 각도에 노이즈로 들어가 섹터 경계에서
   * 역방향 전이를 만들었다(2026-07-29 실기: 자동 추적 효율 53%). 천천히 따라가게 눌러
   * 노이즈를 없앤다 — 사람이 루프를 옮기는 속도에는 충분히 따라붙는다.
   */
  smooth: number
}

export const DEFAULT_LOOP_FIT: LoopFitConfig = {
  windowMs: 1500,
  trim: 0.05,
  minSamples: 12,
  minMajorPx: 22,
  minAspect: 0.18,
  // 0.12는 너무 느렸다 — 실기 10바퀴에 6.38(64%)만 인정됐고, 시뮬레이션에서도 필터를 약하게
  // 할수록 효율이 올라갔다(0.12→91%, 0.3→94%, 무필터→95%). 지터는 reel의 flipTolerance가
  // 잡아주므로 여기서 세게 누를 이유가 없다. /dev/fishing-lab 슬라이더로 실기 확정할 값.
  smooth: 0.35,
}

/** 찾아낸 루프 — reel.moveTrack에 그대로 넘긴다 */
export interface Loop {
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface LoopFitter {
  /** 손 위치(캔버스 px)를 넣고 현재 루프를 돌려준다. null = 아직 회전으로 볼 수 없음 */
  push(x: number, y: number, now: number): Loop | null
  /** 마지막으로 성공한 피팅 (표시용) */
  current(): Loop | null
  /** 왜 null인지 — 랩·게임 안내 문구용 */
  reason(): 'ok' | 'few' | 'still' | 'line'
  reset(): void
}

/** 백분위로 양끝을 자른 구간 — 중앙과 반폭 */
function trimmedSpan(vals: number[], trim: number): { mid: number; half: number } {
  const s = [...vals].sort((a, b) => a - b)
  const lo = s[Math.floor(s.length * trim)]!
  const hi = s[Math.min(s.length - 1, Math.floor(s.length * (1 - trim)))]!
  return { mid: (lo + hi) / 2, half: (hi - lo) / 2 }
}

export function createLoopFitter(config: LoopFitConfig = DEFAULT_LOOP_FIT): LoopFitter {
  let hist: { x: number; y: number; t: number }[] = []
  let last: Loop | null = null
  let why: 'ok' | 'few' | 'still' | 'line' = 'few'

  return {
    current: () => last,
    reason: () => why,

    reset() {
      hist = []
      last = null
      why = 'few'
    },

    push(x, y, now) {
      hist.push({ x, y, t: now })
      while (hist.length && now - hist[0]!.t > config.windowMs) hist.shift()

      if (hist.length < config.minSamples) {
        why = 'few'
        return null
      }

      const sx = trimmedSpan(
        hist.map((p) => p.x),
        config.trim,
      )
      const sy = trimmedSpan(
        hist.map((p) => p.y),
        config.trim,
      )
      const major = Math.max(sx.half, sy.half)
      const minor = Math.min(sx.half, sy.half)

      if (major < config.minMajorPx) {
        why = 'still'
        return null
      }
      if (minor / major < config.minAspect) {
        // 직선 왕복 — reel에 넘기면 퇴화 타원이 되어 판정이 무의미해진다
        why = 'line'
        return null
      }

      why = 'ok'
      const raw = { cx: sx.mid, cy: sy.mid, rx: sx.half, ry: sy.half }
      if (!last) {
        last = raw
      } else {
        // 저역통과 — 궤도가 매 프레임 흔들리면 그게 손의 각도 노이즈가 되어 역방향 전이를 만든다
        const a = config.smooth
        last = {
          cx: last.cx + (raw.cx - last.cx) * a,
          cy: last.cy + (raw.cy - last.cy) * a,
          rx: last.rx + (raw.rx - last.rx) * a,
          ry: last.ry + (raw.ry - last.ry) * a,
        }
      }
      return last
    },
  }
}
