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
    /** 머리 기울기 증폭 배율 — 얼굴 없는 구는 위치 이동만 보이므로 각도를 키워 체감을 살린다 */
    headGain: number
  }
  /**
   * 난이도 모드 프리셋 — 구멍 여유(K)와 벽 접근 시간이 함께 바뀐다.
   * 쉬움 K 1.5는 실기 플레이로 확정(2026-07-27), 나머지는 캘리브레이션 대상 초깃값 (UI 스펙 §11)
   */
  difficulty: Record<DifficultyKey, { K: number; approachMs: number }>
  /** 판정 모델 (기획 §7, UI 스펙 §2) */
  judge: {
    /** 면적비 — 구멍 면적 = 원본 면적 × K. 난이도의 핵심 노브 (§2-3) */
    K: number
    /** 세그먼트별 마진 배율 (§2-2) — 관절에서 멀수록 각도 오차가 증폭되므로 말단이 크다 */
    marginMul: {
      headTorso: number
      upperArm: number
      forearm: number
      hand: number
    }
    /** 내 실루엣 중 구멍 밖 픽셀 비율이 이 이하면 통과 */
    overflowTolerance: number
    /** 등급 임계 (UI 스펙 §1-4) — IoU × 100 기준 */
    grade: { perfect: number; great: number; pass: number }
    /** 판정 마스크 한 변(px) — 128이면 정확도·비용 균형 (§9-1) */
    maskSize: number
  }
  /** 벽 연출 */
  wall: {
    /** 벽 접근 시간(ms) — UI 스펙 §7 */
    approachMs: number
  }
  /** 3D 에셋 리스킨 배치 치수 (S15P11A706-9) — 아바타 공간(어깨너비=1) 단위 */
  stage: {
    /** podium.glb 정규화 목표 — 지름·높이 (원본 bbox 0.98×0.24×1.00) */
    podium: { diameter: number; height: number }
    /** wall-slab.glb 프레임 바 — 폭·두께·평면 겹침폭 (원본 bbox 0.89×1.00×0.26) */
    slabFrame: { barWidth: number; depth: number; inset: number }
  }
}

export type Grade = 'PERFECT' | 'GREAT' | 'PASS' | 'FAIL'
export type DifficultyKey = 'easy' | 'normal' | 'hard'

export function defaultConfig(): BodyFitConfig {
  return {
    filter: {
      minCutoff: 1.2,
      // 0.4는 빠른 동작이 뭉뚝하게 눌렸다(2026-07-27 실기) — 속도 추종을 올림
      beta: 0.8,
    },
    avatar: {
      // 1.6이면 팔 길이가 인체 비율(어깨너비 대비 ~1.3배)과 맞아 교차 포즈가 1:1로 매핑된다.
      // 1.3(기획 초안)에서는 팔이 짧아 X자 교차가 몸 중앙까지 닿지 못했다 (2026-07-27 실기)
      limbScale: 1.6,
      capsuleRadius: 0.13,
      headRadius: 0.42,
      leanGain: 1.6,
      headGain: 1.5,
    },
    difficulty: {
      // 접근 시간은 BE GameSessionService.BODY_FIT_APPROACH_MILLIS와 반드시 동기화.
      // 멀티는 서버 endAt이 진실이라 한쪽만 바꾸면 벽 도착과 판정 시점이 어긋난다.
      easy: { K: 1.5, approachMs: 6000 },
      normal: { K: 1.35, approachMs: 5000 },
      hard: { K: 1.2, approachMs: 4000 },
    },
    judge: {
      K: 1.5,
      marginMul: { headTorso: 0.6, upperArm: 1.0, forearm: 1.6, hand: 2.0 },
      overflowTolerance: 0.03,
      grade: { perfect: 92, great: 82, pass: 70 },
      maskSize: 128,
    },
    wall: {
      approachMs: 7000,
    },
    stage: {
      // 기존 실린더 포디움(반경 1.35~1.55) 발자국 유지, 높이만 석재 질감이 보이게 살짝 키움
      podium: { diameter: 3.0, height: 0.35 },
      slabFrame: { barWidth: 0.8, depth: 0.5, inset: 0.1 },
    },
  }
}
