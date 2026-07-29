/**
 * 게임④ 사운드 (S15P11A706-138) — 페이즈마다 큐를 하나씩 재생한다.
 *
 * <p>레이어를 쌓지 않고 한 번에 한 트랙만 튼다. 각 큐가 완성된 곡이라 겹치면 탁해진다.</p>
 *
 * <p><b>꼬리 정렬(tailMs)</b>: Suno로 뽑은 큐는 30초인데 실제 페이즈는 4~6초다. 앞에서부터
 * 틀면 도입부만 듣고 끊겨 라이저의 절정이 영원히 오지 않는다. 그래서 "이 큐가 tailMs 뒤에
 * 끝나도록" 재생 위치를 뒤에서 역산한다 — 빌드업의 정점이 벽 도착 순간과 맞는다.
 * 나중에 파일을 페이즈 길이에 맞춰 자르더라도 offset이 0에 수렴할 뿐 그대로 동작한다.</p>
 */
import { useBgm } from '@/composables/useBgm'

const SRC = {
  /** 인게임 베드 겸 최종 결과(기획상 ①=⑤) — 유일하게 루프 */
  ingame: '/assets/sfx/body-fit/ingame-loop.mp3',
  setting: '/assets/sfx/body-fit/setting.mp3',
  approach: '/assets/sfx/body-fit/wall-approach.mp3',
  rest: '/assets/sfx/body-fit/rest.mp3',
} as const

export type Cue = keyof typeof SRC

const VOLUME = 0.5

/**
 * 큐 교체 시 겹치는 시간.
 *
 * <p>출제 대결은 한 라운드에 rest → setting → approach로 세 번 갈아끼우는데, 예전에는 이전 곡을
 * 즉시 pause하고 다음 곡을 트는 순간 재생이라 라운드마다 "뚝 끊고 새로 시작"하는 소리가 났다.
 * 250ms 겹치면 이음매가 안 들린다.</p>
 *
 * <p>"한 번에 한 트랙"이라는 이 파일의 원칙과 어긋나 보이지만, 이건 <b>레이어가 아니라 전환</b>이다 —
 * 겹침을 250ms로 묶어두는 이유가 그것이다. 이 값을 1초쯤으로 늘리면 완성곡 두 개가 실제로
 * 겹쳐 들려 탁해진다.</p>
 */
const FADE_MS = 250
/** 볼륨 램프 간격 — 25ms(40Hz)면 사람 귀에 계단이 안 들리고 타이머 부담도 없다 */
const RAMP_STEP_MS = 25

export class BodyFitAudio {
  private els = new Map<Cue, HTMLAudioElement>()
  private current: Cue | null = null
  /** 진행 중인 볼륨 램프 (큐별 1개) — 같은 큐에 램프가 겹치면 서로 볼륨을 되돌린다 */
  private ramps = new Map<Cue, number>()

  private el(cue: Cue): HTMLAudioElement {
    let a = this.els.get(cue)
    if (!a) {
      a = new Audio(SRC[cue])
      a.preload = 'auto'
      a.volume = VOLUME
      this.els.set(cue, a)
    }
    return a
  }

  /** 볼륨을 to까지 FADE_MS에 걸쳐 옮긴다. 같은 큐의 이전 램프는 취소한다. */
  private ramp(cue: Cue, to: number, done?: () => void) {
    const a = this.el(cue)
    const prev = this.ramps.get(cue)
    if (prev !== undefined) window.clearInterval(prev)
    const from = a.volume
    const steps = Math.max(1, Math.round(FADE_MS / RAMP_STEP_MS))
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      a.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)))
      if (i < steps) return
      window.clearInterval(id)
      this.ramps.delete(cue)
      done?.()
    }, RAMP_STEP_MS)
    this.ramps.set(cue, id)
  }

  /** 겹치며 빠진다 — 다 빠지면 멈추고 처음으로 되돌린다(다음 라운드에 꼬리 정렬을 다시 하므로). */
  private fadeOut(cue: Cue) {
    const a = this.el(cue)
    if (a.paused) return
    this.ramp(cue, 0, () => {
      // 빠지는 동안 이 큐가 다시 요청됐으면(빠른 페이즈 왕복) 건드리지 않는다
      if (this.current === cue) return
      a.pause()
      a.currentTime = 0
    })
  }

  /** 큐 재생. 같은 큐를 다시 요청하면 무시한다(페이즈가 매 틱 갱신돼도 재시작되지 않게). */
  play(cue: Cue, opts: { tailMs?: number; loop?: boolean } = {}) {
    // 사용자가 BGM을 꺼뒀으면 게임 사운드도 내지 않는다 — 음악 설정은 하나로 본다
    if (!useBgm().isEnabled.value || this.current === cue) return
    const previous = this.current
    this.current = cue
    // 이전 곡은 끊지 않고 겹치며 빼고, 새 곡은 0에서 올린다 — 이 두 줄이 "새로 시작하는" 소리를 없앤다
    if (previous) this.fadeOut(previous)
    // 예약 재생으로 새어나간 다른 큐도 같이 정리한다(첫 라운드에 rest·setting이 겹쳐 들렸던 경우)
    this.els.forEach((_, other) => {
      if (other !== cue && other !== previous) this.fadeOut(other)
    })

    const a = this.el(cue)
    a.loop = opts.loop ?? false
    const start = () => {
      // 로드를 기다리는 사이 페이즈가 넘어갔으면 틀지 않는다.
      // 이 가드가 없으면 뒤늦게 도착한 metadata 이벤트가 이미 재생 중인 큐 위에 겹쳐 튼다
      // (첫 라운드에 rest와 setting이 같이 들리던 원인 — 그때가 파일을 처음 받는 시점이라).
      if (this.current !== cue) return
      const tail = opts.tailMs
      if (tail && Number.isFinite(a.duration)) {
        a.currentTime = Math.max(0, a.duration - tail / 1000)
      }
      // 직전 라운드의 페이드아웃이 남긴 볼륨(0 근처)에서 시작해 올린다
      a.volume = 0
      // 자동재생 차단(사용자 상호작용 전)은 조용히 넘긴다 — 다음 큐에서 다시 시도된다
      a.play().catch(() => {})
      this.ramp(cue, VOLUME)
    }
    if (a.readyState >= 1) start()
    else a.addEventListener('loadedmetadata', start, { once: true })
  }

  /**
   * 전부 멈춘다 — current만 멈추면 예약 재생처럼 새어나간 소리를 못 잡는다.
   * 라운드 사이 result에서도 불리므로 여기서도 겹치며 뺀다(뚝 끊으면 그것도 이음매로 들린다).
   */
  stop() {
    const playing = [...this.els.keys()]
    this.current = null
    playing.forEach((cue) => this.fadeOut(cue))
  }

  dispose() {
    // 언마운트는 즉시 침묵 — 램프 타이머를 남기면 사라진 컴포넌트가 소리를 계속 만진다
    this.ramps.forEach((id) => window.clearInterval(id))
    this.ramps.clear()
    this.current = null
    this.els.forEach((a) => {
      a.pause()
      a.src = ''
    })
    this.els.clear()
  }
}
