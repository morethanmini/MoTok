package ssafy.a706.backend.chat;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.chat.dto.ChatMessageResponse;
import ssafy.a706.backend.global.response.ApiResponse;

import java.util.List;

/**
 * 채팅 이력 REST 조회(-164 후속) — 재입장(새로고침) 시 방 채팅 복원용.
 *
 * <p>채팅 발신·방송은 STOMP({@link ChatController})지만, 이력은 "입장 시 1회 스냅샷"이라
 * REST가 맞다. 응답 원소는 STOMP 브로드캐스트와 같은 {@link ChatMessageResponse} —
 * FE가 실시간 수신과 동일한 파서로 소화한다. 방 멤버만 조회할 수 있다.</p>
 */
@RestController
@RequiredArgsConstructor
public class ChatHistoryController {

    private final ChatService chatService;

    @GetMapping("/api/v1/live-rooms/{roomId}/chats")
    public ApiResponse<List<ChatMessageResponse>> history(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String roomId) {
        return ApiResponse.ok(chatService.history(roomId, principal));
    }
}
