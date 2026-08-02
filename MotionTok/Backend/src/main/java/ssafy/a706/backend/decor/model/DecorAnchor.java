package ssafy.a706.backend.decor.model;

/**
 * 장착 아이템이 화면에서 무엇을 기준으로 붙는지.
 * FIXED  — 화면 고정 좌표(스티커).
 * FRAME  — 카메라 프레임 전체에 걸리는 효과(뽀샤시 등). 붙는 자리가 없어 x·y를 쓰지 않고,
 *          크기 대신 {@code intensity}로 세기를 조절한다.
 * FACE·HAND — 얼굴·손 랜드마크 추적(가면). 클라이언트에 추적기가 붙으면 사용한다.
 */
public enum DecorAnchor {
    FIXED, FRAME, FACE, HAND
}
