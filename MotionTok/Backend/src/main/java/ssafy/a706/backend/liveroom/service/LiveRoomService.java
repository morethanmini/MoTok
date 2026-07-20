package ssafy.a706.backend.liveroom;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.dto.CreateLiveRoomRequest;
import ssafy.a706.backend.liveroom.dto.CreateLiveRoomResponse;
import ssafy.a706.backend.liveroom.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.dto.LiveRoomSummaryResponse;
import ssafy.a706.backend.liveroom.model.LiveRoom;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.model.LiveRoomVisibility;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class LiveRoomService {

    private static final int PUBLIC_LIST_LIMIT = 50;

    private final LiveRoomRepository repository;

    public CreateLiveRoomResponse create(AuthPrincipal principal, CreateLiveRoomRequest req) {
        String roomId = repository.generateUniqueRoomId();
        long now = System.currentTimeMillis();

        String inviteCode = req.visibility() == LiveRoomVisibility.PRIVATE
                ? repository.generateUniqueInviteCode()
                : null;

        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("title", req.title());
        fields.put("visibility", req.visibility().name());
        fields.put("maxPlayers", String.valueOf(req.maxPlayers()));
        fields.put("status", "WAITING");
        fields.put("hostUserId", principal.userId());
        fields.put("hostDisplayName", principal.displayName());
        fields.put("createdAt", String.valueOf(now));
        if (inviteCode != null) {
            fields.put("inviteCode", inviteCode);
        }
        repository.saveRoom(roomId, fields);
        repository.addMember(roomId, playerKey(principal), principal.userId(), principal.displayName(),
                principal.isGuest(), now);

        if (req.visibility() == LiveRoomVisibility.PUBLIC) {
            repository.indexPublicRoom(roomId, now);
        } else {
            repository.saveInviteCode(inviteCode, roomId);
        }

        LiveRoom room = new LiveRoom(roomId, req.title(), req.visibility(), req.maxPlayers(), "WAITING",
                principal.userId(), principal.displayName(), now, inviteCode, List.of());
        return CreateLiveRoomResponse.from(room);
    }

    public List<LiveRoomSummaryResponse> listPublic() {
        List<LiveRoomSummaryResponse> result = new ArrayList<>();
        for (String roomId : repository.listPublicRoomIdsNewestFirst(PUBLIC_LIST_LIMIT)) {
            repository.findRoomFields(roomId)
                    .map(fields -> toLiveRoom(roomId, fields, repository.findMembers(roomId)))
                    .ifPresentOrElse(
                            room -> result.add(LiveRoomSummaryResponse.from(room)),
                            () -> repository.removeFromPublicIndex(roomId) // 죽은 방 lazy 청소
                    );
        }
        return result;
    }

    public LiveRoomDetailResponse get(String roomId) {
        Map<Object, Object> fields = repository.findRoomFields(roomId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
        LiveRoom room = toLiveRoom(roomId, fields, repository.findMembers(roomId));
        return LiveRoomDetailResponse.from(room);
    }

    private LiveRoom toLiveRoom(String roomId, Map<Object, Object> fields, List<LiveRoomMemberValue> members) {
        return new LiveRoom(
                roomId,
                (String) fields.get("title"),
                LiveRoomVisibility.valueOf((String) fields.get("visibility")),
                Integer.parseInt((String) fields.get("maxPlayers")),
                (String) fields.get("status"),
                (String) fields.get("hostUserId"),
                (String) fields.get("hostDisplayName"),
                Long.parseLong((String) fields.get("createdAt")),
                (String) fields.get("inviteCode"),
                members
        );
    }

    /** 회원은 u:{userId}, 게스트는 g:{guestId} — 회원/게스트 참가자를 하나의 문자열 규격으로 통일. */
    private String playerKey(AuthPrincipal principal) {
        return (principal.isGuest() ? "g:" : "u:") + principal.userId();
    }
}
