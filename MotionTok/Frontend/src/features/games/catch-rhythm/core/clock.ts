/**
 * AudioContext 기반 게임 시계.
 *
 * AudioContext.currentTime이 유일한 게임 클럭이다 — Date.now()/rAF 타임스탬프를
 * 판정 기준으로 쓰지 않는다. 탭이 백그라운드로 갔다 와도 오디오 클럭 기준이라
 * 동기가 유지되고, 프레임 드랍이 판정에 영향을 주지 않는다.
 */

/** 테스트에서 가짜 시계를 넣을 수 있도록 currentTime만 요구한다. */
export interface TimeSource {
  readonly currentTime: number
}

export class GameClock {
  private startTime = 0
  private running = false

  constructor(private readonly source: TimeSource) {}

  /** 곡 시작. atCtxTime(초)을 주면 그 시점을 t=0으로 예약할 수 있다(카운트다운). */
  start(atCtxTime: number = this.source.currentTime): void {
    this.startTime = atCtxTime
    this.running = true
  }

  stop(): void {
    this.running = false
  }

  get isRunning(): boolean {
    return this.running
  }

  /** 게임 시각 t (ms). 시작 전이면 0, 예약 시작 전이면 음수. */
  now(): number {
    if (!this.running) return 0
    return (this.source.currentTime - this.startTime) * 1000
  }
}
