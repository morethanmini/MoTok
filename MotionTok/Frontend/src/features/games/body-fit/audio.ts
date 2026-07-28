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

export class BodyFitAudio {
  private els = new Map<Cue, HTMLAudioElement>()
  private current: Cue | null = null

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

  /** 큐 재생. 같은 큐를 다시 요청하면 무시한다(페이즈가 매 틱 갱신돼도 재시작되지 않게). */
  play(cue: Cue, opts: { tailMs?: number; loop?: boolean } = {}) {
    // 사용자가 BGM을 꺼뒀으면 게임 사운드도 내지 않는다 — 음악 설정은 하나로 본다
    if (!useBgm().isEnabled.value || this.current === cue) return
    this.stop()
    this.current = cue

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
      // 자동재생 차단(사용자 상호작용 전)은 조용히 넘긴다 — 다음 큐에서 다시 시도된다
      a.play().catch(() => {})
    }
    if (a.readyState >= 1) start()
    else a.addEventListener('loadedmetadata', start, { once: true })
  }

  /** 전부 멈춘다 — current만 멈추면 위 예약 재생처럼 새어나간 소리를 못 잡는다 */
  stop() {
    this.current = null
    this.els.forEach((a) => {
      if (a.paused) return
      a.pause()
      a.currentTime = 0
    })
  }

  dispose() {
    this.stop()
    this.els.forEach((a) => {
      a.src = ''
    })
    this.els.clear()
  }
}
