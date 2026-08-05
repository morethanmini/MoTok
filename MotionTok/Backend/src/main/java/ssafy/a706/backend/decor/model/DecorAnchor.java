package ssafy.a706.backend.decor.model;

/**
 * 장착 아이템이 화면에서 무엇을 기준으로 붙는지.
 * FIXED  — 화면 고정 좌표(스티커).
 * FRAME  — 카메라 프레임 전체에 걸리는 효과(뽀샤시 등). 붙는 자리가 없어 x·y를 쓰지 않고,
 *          크기 대신 {@code intensity}로 세기를 조절한다.
 * BACKGROUND — 사람 뒤쪽(배경)에 걸리는 것. FRAME 과 저장 형태는 같지만(x·y·scale 없음 +
 *          {@code intensity}) <b>앵커를 나눠 둔다</b> — 분류 한도가 EFFECT·BACKGROUND 각각 1이라
 *          둘을 동시에 장착할 수 있고, 그때 클라이언트가 어느 배치를 어느 레이어로 그릴지
 *          앵커만 보고 갈라야 한다. FRAME 하나로 합치면 두 배치가 한 슬롯을 다툰다.
 * FACE·HAND — 얼굴·손 랜드마크 추적(가면). 클라이언트에 추적기가 붙으면 사용한다.
 */
public enum DecorAnchor {
    FIXED, FRAME, BACKGROUND, FACE, HAND
}
