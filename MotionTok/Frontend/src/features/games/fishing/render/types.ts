/**
 * 낚시 렌더 인터페이스 — 판정·루프와 그리는 층을 갈라놓는다 (S15P11A706-10).
 *
 * 계측 화면(다크 + 네온 마커)과 정식 화면(서비스 톤)은 **같은 판정 위에서 다르게 보여야** 한다.
 * 스킨을 갈아끼우는 구조가 아니면 정식 화면을 만들 때 판정 코드를 복사하게 되고, 그 순간
 * 두 화면의 문턱이 갈려서 계측 화면이 죽은 코드가 된다.
 *
 * 캐치캐치리듬의 `render/skins/` 패턴과 같은 계약이다 — 로직은 스킨을 모르고, 렌더러가
 * 현재 스킨의 메서드를 순서대로 부를 뿐이다.
 *
 * 좌표는 전부 캔버스 픽셀이다. `loop.ts`의 무대 좌표가 이미 캔버스 좌표계라 변환이 없다.
 */
import type { LoopConfig, LoopState, Phase, SceneFish } from '../loop'

/** 물보라 — 착수·포획 순간에 생기고 스스로 사그라든다 */
export interface Splash {
  x: number
  y: number
  r: number
  /** 남은 수명(초). 0 이하가 되면 호출자가 제거한다 */
  life: number
}

/**
 * 한 프레임을 그리는 데 필요한, `LoopState` 밖의 것들.
 *
 * 루프가 모르는 정보만 여기 있다 — 조준선, 판정에 쓰인 점, 캠 영상처럼 **입력에서 오는**
 * 것들이다. 루프에 넣으면 순수 로직이 카메라를 알게 된다.
 */
export interface FishingView {
  state: LoopState
  /**
   * 조준 — locked면 백스윙 중이고 x(캔버스 px)가 착수점 미리보기의 입력이다.
   * 단면도에서 조준은 착수 **거리**를 정한다(loop.ts landingXFromAim). 깊이는 WAITING에서
   * 양손 높이(depth.ts → loop.steer)로 따로 조작하고, 그 피드백은 찌 위치 자체다.
   */
  aim: { locked: boolean; x: number }
  /** 지금 판정에 쓰이는 점. null이면 손을 놓친 프레임이다 */
  marker: { x: number; y: number } | null
  splashes: Splash[]
  /** 캠 오버레이용. readyState가 낮으면 스킨이 건너뛴다 */
  video: HTMLVideoElement | null
  /** 연출 시각(ms). 프레임률과 무관하게 흔들림·맥동을 계산하려면 필요하다 */
  tMs: number
  /** HUD 문구 — 캔버스에 HUD를 그리는 스킨만 쓴다 */
  hud: string
  /**
   * 화면 흔들림 0~1 — 입질·포획 순간의 타격감.
   *
   * 스킨이 아니라 `drawFrame`이 캔버스 전체에 적용한다. 흔들림은 특정 도형의 성질이 아니라
   * 화면 전체에 걸리는 것이라, 스킨마다 구현하면 물고기만 흔들리고 배경은 가만히 있는 식으로
   * 어긋난다. 생략하면 0이다(계측 화면은 흔들리면 판정을 눈으로 못 쫓는다).
   */
  shake?: number
}

export interface FishingSkin {
  id: string
  label: string

  /** 하늘·바다·수면선·캠 오버레이. 매 프레임 캔버스를 덮어야 한다(clearRect 대신) */
  drawBackground(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView): void

  /**
   * `cfg`가 필요한 이유는 깊이다.
   *
   * 이 무대는 **물속 단면도**다(loop.ts: x=거리, y=깊이). 물고기 y를 물기둥 안에서
   * 정규화하면 깊이별 표현(수심에 따른 명암 등)을 얹을 수 있고, 그러려면 `waterY`와
   * `height`를 알아야 한다.
   */
  drawFish(
    ctx: CanvasRenderingContext2D,
    fish: SceneFish,
    isActive: boolean,
    phase: Phase,
    tMs: number,
    cfg: LoopConfig,
  ): void

  drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]): void

  drawBobber(ctx: CanvasRenderingContext2D, state: LoopState, cfg: LoopConfig, tMs: number): void

  /**
   * 착수점 미리보기 — IDLE + 백스윙 중에만 불린다.
   * aimX(캔버스 px)를 landingXFromAim으로 옮겨 "여기 떨어진다"를 손 따라 실시간으로 보여준다.
   */
  drawAim(ctx: CanvasRenderingContext2D, aimX: number, cfg: LoopConfig, tMs: number): void

  /**
   * 전경 — 물고기·찌 **앞**에 그린다(근경 해초 등). 무대와 함께 흔들린다.
   * 배경만으로는 단면도의 깊이감이 안 나온다 — 앞뒤 겹이 있어야 물속이 된다.
   */
  drawForeground?(ctx: CanvasRenderingContext2D, cfg: LoopConfig, view: FishingView): void

  /**
   * 판정에 쓰인 점 표시 — **계측 화면 전용**이다.
   * 정식 화면에 손목 점이 뜰 이유가 없으므로 구현하지 않으면 그냥 안 그려진다.
   */
  drawMarker?(
    ctx: CanvasRenderingContext2D,
    marker: { x: number; y: number },
    state: LoopState,
  ): void

  /** 힘겨루기 진행도·챔질 잔여 시간 게이지 */
  drawGauges(ctx: CanvasRenderingContext2D, state: LoopState, cfg: LoopConfig): void

  /**
   * HUD 문구를 캔버스에 그린다.
   *
   * 계측 화면은 DOM으로 HUD를 띄우므로 구현하지 않는다. 정식 화면은 **반드시** 구현해야
   * 하는데, 게임룸이 송출하는 건 캔버스뿐이라 DOM HUD는 다른 참가자 타일에 안 보인다.
   */
  drawHud?(
    ctx: CanvasRenderingContext2D,
    text: string,
    state: LoopState,
    cfg: LoopConfig,
  ): void
}
