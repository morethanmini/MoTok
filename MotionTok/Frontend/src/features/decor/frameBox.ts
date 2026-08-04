/**
 * 오버레이 박스 안에서 <b>영상 프레임이 실제로 놓이는 사각형</b>을 잡는다.
 *
 * 꾸미기 좌표(스티커 위치·얼굴 앵커)는 전부 프레임 기준 0~1이다. 그런데 얹히는 박스는
 * 타일 레이아웃이 정하므로 영상 비율과 다를 수 있고, 그때 `object-fit`이 프레임을 박스 안에
 * 넣거나(contain, 여백 생김) 밖으로 넘긴다(cover, 잘림). 박스 좌표를 그대로 쓰면 그 차이만큼
 * 어긋난다 — 16:9 타일에 4:3 영상이면 가로로 12%씩 밀린다.
 *
 * <b>스티커와 효과가 같은 함수를 쓴다.</b> 가면과 스포트라이트 구멍이 같은 얼굴을 가리켜야
 * 하는데, 기하를 각자 갖고 있으면 한쪽만 고쳐져 둘이 어긋난 채로 남는다.
 */

/** 박스 좌표계(px) 안의 프레임 사각형. */
export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * @param aspect 영상 비율(가로/세로). 박스가 곧 프레임이면(비율을 맞춰 둔 편집기처럼) null.
 * @param fit    `<video>`의 object-fit과 <b>같은 값</b>이어야 한다 — 다르면 여백에 얹힌다.
 */
export function frameRect(
  boxW: number,
  boxH: number,
  aspect: number | null | undefined,
  fit: 'contain' | 'cover',
): FrameRect {
  if (!aspect || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH }

  // contain·cover는 중앙 정렬이라 계산이 같고, 어느 변에 맞추는지만 반대다.
  const boxIsWider = boxW / boxH > aspect
  const fitToHeight = fit === 'contain' ? boxIsWider : !boxIsWider
  if (fitToHeight) {
    const w = boxH * aspect
    return { x: (boxW - w) / 2, y: 0, w, h: boxH }
  }
  const h = boxW / aspect
  return { x: 0, y: (boxH - h) / 2, w: boxW, h }
}
