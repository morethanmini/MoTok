package ssafy.a706.backend.room;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.room.dto.RoomCreateRequest;
import ssafy.a706.backend.room.dto.RoomResponse;
import ssafy.a706.backend.room.dto.RoomSummaryResponse;
import ssafy.a706.backend.room.model.RoomParticipant;
import ssafy.a706.backend.room.model.RoomState;

import java.util.List;

@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRegistry registry;

    public RoomResponse create(AuthPrincipal principal, RoomCreateRequest req) {
        String gameCode = (req.gameCode() != null && !req.gameCode().isBlank()) ? req.gameCode() : null;
        RoomState room = registry.create(req.title(), req.maxPlayers(), gameCode, toParticipant(principal));
        return RoomResponse.from(room);
    }

    public List<RoomSummaryResponse> listWaiting() {
        return registry.listWaiting().stream().map(RoomSummaryResponse::from).toList();
    }

    public RoomResponse get(String roomId) {
        return RoomResponse.from(findRoom(roomId));
    }

    public RoomResponse join(AuthPrincipal principal, String roomId) {
        RoomState room = registry.join(roomId, toParticipant(principal));
        return RoomResponse.from(room);
    }

    /** 빠른 시작(MVP 스텁): 별자리 게임이 선택된 방을 즉시 생성. 매칭 로직은 이후 마일스톤. */
    public RoomResponse quickStart(AuthPrincipal principal) {
        RoomState room = registry.create(principal.displayName() + "님의 빠른 방", 4, "constellation", toParticipant(principal));
        return RoomResponse.from(room);
    }

    private RoomState findRoom(String roomId) {
        return registry.find(roomId).orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
    }

    private RoomParticipant toParticipant(AuthPrincipal principal) {
        return new RoomParticipant(principal.userId(), principal.displayName(), principal.isGuest(),
                System.currentTimeMillis());
    }
}
