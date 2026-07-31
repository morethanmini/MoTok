/**
 * 게임⑤ 낚시 — 양손 높이 → 미끼 깊이 (단면도 전환, S15P11A706-49).
 *
 * 단면도에서 x=거리(파워가 결정)가 되면서 좌우 조준이 갈 곳을 잃었다. 대신 **양손 중점의
 * 높이**가 WAITING 중 미끼 깊이를 제어한다 — 손을 올리면 감아올려 얕게, 내리면 풀어서 깊게.
 * 비어 있던 waiting 6초가 조작 구간이 된다(어종마다 깊이 층이 달라 노리는 층을 고른다).
 *
 * `aimFromHands`(normalize.ts)와 대칭 구조다: 원시 프레임 y가 아니라 **어깨 중점에서 벗어난
 * 거리(어깨너비 배수)**로 정규화한다. 원시 y를 쓰면 카메라 거리·앉은 높이에 따라 같은 자세가
 * 다른 깊이가 된다 — 조준이 화면 46%만 덮던 것과 같은 결함이다.
 *
 * 스무딩은 여기서 하지 않는다. loop.ts의 steer가 목표 깊이로 유한 속도로 이동하므로
 * (steerPxS) 손 지터는 거기서 저역통과된다.
 */

/**
 * 깊이 조작 범위 — 어깨 중점에서 이만큼(어깨너비 배수) 벗어나면 끝.
 *
 * 위 -0.9(손을 머리 위로) = 가장 얕게, 아래 +0.9(손을 무릎 쪽으로) = 가장 깊게.
 * 어깨 높이가 중간 깊이다. 실측 전 초기값 — 조준 랩과 같은 방식으로 실기에서 도달 범위를
 * 재면 이 두 상수만 갈아끼운다.
 */
export const DEPTH_TOP_SW = -0.9
export const DEPTH_BOT_SW = 0.9

/**
 * 양손 중점 y를 깊이 0~1로. 0이 수면 쪽, 1이 바닥 쪽.
 *
 * @param handMidY 양손 손목 중점 y (캔버스 px)
 * @param bodyMidY 어깨 중점 y (캔버스 px) — 깊이 0.5의 기준
 * @param sw       어깨 너비(px). 0이면 중간 깊이를 돌려준다
 */
export function depthFromHands(handMidY: number, bodyMidY: number, sw: number): number {
  if (!(sw > 0)) return 0.5
  const offSw = (handMidY - bodyMidY) / sw
  const d = (offSw - DEPTH_TOP_SW) / (DEPTH_BOT_SW - DEPTH_TOP_SW)
  return Math.min(1, Math.max(0, d))
}
