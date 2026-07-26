package ssafy.a706.backend.friend.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.MemberPrincipal;
import ssafy.a706.backend.friend.controller.dto.CreateFriendRequest;
import ssafy.a706.backend.friend.controller.dto.FriendRequestItemResponse;
import ssafy.a706.backend.friend.controller.dto.FriendResponse;
import ssafy.a706.backend.friend.controller.dto.FriendRoomResponse;
import ssafy.a706.backend.friend.controller.dto.RespondFriendRequest;
import ssafy.a706.backend.friend.service.FriendService;

import java.util.List;

/**
 * API 명세서 친구 도메인(§6, -57).
 *
 * <p>성공 응답은 ApiResponse로 감싸지 않는다 — 프론트가 /friends를 비래핑 클라이언트(http)로 호출한다.
 * 래핑은 /v1/live-rooms·SFU 계열만의 규약이다.</p>
 *
 * <p>게스트 차단은 SecurityConfig(/api/friends/** hasRole("USER"))가 필터 단에서 처리한다.
 * 게스트는 RDB에 영속되지 않아(D5) 친구 관계를 가질 수 없다.</p>
 */
@RestController
@RequestMapping("/api/friends")
@RequiredArgsConstructor
public class FriendController {

    private final FriendService friendService;

    /** GET /friends — 친구 목록. presence·currentRoomId는 Redis presence:{userId}에서 온다. 접속 중인 친구가 위로 온다. */
    @GetMapping
    public List<FriendResponse> list(@AuthenticationPrincipal MemberPrincipal principal) {
        return friendService.listFriends(principal.id());
    }

    /** GET /friends/requests?direction=received|sent — 기본은 받은 요청. PENDING만 나온다. */
    @GetMapping("/requests")
    public List<FriendRequestItemResponse> requests(@AuthenticationPrincipal MemberPrincipal principal,
                                                    @RequestParam(defaultValue = "received") String direction) {
        return friendService.listRequests(principal.id(), "sent".equalsIgnoreCase(direction));
    }

    /** POST /friends/requests — 닉네임으로 친구 요청. */
    @PostMapping("/requests")
    @ResponseStatus(HttpStatus.CREATED)
    public FriendRequestItemResponse request(@AuthenticationPrincipal MemberPrincipal principal,
                                             @Valid @RequestBody CreateFriendRequest req) {
        return friendService.request(principal.id(), req);
    }

    /** PATCH /friends/requests/{requestId} — 받은 요청 수락/거절. */
    @PatchMapping("/requests/{requestId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void respond(@AuthenticationPrincipal MemberPrincipal principal,
                        @PathVariable Long requestId,
                        @Valid @RequestBody RespondFriendRequest req) {
        friendService.respond(principal.id(), requestId, req.action());
    }

    /** DELETE /friends/requests/{requestId} — 내가 보낸 요청 철회(명세 확장). */
    @DeleteMapping("/requests/{requestId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancel(@AuthenticationPrincipal MemberPrincipal principal,
                       @PathVariable Long requestId) {
        friendService.cancel(principal.id(), requestId);
    }

    /**
     * GET /friends/{friendId}/room — 친구가 있는 방 조회(-98).
     * 방에 없으면 roomId가 null로 내려간다. 경로 세그먼트 수가 달라 /requests와 충돌하지 않는다.
     */
    @GetMapping("/{friendId}/room")
    public FriendRoomResponse room(@AuthenticationPrincipal MemberPrincipal principal,
                                   @PathVariable Long friendId) {
        return friendService.findFriendRoom(principal.id(), friendId);
    }

    /** DELETE /friends/{friendId} — 친구 삭제. */
    @DeleteMapping("/{friendId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal MemberPrincipal principal,
                       @PathVariable Long friendId) {
        friendService.remove(principal.id(), friendId);
    }
}
