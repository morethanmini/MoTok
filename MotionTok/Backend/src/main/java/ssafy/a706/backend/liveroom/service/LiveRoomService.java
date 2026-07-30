package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.event.LiveRoomClosedEvent;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.CreateLiveRoomResponse;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomByInviteCodeRequest;
import ssafy.a706.backend.liveroom.controller.dto.JoinLiveRoomRequest;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomDetailResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomHostChangedEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomListResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomMemberKickedEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomMemberLeftEvent;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomPasswordResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomSummaryResponse;
import ssafy.a706.backend.liveroom.controller.dto.LiveRoomUpdatedEvent;
import ssafy.a706.backend.liveroom.controller.dto.UpdateLiveRoomRequest;
import ssafy.a706.backend.liveroom.model.KickReason;
import ssafy.a706.backend.liveroom.model.LiveRoom;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.model.LiveRoomVisibility;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

@Service
@RequiredArgsConstructor
public class LiveRoomService {

    /** 인덱스 스캔 상한(방 목록·빠른 시작 공통). 공개/비밀 구분과 무관한 순수 스캔 캡이다. */
    private static final int LIST_SCAN_LIMIT = 50;

    private static final int PAGE_SIZE = 6;

    private static final String MEMBERS_TOPIC = "/topic/rooms/%s/members";

    /**
     * 언로드 퇴장 유예(-164). 새로고침도 pagehide라 leave가 즉시 날아오는데, 곧바로 같은 사람이
     * 재입장한다 — 즉시 제거하면 그 짧은 사이에 방장 이양·빈방 삭제가 일어나 "방장 탈취",
     * "방이 사라져 같은 이름 방 2개" 같은 부수효과가 났다. 이 시간 안에 재입장하면 없던 일로 한다.
     */
    private static final long UNLOAD_LEAVE_GRACE_MS = 10_000;

    private final LiveRoomRepository repository;
    private final SimpMessagingTemplate messagingTemplate;
    private final LobbyBroadcaster lobbyBroadcaster;
    private final ApplicationEventPublisher eventPublisher;
    private final TaskScheduler gameTaskScheduler;

