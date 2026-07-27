/**
 * 게임④ 몸 끼워 맞추기 — 튜닝 값 단일 설정 객체 (UI 스펙 §10).
 *
 * 코드를 고치지 않고 조정할 수 있어야 하는 값 전부를 여기 모은다.
 * /dev/avatar-lab의 슬라이더가 이 객체를 직접 바인딩하고,
 * 확정된 값은 이 파일의 기본값을 덮어써서 본 게임으로 가져간다.
 *
 * 단위: 아바타 공간은 "어깨너비 = 1"로 정규화된 좌표계(기획 초안 §5-5)를 쓴다.
 * 길이·반경 값은 전부 어깨너비 배수다.
 */

export interface BodyFitConfig {
  /** One Euro Filter — 아바타 떨림 ↔ 반응 지연 트레이드오프. 비주얼 퀄리티 1순위 변수 */
  filter: {
    /** 정지 시 컷오프(Hz). 낮을수록 정지 상태 떨림이 죽고, 너무 낮으면 느린 움직임이 끈적해진다 */
    minCutoff: number
    /** 속도 계수. 높을수록 빠른 움직임의 지연이 줄고, 너무 높으면 빠른 구간 떨림이 살아난다 */
    beta: number
  }
  /** 아바타 비율 — 표준 골격 상수는 avatarRig.ts, 여기는 그 배율·반경 */
  avatar: {
    /** 팔다리 길이 배율. 기획 초안 §5-3: 실루엣 변별력을 위해 1.3 근처에서 시작 */
    limbScale: number
    /** 사지 캡슐 반경 — 구멍 가독성과 직결 */
    capsuleRadius: number
    /** 머리 반경 — 귀여움 담당, 레퍼런스 비율 유지 */
    headRadius: number
    /**
     * 허리 기울기 증폭 배율. 앉은 자세에서는 MediaPipe가 엉덩이를 보수적으로 추정해
     * 측정 각도가 실제보다 작게 나온다 — 화면 움직임이 압축된 느낌의 원인.
     * 1 = 측정값 그대로, 2 = 두 배로 기울임
     */
    leanGain: number
  }
}

export function defaultConfig(): BodyFitConfig {
  return {
    filter: {
      minCutoff: 1.2,
      beta: 0.4,
    },
    avatar: {
      limbScale: 1.3,
      capsuleRadius: 0.13,
      headRadius: 0.42,
      leanGain: 1.6,
    },
  }
}
