package ssafy.a706.backend.user.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.user.service.UserRecordService;
import ssafy.a706.backend.user.service.UserService;
import ssafy.a706.backend.user.controller.dto.ChangePasswordRequest;
import org.springframework.web.bind.annotation.RequestParam;
import ssafy.a706.backend.user.controller.dto.GameRecordResponse;
import ssafy.a706.backend.user.controller.dto.PointBalanceResponse;
import ssafy.a706.backend.user.controller.dto.PointHistoryPageResponse;
import ssafy.a706.backend.user.controller.dto.PublicUserProfileResponse;
import ssafy.a706.backend.user.controller.dto.UpdateAvatarRequest;
import ssafy.a706.backend.user.controller.dto.UpdateProfileRequest;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.controller.dto.WithdrawRequest;

import java.util.List;

/**
 * API 명세서 회원 도메인 — 프로필 조회·수정, 포인트 잔액, 비밀번호 변경, 탈퇴(-23·-111),
 * 전적 조회(-97·-141). 인벤토리·화면 꾸미기는 DecorController.
 */
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final UserRecordService userRecordService;

    /** GET /users/me — 내 프로필 조회 */
    @GetMapping("/me")
    public UserProfileResponse me(@AuthenticationPrincipal MemberPrincipal principal) {
        return userService.getProfile(principal.id());
    }

    /** GET /users/me/points — 포인트 잔액 조회 */
    @GetMapping("/me/points")
    public PointBalanceResponse points(@AuthenticationPrincipal MemberPrincipal principal) {
        return userService.getPointBalance(principal.id());
    }

    /** GET /users/me/points/history — 포인트 적립·사용 내역(최신순) */
    @GetMapping("/me/points/history")
    public PointHistoryPageResponse pointHistory(@AuthenticationPrincipal MemberPrincipal principal,
                                                 @RequestParam(defaultValue = "0") int page,
                                                 @RequestParam(defaultValue = "20") int size) {
        return userService.getPointHistory(principal.id(), page, size);
    }

    /** PATCH /users/me — 프로필(닉네임) 수정 */
    @PatchMapping("/me")
    public UserProfileResponse update(@AuthenticationPrincipal MemberPrincipal principal,
                                      @Valid @RequestBody UpdateProfileRequest req) {
        return userService.updateNickname(principal.id(), req.nickname());
    }

    /**
     * PATCH /users/me/avatar — 프로필 사진 확정(명세 확장).
     * 업로드는 POST /uploads/presign 으로 받은 URL에 브라우저가 직접 하고, 여기엔 그 결과 key만 보낸다.
     * 기본 프로필 아이콘을 고른 경우엔 key 대신 preset(파일명)을 보낸다.
     * 둘 다 생략하면 아바타를 해제한다.
     */
    @PatchMapping("/me/avatar")
    public UserProfileResponse updateAvatar(@AuthenticationPrincipal MemberPrincipal principal,
                                            @RequestBody(required = false) UpdateAvatarRequest req) {
        return userService.updateAvatar(principal.id(),
                req == null ? new UpdateAvatarRequest(null, null) : req);
    }

    /** PATCH /users/me/password — 비밀번호 변경(현재 비밀번호 확인) */
    @PatchMapping("/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@AuthenticationPrincipal MemberPrincipal principal,
                               @Valid @RequestBody ChangePasswordRequest req) {
        userService.changePassword(principal.id(), req.currentPassword(), req.newPassword());
    }

    /**
     * DELETE /users/me — 회원 탈퇴(soft delete).
     * 본인 확인 필수 — 자체 가입은 비밀번호, 소셜 전용 계정은 소셜 재인증(-111).
     * 본문이 없으면 400으로 어떤 확인이 필요한지 알려준다.
     */
    @DeleteMapping("/me")
    public ResponseEntity<Void> withdraw(@AuthenticationPrincipal MemberPrincipal principal,
                                         @RequestBody(required = false) WithdrawRequest req) {
        userService.withdraw(principal.id(), req);
        return ResponseEntity.noContent().build();
    }

    /**
     * GET /users/{userId} — 다른 사용자의 공개 프로필(-96 랭킹에서 프로필 조회).
     * 회원 전용(SecurityConfig에서 /api/users/**는 ROLE_USER)이고, 탈퇴·정지 계정은 404다.
     */
    @GetMapping("/{userId}")
    public PublicUserProfileResponse publicProfile(@PathVariable Long userId) {
        return userService.getPublicProfile(userId);
    }

    /** GET /users/me/records — 내 전적(게임별 플레이 횟수·최고 점수·순위, -97). */
    @GetMapping("/me/records")
    public List<GameRecordResponse> myRecords(@AuthenticationPrincipal MemberPrincipal principal) {
        return userRecordService.records(principal.id());
    }

    /**
     * GET /users/{userId}/records — 다른 사용자의 게임별 전적(-141 친구 상세).
     * 공개 범위는 공개 프로필과 동일(회원 전체 — 결정 Q3). 탈퇴·정지 계정은 404.
     */
    @GetMapping("/{userId}/records")
    public List<GameRecordResponse> records(@PathVariable Long userId) {
        return userRecordService.records(userId);
    }
}
