package ssafy.a706.backend.user.controller.dto;

/**
 * PATCH /users/me/avatar — 업로드가 끝난 뒤 그 오브젝트 key를 서버에 알려 준다(명세 확장).
 *
 * <p><b>URL이 아니라 key를 받는다.</b> URL을 그대로 받으면 클라이언트가 임의의 외부 주소를
 * 프로필 사진으로 박을 수 있다(외부 이미지 임베드·추적 픽셀). key만 받아 서버가 소유권을 확인하고
 * 공개 URL을 직접 계산한다.</p>
 *
 * <p>{@code key}가 null이면 기본 아바타로 되돌린다(사진 삭제).
 * 그래서 {@code @NotBlank}를 걸지 않는다 — 삭제와 변경을 한 엔드포인트로 처리한다.</p>
 */
public record UpdateAvatarRequest(String key) {
}
