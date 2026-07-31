/**
 * 루프 한 곡만 쓰는 게임의 BGM.
 *
 * <p>{@code body-fit}의 {@link BodyFitAudio}는 페이즈마다 큐를 갈아끼우느라 꼬리 정렬·큐별 램프를
 * 갖고 있지만, 핑거 스타·그림 릴레이는 인게임 루프 하나뿐이라 그 기계가 필요 없다. 대신 거기서
 * 얻은 두 가지는 그대로 가져온다 — 볼륨 램프로 이음매를 없애고, 자동재생 차단은 조용히 넘긴다.</p>
 *
 * <p>전역 테마와 겹치지 않게 하는 책임은 여기가 아니라 {@code GameRoomView}의 소유 판정에 있다
 * (거기서 {@code suspendForGame}을 부른다). 이 클래스는 자기 트랙만 다룬다.</p>
 */
import { watch, type WatchStopHandle } from 'vue'
import { gameMusicGain, useBgm } from '@/composables/useBgm'

/**
 * 로비 테마(useBgm 의 0.2)와 체감을 맞춘 값. 파일 RMS 를 재서 역산했다 —
 * 로비 테마는 −15.2 dBFS, 이 게임들의 루프는 −17.4~−18.0 dBFS 라서 배수가 같으면 오히려 작게
 * 들린다. 0.26 이 로비와 동일하고, 게임 음악은 앰비언스보다 약간 앞에 있는 게 자연스러워 0.28.
 * 배수만 보고 0.45 로 뒀다가 로비보다 +4.9 dB 커졌던 자리다.
 */
const VOLUME = 0.28
const FADE_MS = 400
const RAMP_STEP_MS = 25

export class GameBgm {
  private el: HTMLAudioElement | null = null
  private ramp: number | undefined
  private stopWatch: WatchStopHandle

  constructor(private readonly src: string) {
    // 게임 중 슬라이더를 움직이면 즉시 반영한다. 램프 없이 바로 얹는 이유 —
    // 드래그는 값이 연속으로 들어와서 램프를 걸면 서로 취소하며 계단처럼 들린다.
    this.stopWatch = watch(useBgm().gameMusic, (v) => {
      // 음악을 꺼둔 채로 게임에 들어오면 start()가 조기 반환해 트랙이 아예 안 선다.
      // 그 상태에서 슬라이더를 올렸을 때 살아나야 한다 — 이 게임은 start()를 마운트에 한 번만 부른다.
      if (v > 0 && (!this.el || this.el.paused)) return this.start()
      if (this.el && !this.el.paused && this.ramp === undefined) this.el.volume = this.target()
    })
  }

  /** 곡별 기준 레벨 × 게임 음악 배수(0.5에서 1배, 1.0에서 2배) */
  private target(): number {
    return Math.min(1, VOLUME * gameMusicGain())
  }

  private audio(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio(this.src)
      this.el.preload = 'auto'
      this.el.loop = true
      this.el.volume = 0
    }
    return this.el
  }

  private to(target: number, done?: () => void) {
    const a = this.audio()
    if (this.ramp !== undefined) window.clearInterval(this.ramp)
    const from = a.volume
    const steps = Math.max(1, Math.round(FADE_MS / RAMP_STEP_MS))
    let i = 0
    this.ramp = window.setInterval(() => {
      i += 1
      a.volume = Math.min(1, Math.max(0, from + (target - from) * (i / steps)))
      if (i < steps) return
      window.clearInterval(this.ramp)
      this.ramp = undefined
      done?.()
    }, RAMP_STEP_MS)
  }

  /** 사용자가 BGM을 꺼뒀으면 게임 사운드도 내지 않는다 — 음악 설정은 하나로 본다(body-fit과 같은 규약). */
  start() {
    if (!useBgm().isEnabled.value) return
    const a = this.audio()
    if (!a.paused) return
    a.volume = 0
    // 자동재생 차단(사용자 상호작용 전)은 조용히 넘긴다. 반환값을 그대로 믿지 않는 이유 —
    // jsdom 은 play() 가 미구현이라 Promise 가 아니라 undefined 를 준다(테스트가 .catch 에서 죽었다).
    void Promise.resolve(a.play()).catch(() => {})
    this.to(this.target())
  }

  stop() {
    const a = this.el
    if (!a || a.paused) return
    this.to(0, () => {
      a.pause()
      a.currentTime = 0
    })
  }

  /** 언마운트는 즉시 침묵 — 램프나 감시자를 남기면 사라진 컴포넌트가 소리를 계속 만진다. */
  dispose() {
    this.stopWatch()
    if (this.ramp !== undefined) window.clearInterval(this.ramp)
    this.ramp = undefined
    if (this.el) {
      this.el.pause()
      this.el.src = ''
      this.el = null
    }
  }
}
