/**
 * 인게임 곡 — **판정 시계와 같은 AudioContext에 예약 재생**한다.
 *
 * <p>다른 게임들은 {@link GameBgm}(HTMLAudioElement)으로 곡을 튼다. 이 게임은 그러면 안 된다 —
 * 곡이 채보의 박자 기준이라서 시작 시각이 판정 시계와 어긋나면 격자를 0.5ms로 맞춰놔도 곡만
 * 통째로 밀린다. element 재생에는 (a) `play()` 호출 지연 수십~100ms, (b) rAF·setTimeout 지터,
 * (c) element 자체 클럭이 `AudioContext.currentTime`과 따로 흐르는 드리프트가 다 얹힌다.</p>
 *
 * <p>{@link AudioBufferSourceNode}로 `start(when, offset)` 예약하면 그 세 가지가 전부 사라진다 —
 * 시작 시각이 판정과 같은 축의 절대 시각이 되고, 재생 클럭도 같은 하드웨어 클럭이다.
 * 덤으로 로딩이 늦어도 **파일 안쪽 offset에서 시작해 위상을 지킬 수 있다**(element로는 못 한다).</p>
 *
 * <p>음악 설정·게임 음악 슬라이더를 따르는 규약은 {@link GameBgm}과 같게 유지한다.</p>
 */
import { watch, type WatchStopHandle } from 'vue'
import { gameMusicGain, useBgm } from '@/composables/useBgm'

/**
 * 곡 기준 레벨 — gameBgm.ts와 같은 기준으로 맞췄다.
 * Neon_Pulse의 RMS가 −17.32 dBFS로 다른 게임 루프(−17.4~−18.0)와 같은 대역이라 값도 같다.
 */
const VOLUME = 0.28
/** 시작·종료 페이드. 맞춰둔 첫 박이 뭉개지지 않게 짧게 준다(이음매만 없앨 만큼) */
const FADE_IN_MS = 90
const FADE_OUT_MS = 400

/**
 * "첫 소리"를 찾는 규칙 — 10ms 창의 RMS가 이 값을 넘는 첫 지점.
 *
 * <p>파일 t=0을 기준으로 상수를 박지 않고 **디코드된 버퍼에서 매번 실측하는 이유**:
 * MP3에는 인코더 지연(이 파일은 34.5ms)이 있고, 그걸 디코더가 잘라내는지가 구현마다 다르다.
 * 오프라인 분석(mpg123)과 브라우저(decodeAudioData)가 다르게 잘라내면 박아둔 상수만큼 곡이
 * 밀린다. 양쪽이 <b>같은 규칙으로 첫 소리를 찾으면</b> 그 차이가 상쇄된다 —
 * songAccents.ts의 지도도 이 규칙으로 잡은 원점에 맞춰 뽑았다.</p>
 */
const HEAD_WINDOW_MS = 10
const HEAD_THRESHOLD_DB = -50
/**
 * 곡의 8분음표 격자는 첫 소리보다 이만큼 앞에 있다(실측).
 *
 * <p>−50dBFS를 넘는 지점은 어택이 이미 올라오는 중이라 격자보다 조금 뒤다. 196kbps 원본과
 * 96kbps 재인코딩 파일에서 각각 154−170, 144−160으로 <b>같은 −16ms</b>가 나왔다 —
 * 인코딩이 아니라 곡의 성질이라는 뜻이라 상수로 둔다.</p>
 */
const GRID_LEAD_MS = 16

export class RhythmMusic {
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private readonly stopWatch: WatchStopHandle
  private disposed = false
  /** 곡의 박자 격자가 시작되는 파일 안 위치(초) — load에서 실측한다 */
  private gridOriginSec = 0

  constructor(
    private readonly ctx: AudioContext,
    private readonly src: string,
  ) {
    // 재생 중 슬라이더를 움직이면 즉시 반영. 램프 없이 얹는 이유는 gameBgm과 같다 —
    // 드래그는 값이 연속으로 들어와서 램프를 걸면 서로 취소하며 계단처럼 들린다.
    this.stopWatch = watch(useBgm().gameMusic, () => {
      if (this.gain) this.gain.gain.value = this.target()
    })
  }

