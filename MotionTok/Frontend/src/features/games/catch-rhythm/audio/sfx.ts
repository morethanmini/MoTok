/**
 * 효과음 — 절차 합성. 음원 파일이 없어도 소리가 나고, 스킨이 ToneSpec만 갈아끼우면 음색이 바뀐다.
 * 판정 즉시 재생해야 하므로 지연이 없는 오실레이터로 만든다(AudioBuffer 디코드 대기 없음).
 */

import type { ToneSpec } from '../render/skins/types'

/** 동시 발성 상한 */
const MAX_VOICES = 12

/**
 * 판정음 버스 레벨.
 *
 * <p>0.6에서 0.92로 올렸다(+3.7dB). 이 게임은 판정음이 리듬 피드백 자체인데 인게임 곡(−17.3 dBFS를
 * {@link GameBgm}이 0.28로 재생)에 묻혀서 잘 안 들렸다.</p>
 *
 * <p>여기가 상한인 이유 — 스킨의 가장 큰 음색이 PERFECT의 gain 0.32라 한 발은 0.29로 여유가 있지만,
 * 버스트에서 세 발이 겹치면 0.88이라 1.0에 붙는다. 더 올리면 그 순간 클리핑으로 지글거린다
 * (동시 발성은 {@link MAX_VOICES}로만 막혀 있어 세 발 이상도 실제로 난다).</p>
 */
const BUS_GAIN = 0.92

export class SfxPlayer {
  private master: GainNode | null = null
  /** 지금 울리고 있는 소리 수 — 한꺼번에 수십 개가 생기면 오디오 스레드가 막힌다 */
  private voices = 0

  constructor(private readonly ctx: AudioContext) {}

  private get bus(): GainNode {
    if (!this.master) {
      this.master = this.ctx.createGain()
      this.master.gain.value = BUS_GAIN
      this.master.connect(this.ctx.destination)
    }
    return this.master
  }

  setVolume(v: number): void {
    this.bus.gain.value = Math.max(0, Math.min(1, v))
  }

  /**
   * @param spec  스킨이 정한 음색
   * @param combo 현재 콤보 — 쌓일수록 음이 올라가 "타고 있다"는 감각을 준다(리듬게임 관례).
   *              반음 단위로 최대 한 옥타브까지만 올린다. 그 이상은 귀에 거슬린다.
   */
  play(spec: ToneSpec | null, combo = 0): void {
    if (!spec || this.ctx.state === 'closed') return
    if (this.voices >= MAX_VOICES) return // 폭주 방어 — 어차피 귀로 구분 안 된다
    const now = this.ctx.currentTime
    const dur = spec.durationMs / 1000
    // 12콤보마다 반음(2^(1/12)), 최대 +12반음(한 옥타브)
    const steps = Math.min(12, Math.floor(combo / 12))
    const pitch = Math.pow(2, steps / 12)

    const osc = this.ctx.createOscillator()
    osc.type = spec.type
    osc.frequency.setValueAtTime(spec.freq * pitch, now)
    if (spec.sweepTo !== undefined) {
      // 0Hz로는 못 가므로 하한을 둔다(exponentialRamp 제약)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.sweepTo * pitch), now + dur)
    }

    // 클릭 노이즈 방지용 짧은 어택 + 지수 감쇠
    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0.0001, now)
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), now + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(env)
    env.connect(this.bus)
    this.voices += 1
    osc.start(now)
    osc.stop(now + dur + 0.02)
    osc.onended = () => {
      this.voices -= 1
      osc.disconnect()
      env.disconnect()
    }
  }
}
