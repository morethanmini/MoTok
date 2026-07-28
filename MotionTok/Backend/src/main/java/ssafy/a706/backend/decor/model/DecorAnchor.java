package ssafy.a706.backend.decor.model;

/**
 * 장착 아이템이 화면에서 무엇을 기준으로 붙는지.
 * FIXED  — 화면 고정 좌표(스티커). 지금 구현된 유일한 방식.
 * FACE·HAND — 얼굴·손 랜드마크 추적(가면·효과). 클라이언트에 추적기가 붙으면 사용한다.
 */
public enum DecorAnchor {
    FIXED, FACE, HAND
}