  /** 곡별 기준 레벨 × 게임 음악 배수 */
  private target(): number {
    return Math.min(1, VOLUME * gameMusicGain())
  }

  /** 디코드까지 끝낸다. 실패해도 게임은 그대로 돌아야 하므로 던지지 않는다. */
  async load(): Promise<boolean> {
    try {
      const bytes = await (await fetch(this.src)).arrayBuffer()
      const buffer = await this.ctx.decodeAudioData(bytes)
      if (this.disposed) return false
      this.buffer = buffer
      this.gridOriginSec = Math.max(0, detectFirstSound(buffer) - GRID_LEAD_MS / 1000)
      return true
    } catch {
      return false // 파일 없음·디코드 실패·컨텍스트 종료 — 곡 없이 판정음만으로 플레이
    }
  }

  /**
   * 곡의 **박자 격자 시작점**이 `atCtxTime`(초, 오디오 클럭)에 오도록 예약한다.
   *
   * <p>파일 t=0이 아니라 격자 원점을 맞춘다 — 머리 무음·인코더 지연을 건너뛰고 재생하므로
   * 호출부는 "노트 슬롯의 시각"만 주면 된다.</p>
   *
   * @returns 실제로 걸었는지 — 이미 곡 길이를 넘겼거나 음악을 꺼둔 경우 false
   */
  start(atCtxTime: number): boolean {
    if (!this.buffer || this.source || this.disposed) return false
    // 사용자가 BGM을 꺼뒀으면 게임 음악도 내지 않는다(다른 게임들과 같은 규약)
    if (!useBgm().isEnabled.value) return false

    const now = this.ctx.currentTime
    // 예약 시각이 이미 지났으면(모델 로딩이 길어진 경우) 그만큼 파일 안쪽에서 시작한다 —
    // 처음부터 틀면 곡이 늦게 따라오면서 채보와의 위상이 영구히 어긋난다.
    const late = now - atCtxTime
    const at = late > 0 ? now : atCtxTime
    // 격자 원점부터 재생한다 — 늦었으면 그만큼 더 안쪽으로
    const offset = this.gridOriginSec + Math.max(0, late)
    if (offset >= this.buffer.duration) return false

    const gain = this.ctx.createGain()
    const source = this.ctx.createBufferSource()
    source.buffer = this.buffer
    source.connect(gain).connect(this.ctx.destination)
    // 파형 중간에서 시작하는 경우(offset > 0) 0에서 올리지 않으면 딸깍 소리가 난다
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(this.target(), at + FADE_IN_MS / 1000)
    source.start(at, offset)
    this.source = source
    this.gain = gain
    return true
  }

  /** 한 판이 끝나면 겹치며 뺀다 — 뚝 끊으면 그것도 이음매로 들린다. */
  stop(): void {
    const source = this.source
    const gain = this.gain
    if (!source || !gain) return
    this.source = null
    this.gain = null
    const t = this.ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(0, t + FADE_OUT_MS / 1000)
    source.stop(t + FADE_OUT_MS / 1000 + 0.05)
  }

  /** 언마운트는 즉시 침묵 — 감시자를 남기면 사라진 컴포넌트가 소리를 계속 만진다. */
  dispose(): void {
    this.disposed = true
    this.stopWatch()
    try {
      this.source?.stop()
    } catch {
      // 아직 start되지 않은 소스는 stop에서 던진다 — 정리 중이라 무시해도 된다
    }
    this.source?.disconnect()
    this.gain?.disconnect()
    this.source = null
    this.gain = null
    this.buffer = null
  }
}

/**
 * 버퍼에서 첫 소리가 나는 시각(초). 오프라인 분석 스크립트와 **같은 규칙**이어야 한다
 * ({@link HEAD_WINDOW_MS} 창의 RMS > {@link HEAD_THRESHOLD_DB}).
 */
function detectFirstSound(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  const win = Math.max(1, Math.round((buffer.sampleRate * HEAD_WINDOW_MS) / 1000))
  const floor = Math.pow(10, HEAD_THRESHOLD_DB / 20)
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += data[j]! * data[j]!
    if (Math.sqrt(sum / win) > floor) return i / buffer.sampleRate
  }
  return 0
}
