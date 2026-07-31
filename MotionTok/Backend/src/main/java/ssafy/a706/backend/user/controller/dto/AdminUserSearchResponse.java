package ssafy.a706.backend.user.controller.dto;

import java.util.List;

/**
 * GET /v1/admin/users?nickname= 응답 — 닉네임으로 찾은 회원 후보.
 *
 * <p>관리자 화면의 필터는 여전히 <b>userId</b>다(제재 상태·해제·포인트 요약이 모두 id로 걸린다).
 * 이 응답은 "닉네임 → id"를 옮겨 주는 다리라, 화면에 그릴 최소한(id·닉네임)만 담는다.</p>
 */
public record AdminUserSearchResponse(List<Entry> users) {

    public record Entry(Long userId, String nickname) {
    }
}
