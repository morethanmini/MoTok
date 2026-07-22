package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomResponse;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomByInviteCodeRequest;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;
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
        validatePasswordRule(req.visibility(), req.password());

        String roomId = repository.generateUniqueRoomId();
        long now = System.currentTimeMillis();

        String inviteCode = repository.generateUniqueInviteCode();

        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("title", req.title());
        fields.put("visibility", req.visibility().name());
        fields.put("maxPlayers", String.valueOf(req.maxPlayers()));
        fields.put("status", "WAITING");
        fields.put("hostUserId", principal.userId());
        fields.put("hostDisplayName", principal.displayName());
        fields.put("createdAt", String.valueOf(now));
        fields.put("inviteCode", inviteCode);
        if (req.visibility() == LiveRoomVisibility.PRIVATE) {
            fields.put("password", req.password());
        }
        repository.saveRoom(roomId, fields);
        repository.addMember(roomId, playerKey(principal), principal.userId(), principal.displayName(),
                principal.isGuest(), now);
        repository.indexRoom(roomId, now);
        repository.saveInviteCode(inviteCode, roomId);

        LiveRoom room = new LiveRoom(roomId, req.title(), req.visibility(), req.maxPlayers(), "WAITING",
                principal.userId(), principal.displayName(), now, inviteCode, req.password(), List.of());
        return CreateLiveRoomResponse.from(room);
    }

    /**
     * 게스트 1인방 자동 생성(-109) — 정원 1, 공개 목록 미노출(rooms:index 미등록), 초대코드·비밀번호 없음.
     * 방 데이터(room:{roomId})는 존재하므로 게스트 본인은 roomId로 접근할 수 있다.
     */
    public String createGuestSoloRoom(AuthPrincipal principal) {
        String roomId = repository.generateUniqueRoomId();
        long now = System.currentTimeMillis();

        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("title", principal.displayName() + "의 1인방");
        fields.put("visibility", LiveRoomVisibility.PRIVATE.name());
        fields.put("maxPlayers", "1");
        fields.put("status", "WAITING");
        fields.put("hostUserId", principal.userId());
        fields.put("hostDisplayName", principal.displayName());
        fields.put("createdAt", String.valueOf(now));
        repository.saveRoom(roomId, fields);
        repository.addMember(roomId, playerKey(principal), principal.userId(), principal.displayName(),
                principal.isGuest(), now);
        return roomId;
    }

    public List<LiveRoomSummaryResponse> list() {
        List<LiveRoomSummaryResponse> result = new ArrayList<>();
        for (String roomId : repository.listRoomIdsNewestFirst(PUBLIC_LIST_LIMIT)) {
            repository.findRoomFields(roomId)
                    .map(fields -> toLiveRoom(roomId, fields, repository.findMembers(roomId)))
                    .ifPresentOrElse(
                            room -> result.add(LiveRoomSummaryResponse.from(room)),
                            () -> repository.removeFromIndex(roomId) // 죽은 방 lazy 청소
                    );
        }
        return result;
    }

    public LiveRoomDetailResponse get(String roomId) {
        LiveRoom room = loadRoom(roomId);
        return LiveRoomDetailResponse.from(room);
    }

    public LiveRoomDetailResponse join(AuthPrincipal principal, String roomId, JoinLiveRoomRequest req) {
        LiveRoom room = loadRoom(roomId);
        if (room.hasPassword() && !room.password().equals(req.password())) {
            if (req.password() == null) {
                throw new BusinessException(ErrorCode.ROOM_PASSWORD_REQUIRED);
            }
            throw new BusinessException(ErrorCode.ROOM_INVALID_PASSWORD);
        }
        return joinRoom(principal, room);
    }

    public LiveRoomDetailResponse joinByInviteCode(AuthPrincipal principal, JoinLiveRoomByInviteCodeRequest req) {
        String roomId = repository.findRoomIdByInviteCode(req.inviteCode())
                .orElseThrow(() -> new BusinessException(ErrorCode.INVITE_CODE_NOT_FOUND));
        LiveRoom room = loadRoom(roomId);
        return joinRoom(principal, room);
    }

    private LiveRoomDetailResponse joinRoom(AuthPrincipal principal, LiveRoom room) {
        String key = playerKey(principal);
        if (!repository.hasMember(room.roomId(), key) && room.participantCount() >= room.maxPlayers()) {
            throw new BusinessException(ErrorCode.ROOM_FULL);
        }
        repository.addMember(room.roomId(), key, principal.userId(), principal.displayName(),
                principal.isGuest(), System.currentTimeMillis());
        return LiveRoomDetailResponse.from(loadRoom(room.roomId()));
    }

    private LiveRoom loadRoom(String roomId) {
        Map<Object, Object> fields = repository.findRoomFields(roomId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
        return toLiveRoom(roomId, fields, repository.findMembers(roomId));
    }

    private void validatePasswordRule(LiveRoomVisibility visibility, String password) {
        if (visibility == LiveRoomVisibility.PRIVATE && (password == null || password.isBlank())) {
            throw new BusinessException(ErrorCode.ROOM_PASSWORD_REQUIRED, "비공개방은 6자리 비밀번호 설정이 필요합니다.");
        }
        if (visibility == LiveRoomVisibility.PUBLIC && password != null) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "공개방은 비밀번호를 설정할 수 없습니다.");
        }
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
                (String) fields.get("password"),
                members
        );
    }

    /** 회원은 u:{userId}, 게스트는 g:{guestId} — 회원/게스트 참가자를 하나의 문자열 규격으로 통일. */
    private String playerKey(AuthPrincipal principal) {
        return (principal.isGuest() ? "g:" : "u:") + principal.userId();
    }
}