    /** 언로드 유예 중인 퇴장 예약 (roomId|playerKey → future). 인메모리 — 단일 인스턴스 전제(게임 endTasks와 동일). */
    private final Map<String, ScheduledFuture<?>> pendingUnloadLeaves = new ConcurrentHashMap<>();

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
                principal.userId(), principal.displayName(), now, inviteCode, req.password(),
                List.of(new LiveRoomMemberValue(principal.userId(), principal.displayName(),
                        principal.isGuest(), now)));
        // 로비에 앉아 있는 사람들에게 새 방을 알린다(-148). 게스트 1인방은 rooms:index에 없어
        // 목록에 뜨지 않으므로 createGuestSoloRoom에는 이 훅이 없다.
        lobbyBroadcaster.roomCreated(LiveRoomSummaryResponse.from(room));
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

    /**
     * 로비 방 목록(S15P11A706-124). 페이지당 {@link #PAGE_SIZE}개, 최신 생성 방이 최상단.
     *
     * <p>공개방·비밀방을 모두 노출한다(2026-07-25 팀 회의 확정). 비밀방은 응답의
     * {@code hasPassword=true}로 구분되고, 입장 시 클라이언트가 비밀번호를 받아
     * {@link #join}으로 넘긴다 — 목록 자체는 비밀번호를 담지 않는다.
     *
     * ponytail: 기존 스캔 상한({@link #LIST_SCAN_LIMIT}) 안에서만 페이지네이션 — 방 수가
     * 그 캡을 넘어서면 뒷 페이지가 실제보다 적게 잡힐 수 있음, 그때 커서 기반으로 전환.
     */
    public LiveRoomListResponse list(int page) {
        int safePage = Math.max(page, 1);
        List<String> roomIds = List.copyOf(repository.listRoomIdsNewestFirst(LIST_SCAN_LIMIT));
        // 방마다 따로 읽으면 왕복이 방 수의 2배로 늘어난다 — 한 번에 묶어 온다.
        Map<String, LiveRoomRepository.RawRoom> loaded = repository.findRoomsInBulk(roomIds);

        List<LiveRoomSummaryResponse> all = new ArrayList<>();
        for (String roomId : roomIds) {
            LiveRoomRepository.RawRoom raw = loaded.get(roomId);
            if (raw == null) {
                repository.removeFromIndex(roomId); // 죽은 방 lazy 청소(ExpiredRoomSweeper가 주기적으로도 돈다)
                continue;
            }
            all.add(LiveRoomSummaryResponse.from(toLiveRoom(roomId, raw.fields(), raw.members())));
        }
        int from = Math.min((safePage - 1) * PAGE_SIZE, all.size());
        int to = Math.min(from + PAGE_SIZE, all.size());
        return new LiveRoomListResponse(all.subList(from, to), to < all.size());
    }

    public LiveRoomDetailResponse get(String roomId) {
        LiveRoom room = loadRoom(roomId);
        return LiveRoomDetailResponse.from(room);
    }

    /**
     * 방장이 방 설정 수정 폼을 열 때 기존 비밀번호를 되채우기 위해 조회한다(S15P11A706-130).
     * 방장만 허용 — 참가자에게 비밀번호를 노출하면 강퇴 후 재입장 차단(-73)이 무의미해진다.
     * 공개방이면 null.
     */
    public LiveRoomPasswordResponse getPassword(AuthPrincipal principal, String roomId) {
        LiveRoom room = loadRoom(roomId);
        if (!room.hostUserId().equals(principal.userId())) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        return new LiveRoomPasswordResponse(room.password());
    }

    public LiveRoomDetailResponse join(AuthPrincipal principal, String roomId, JoinLiveRoomRequest req) {
        LiveRoom room = loadRoom(roomId);
        // 재입장(새로고침 복귀, -164)은 비밀번호를 다시 묻지 않는다 — 이미 검증을 통과해
        // 들어와 있던 사람이고, 복귀 화면은 비밀번호를 들고 있지 않다.
        boolean rejoining = repository.hasMember(roomId, playerKey(principal));
        if (!rejoining && room.hasPassword() && !room.password().equals(req.password())) {
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
        for (String roomId : repository.listRoomIdsNewestFirst(LIST_SCAN_LIMIT)) {
            repository.findRoomFields(roomId)
                    .map(fields -> toLiveRoom(roomId, fields, repository.findMembers(roomId)))
                    // 공개방만 후보로 둔다 — quickStart는 joinRoom()을 직접 호출해 비밀번호를
                    // 검증하지 않으므로(검증은 join()에만 있다), 이 필터를 지우면 비밀번호 없이
                    // 비밀방에 들어가진다. 비밀방까지 포함해야 한다면 "방 선정"과 "입장"을
                    // 2단계 API로 분리해야 한다. (2026-07-25 회의: 빠른 참가는 공개방 only)
                    //
                    // ponytail: 스캔 상한(LIST_SCAN_LIMIT)은 공개·비밀을 함께 세므로, 비밀방이
                    // 최신 50개를 대부분 차지하면 그 뒤의 공개방을 못 보고 QUICK_START_NO_ROOM이
                    // 날 수 있다. 비밀방 비중이 커지면 인덱스를 공개/비밀로 분리하거나 상한을 올린다.
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
        String key = playerKey(principal);
        cancelPendingUnloadLeave(roomId, key); // 명시적 퇴장이 유예 예약보다 우선한다(-164)
        LiveRoom room = loadRoom(roomId); // 방 존재 검증(없으면 ROOM_NOT_FOUND)
        if (!repository.hasMember(roomId, key)) {
            return; // 이미 나간 상태 — 멱등 처리, 유령 브로드캐스트 방지
        }
        repository.removeMember(roomId, key);
        List<LiveRoomMemberValue> remaining = repository.findMembers(roomId);
        messagingTemplate.convertAndSend(
                String.format(MEMBERS_TOPIC, roomId),
                new LiveRoomMemberLeftEvent(principal.userId(), principal.displayName(), remaining.size()));

        if (remaining.isEmpty()) {
            boolean wasListed = repository.isIndexed(roomId);
            repository.deleteRoom(roomId);
            eventPublisher.publishEvent(new LiveRoomClosedEvent(roomId));
            // 게스트 1인방은 rooms:index에 없어 로비에 뜬 적이 없다 — 폐쇄 알림도 보낼 이유가 없다.
            if (wasListed) {
                lobbyBroadcaster.roomClosed(roomId);
            }
            return;
        }
        lobbyBroadcaster.roomUpdated(LiveRoomSummaryResponse.from(loadRoom(roomId)));
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
     * 문서 언로드(pagehide) 퇴장 통보 — 즉시 나가지 않고 {@link #UNLOAD_LEAVE_GRACE_MS} 유예를 둔다(-164).
     *
     * <p>새로고침도 pagehide이므로 이 경로로 leave가 온다. 유예 안에 같은 사람이 재입장
     * ({@link #joinRoom})하면 예약이 철회돼 방장·멤버십이 그대로 유지되고, 재입장이 없으면
     * (진짜 탭 닫기) 유예 뒤 일반 {@link #leave}가 실행된다 — 퇴장 브로드캐스트·방장 이양·
     * 빈방 삭제가 그때 일어난다.</p>
     */
    public void leaveOnUnload(AuthPrincipal principal, String roomId) {
        String key = playerKey(principal);
        if (!repository.hasMember(roomId, key)) {
            return; // 멤버가 아니면 예약할 것도 없다(멱등)
        }
        String pendingKey = pendingUnloadKey(roomId, key);
        ScheduledFuture<?> future = gameTaskScheduler.schedule(
                () -> {
                    pendingUnloadLeaves.remove(pendingKey);
                    try {
                        leave(principal, roomId);
                    } catch (BusinessException ignored) {
                        // 유예 사이 방이 사라진 경우(ROOM_NOT_FOUND) — 정리할 것이 없다
                    }
                },
                Instant.ofEpochMilli(System.currentTimeMillis() + UNLOAD_LEAVE_GRACE_MS));
        ScheduledFuture<?> prev = pendingUnloadLeaves.put(pendingKey, future);
        if (prev != null) {
            prev.cancel(false);
        }
    }

    private void cancelPendingUnloadLeave(String roomId, String playerKey) {
        ScheduledFuture<?> pending = pendingUnloadLeaves.remove(pendingUnloadKey(roomId, playerKey));
        if (pending != null) {
            pending.cancel(false);
        }
    }

    private String pendingUnloadKey(String roomId, String playerKey) {
        return roomId + "|" + playerKey;
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
            eventPublisher.publishEvent(new LiveRoomClosedEvent(roomId));
            lobbyBroadcaster.roomClosed(roomId);
            return;
        }
        lobbyBroadcaster.roomUpdated(LiveRoomSummaryResponse.from(loadRoom(roomId)));
    }

    /**
     * 방장이 대기실에서 방 정보(제목·공개여부·최대인원·비밀번호)를 수정한다(S15P11A706-130).
     * WAITING 상태에서만 허용하고, 전체 필드를 재전송받아 create와 동일한 검증({@link #validatePasswordRule})을 재사용한다.
     * TTL은 갱신하지 않아 방은 최초 생성 시점부터 24h 카운트다운을 유지한다.
     * ponytail: maxPlayers 축소 검증은 read-then-write라 검증~쓰기 사이 join이 끼면 순간 정원 초과가 가능하다 —
     * 기존 join/quickStart의 ROOM_FULL과 동일한 check-then-act 수준이고, 방당 동시 쓰기 상한이 낮아(방장 1명+정원 ≤8)
     * 현행 유지한다. 처리량이 커지면 Redis Lua로 원자화.
     */
    public LiveRoomDetailResponse update(AuthPrincipal principal, String roomId, UpdateLiveRoomRequest req) {
        LiveRoom room = loadRoom(roomId);
        if (!room.hostUserId().equals(principal.userId())) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        if (!"WAITING".equals(room.status())) {
            throw new BusinessException(ErrorCode.ROOM_GAME_IN_PROGRESS);
        }
        validatePasswordRule(req.visibility(), req.password());
        if (req.maxPlayers() < room.participantCount()) {
            throw new BusinessException(ErrorCode.ROOM_MAX_PLAYERS_BELOW_CURRENT);
        }

        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("title", req.title());
        fields.put("visibility", req.visibility().name());
        fields.put("maxPlayers", String.valueOf(req.maxPlayers()));
        if (req.visibility() == LiveRoomVisibility.PRIVATE) {
            fields.put("password", req.password());
        }
        repository.updateRoomInfo(roomId, fields, req.visibility() == LiveRoomVisibility.PUBLIC);

        messagingTemplate.convertAndSend(
                String.format(MEMBERS_TOPIC, roomId),
                new LiveRoomUpdatedEvent(req.title(), req.visibility().name(), req.maxPlayers()));

        LiveRoom updated = loadRoom(roomId);
        lobbyBroadcaster.roomUpdated(LiveRoomSummaryResponse.from(updated));
        return LiveRoomDetailResponse.from(updated);
    }

    /**
     * 방 상태(WAITING↔PLAYING) 전환 — 게임·리듬 세션이 시작·정산할 때 부른다.
     *
     * <p>종전에는 각 세션 서비스가 {@code LiveRoomRepository.updateStatus}를 직접 불렀다.
     * 로비 실시간 갱신(-148)이 생기면서 "상태가 바뀌면 로비에도 알린다"가 따라붙는데, 그 한 줄을
     * 호출부 여섯 곳에 흩뿌리면 새 게임이 추가될 때마다 빠뜨릴 자리가 하나씩 늘어난다.
     * 상태 전환을 서비스 메서드 하나로 모아 두면 알림 누락이 구조적으로 불가능해진다.</p>
     */
    public void changeStatus(String roomId, String status) {
        // 정산 타이머는 방이 이미 삭제된 뒤에도 발화할 수 있다(마지막 인원이 게임 중 이탈, -164).
        // 그대로 HSET하면 삭제된 해시가 status 필드 하나만 가진 좀비 키(TTL 없음)로 부활하고,
        // 그 방의 조회는 전부 NPE로 죽는다. 방이 없으면 조용히 끝낸다.
        if (repository.findRoomFields(roomId).isEmpty()) {
            return;
        }
        repository.updateStatus(roomId, status);
        repository.findRoomFields(roomId)
                .map(fields -> toLiveRoom(roomId, fields, repository.findMembers(roomId)))
                .map(LiveRoomSummaryResponse::from)
                .ifPresent(lobbyBroadcaster::roomUpdated);
    }

    private LiveRoomDetailResponse joinRoom(AuthPrincipal principal, LiveRoom room) {
        String key = playerKey(principal);
        // 새로고침 복귀(-164) — 언로드 유예 중이면 퇴장 예약을 철회한다(없던 일로).
        cancelPendingUnloadLeave(room.roomId(), key);
        if (repository.isKicked(room.roomId(), key)) {
            throw new BusinessException(ErrorCode.ROOM_KICKED);
        }
        // 재입장(이미 멤버)인지 한 번만 확인한다 — 같은 값을 두 번 물어보면 입장마다 Redis 왕복이 하나 더 늘고,
        // 두 조회 사이에 상태가 갈리면 판정이 어긋날 여지도 생긴다.
        boolean rejoining = repository.hasMember(room.roomId(), key);
        if (!rejoining && !"WAITING".equals(room.status())) {
            throw new BusinessException(ErrorCode.ROOM_GAME_IN_PROGRESS);
        }
        if (!rejoining && room.participantCount() >= room.maxPlayers()) {
            throw new BusinessException(ErrorCode.ROOM_FULL);
        }
        repository.addMember(room.roomId(), key, principal.userId(), principal.displayName(),
                principal.isGuest(), System.currentTimeMillis());
        LiveRoom joined = loadRoom(room.roomId());
        // 입장은 지금까지 로비에 아무 신호도 주지 않던 구간이다 — 정원이 찬 방을 계속 눌러 보는
        // 원인이었다. join·초대코드·빠른시작이 모두 이 메서드를 지나므로 여기 한 곳이면 된다.
        lobbyBroadcaster.roomUpdated(LiveRoomSummaryResponse.from(joined));
        return LiveRoomDetailResponse.from(joined);
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
