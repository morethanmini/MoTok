/**
 * 효과음 — 절차 합성. 음원 파일이 없어도 소리가 나고, 스킨이 ToneSpec만 갈아끼우면 음색이 바뀐다.
 * 판정 즉시 재생해야 하므로 지연이 없는 오실레이터로 만든다(AudioBuffer 디코드 대기 없음).
 */

import type { ToneSpec } from '../render/skins/types'

export class SfxPlayer {
  private master: GainNode | null = null

  constructor(private readonly ctx: AudioContext) {}

  private get bus(): GainNode {
    if (!this.master) {
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.6
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
    osc.start(now)
    osc.stop(now + dur + 0.02)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }
}
