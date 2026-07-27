package ssafy.a706.backend.user.controller.dto;

/**
 * PATCH /users/me/avatar — 프로필 사진 확정(명세 확장). 세 가지 요청을 한 엔드포인트로 받는다.
 *
 * <ul>
 *   <li>{@code key}만 — 브라우저가 S3에 올린 오브젝트를 내 사진으로 확정</li>
 *   <li>{@code preset}만 — 기본 프로필 아이콘 선택(업로드 없음)</li>
 *   <li>둘 다 없음 — 아바타 해제(기본 이모지로 되돌린다)</li>
 * </ul>
 *
 * <p><b>URL이 아니라 key·preset을 받는다.</b> URL을 그대로 받으면 클라이언트가 임의의 외부 주소를
 * 프로필 사진으로 박을 수 있다(외부 이미지 임베드·추적 픽셀). 그 사진은 <b>친구 목록을 통해 다른
 * 사용자 화면에도 렌더링되므로</b> 더더욱 서버가 주소를 계산해야 한다.</p>
 *
 * <p>{@code @NotBlank}를 걸지 않는 이유 — 빈 값이 곧 "해제"라서다. 삭제와 변경을 한 엔드포인트로 처리한다.</p>
 */
public record UpdateAvatarRequest(String key, String preset) {
}
