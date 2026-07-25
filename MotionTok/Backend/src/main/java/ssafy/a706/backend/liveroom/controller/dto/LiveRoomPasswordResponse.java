package ssafy.a706.backend.liveroom.controller.dto;

/**
 * 방장이 방 설정 수정 화면을 열 때 기존 비밀번호를 되채우기 위한 응답(S15P11A706-130).
 *
 * <p>{@link LiveRoomDetailResponse}에 password를 얹지 않고 별도 응답으로 분리한 이유:
 * 상세 응답은 get·join·joinByInviteCode·quickStart·update 등 여러 경로에서 참가자 전원에게
 * 내려가므로, 조건부 필드를 넣으면 경로마다 유출 여부를 따져야 한다. 방장 검증이 한 곳에서만
 * 필요한 이 값은 전용 엔드포인트로 두는 편이 안전하다.
 *
 * <p>공개방이면 password는 null이다.
 */
public record LiveRoomPasswordResponse(String password) {
}
