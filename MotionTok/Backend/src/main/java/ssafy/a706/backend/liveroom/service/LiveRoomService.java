package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.LiveRoomProperties;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomResponse;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomByInviteCodeRequest;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomHostChangedEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomMemberKickedEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomMemberLeftEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;
import ssafy.a706.backend.liveroom.model.KickReason;
import ssafy.a706.backend.liveroom.model.LiveRoom;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.model.LiveRoomVisibility;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class LiveRoomService {

    private static final int PUBLIC_LIST_LIMIT = 50;

    private static final String MEMBERS_TOPIC = "/topic/rooms/%s/members";

    private final LiveRoomRepository repository;
    private final SimpMessagingTemplate messagingTemplate;
    private final LiveRoomProperties properties;

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
        return CreateLiveRoomResponse.from(room, properties.inviteLinkBaseUrl());
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
                            room -> {
                                if (room.visibility() == LiveRoomVisibility.PUBLIC) {
                                    result.add(LiveRoomSummaryResponse.from(room));
                                }
                            },
                            () -> repository.removeFromIndex(roomId) // 죽은 방 lazy 청소
                    );
        }
        return result;
    }

    public LiveRoomDetailResponse get(String roomId) {
        LiveRoom room = loadRoom(roomId);
        return LiveRoomDetailResponse.from(room, properties.inviteLinkBaseUrl());
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

    /**
     * 빠른 시작(랜덤 매칭, S15P11A706-27). 조건(공개·대기중·정원 여유·강퇴 안 됨) 맞는 방을 무작위 순서로
     * 시도해 첫 성공한 방에 입장한다. 스캔과 입장 사이 다른 요청이 먼저 채웠으면(ROOM_FULL 등) 다음
     * 후보로 넘어간다 — 새 원자성 보장 없이 기존 joinRoom() 가드를 재시도 트리거로 재사용.
     * 조건에 맞는 방이 하나도 없거나 전부 실패하면 자동 생성 없이 에러만 반환한다.
     */
    public LiveRoomDetailResponse quickStart(AuthPrincipal principal) {
        String key = playerKey(principal);
        List<LiveRoom> candidates = new ArrayList<>();
        for (String roomId : repository.listRoomIdsNewestFirst(PUBLIC_LIST_LIMIT)) {
            repository.findRoomFields(roomId)
                    .map(fields -> toLiveRoom(roomId, fields, repository.findMembers(roomId)))
                    .filter(room -> room.visibility() == LiveRoomVisibility.PUBLIC)
                    .filter(room -> "WAITING".equals(room.status()))
                    .filter(room -> room.participantCount() < room.maxPlayers())
                    .filter(room -> !repository.isKicked(roomId, key))
                    .ifPresent(candidates::add);
        }
        Collections.shuffle(candidates);

        for (LiveRoom room : candidates) {
            try {
                return joinRoom(principal, room);
            } catch (BusinessException e) {
                // 스캔 이후 다른 요청이 먼저 채웠거나 상태가 바뀐 경우 — 다음 후보로 넘어간다
            }
        }
        throw new BusinessException(ErrorCode.QUICK_START_NO_ROOM);
    }

    /**
     * 참가자는 언제든 방을 나갈 수 있다(S15P11A706-71).
     * 마지막 인원이 나가면 방을 즉시 종료하고, 방장이 나가면 남은 참가자 중 입장 순으로 위임한다(S15P11A706-72).
     */
    public void leave(AuthPrincipal principal, String roomId) {
        LiveRoom room = loadRoom(roomId); // 방 존재 검증(없으면 ROOM_NOT_FOUND)
        String key = playerKey(principal);
        if (!repository.hasMember(roomId, key)) {
            return; // 이미 나간 상태 — 멱등 처리, 유령 브로드캐스트 방지
        }
        repository.removeMember(roomId, key);
        List<LiveRoomMemberValue> remaining = repository.findMembers(roomId);
        messagingTemplate.convertAndSend(
                String.format(MEMBERS_TOPIC, roomId),
                new LiveRoomMemberLeftEvent(principal.userId(), principal.displayName(), remaining.size()));

        if (remaining.isEmpty()) {
            repository.deleteRoom(roomId);
            return;
        }
        if (room.hostUserId().equals(principal.userId())) {
            LiveRoomMemberValue newHost = remaining.stream()
                    .min(Comparator.comparingLong(LiveRoomMemberValue::joinedAt))
                    .orElseThrow();
            repository.updateHost(roomId, newHost.userId(), newHost.displayName());
            messagingTemplate.convertAndSend(
                    String.format(MEMBERS_TOPIC, roomId),
                    new LiveRoomHostChangedEvent(newHost.userId(), newHost.displayName()));
        }
    }

    /**
     * 방장이 참가자를 강퇴한다(S15P11A706-73). 강퇴된 참가자는 재입장 차단 목록에 등록되어
     * 방이 유지되는 동안 어떤 경로(roomId 직접 입장·초대코드)로도 재입장할 수 없다({@link #joinRoom}).
     */
    public void kick(AuthPrincipal host, String roomId, String targetUserId, KickReason reason) {
        LiveRoom room = loadRoom(roomId);
        if (!room.hostUserId().equals(host.userId())) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        if (targetUserId.equals(host.userId())) {
            throw new BusinessException(ErrorCode.ROOM_CANNOT_KICK_SELF);
        }
        LiveRoomMemberValue target = room.members().stream()
                .filter(m -> m.userId().equals(targetUserId))
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_MEMBER_NOT_FOUND));

        String key = playerKey(target.userId(), target.guest());
        repository.removeMember(roomId, key);
        repository.addKicked(roomId, key);

        List<LiveRoomMemberValue> remaining = repository.findMembers(roomId);
        messagingTemplate.convertAndSend(
                String.format(MEMBERS_TOPIC, roomId),
                new LiveRoomMemberKickedEvent(target.userId(), target.displayName(), reason, remaining.size()));

        if (remaining.isEmpty()) {
            repository.deleteRoom(roomId);
        }
    }

    private LiveRoomDetailResponse joinRoom(AuthPrincipal principal, LiveRoom room) {
        String key = playerKey(principal);
        if (repository.isKicked(room.roomId(), key)) {
            throw new BusinessException(ErrorCode.ROOM_KICKED);
        }
        if (!repository.hasMember(room.roomId(), key) && !"WAITING".equals(room.status())) {
            throw new BusinessException(ErrorCode.ROOM_GAME_IN_PROGRESS);
        }
        if (!repository.hasMember(room.roomId(), key) && room.participantCount() >= room.maxPlayers()) {
            throw new BusinessException(ErrorCode.ROOM_FULL);
        }
        repository.addMember(room.roomId(), key, principal.userId(), principal.displayName(),
                principal.isGuest(), System.currentTimeMillis());
        return LiveRoomDetailResponse.from(loadRoom(room.roomId()), properties.inviteLinkBaseUrl());
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
        return playerKey(principal.userId(), principal.isGuest());
    }

    private String playerKey(String userId, boolean guest) {
        return (guest ? "g:" : "u:") + userId;
    }
}
