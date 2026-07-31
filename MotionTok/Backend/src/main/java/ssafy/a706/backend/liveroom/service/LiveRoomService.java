package ssafy.a706.backend.liveroom.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

@Slf4j
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
        // 방을 만드는 것도 입장이다 — 입장 경로와 같은 규칙을 받는다(계정당 한 방).
        leaveOtherRoom(principal, playerKey(principal), roomId);
        repository.addMember(roomId, playerKey(principal), principal.userId(), principal.displayName(),
                principal.isGuest(), now);
        repository.saveInviteCode(inviteCode, roomId);

        LiveRoom room = new LiveRoom(roomId, req.title(), req.visibility(), req.maxPlayers(), "WAITING",
                principal.userId(), principal.displayName(), now, inviteCode, req.password(),
                List.of(new LiveRoomMemberValue(principal.userId(), principal.displayName(),
                        principal.isGuest(), now)));
        // 여기서는 rooms:index에 넣지 않는다 — 방이 로비에 뜨는 건 방장이 실제로 방에 들어온 뒤다(open 참고).
        return CreateLiveRoomResponse.from(room);
    }

    /**
     * 방을 로비 목록에 공개한다 — 방장이 게임방에 실제로 입장한 순간 클라이언트가 호출한다.
     *
     * <h4>왜 생성 시점이 아닌가</h4>
     * 방을 만든 사람은 곧바로 게임방에 오지 않는다. 기기 점검 화면(카메라·마이크 권한)을 먼저 거치는데,
     * 생성 시점에 목록에 띄우면 그동안 아무나 들어올 수 있다. 들어와 봐야 시작 권한을 가진 사람이 없어
     * 게임도 못 하고 방장을 부를 수단도 없이 기다리기만 해야 한다 — 방장이 권한 창에서 손을 놓고 있으면
     * 그 방은 무기한 유령방이 된다. 공개를 "방장이 방 안에 있다"가 확인된 시점으로 미루면 그 구간이
     * 목록에서 통째로 빠진다. 초대코드로 직접 들어오는 사람은 여전히 먼저 도착할 수 있지만, 그건
     * 스스로 고른 대기이고 화면에도 방장 대기 안내가 뜬다.
     *
     * <p>멱등하다 — ZADD라 새로고침·재입장으로 여러 번 불려도 결과가 같고, 중복 알림만 막으면 된다.
     * 방장이 위임된 경우(-72)에도 새 방장의 클라이언트가 같은 경로로 부른다.</p>
     *
     * <p>score는 공개 시각이 아니라 생성 시각이다 — 목록 정렬 기준("최신 생성 순", -124)을 바꾸지 않는다.</p>
     */
    public void open(AuthPrincipal principal, String roomId) {
        LiveRoom room = loadRoom(roomId);
        if (!room.hostUserId().equals(principal.userId())) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        // 게스트 1인방(-109)은 애초에 목록에 뜨지 않는 방이다. 초대코드가 없다는 게 그 표식이고,
        // 그 방의 방장(=게스트 본인)도 게임방에 들어오므로 여기서 걸러 두지 않으면 목록에 새 나간다.
        if (room.inviteCode() == null) {
            return;
        }
        if (repository.isIndexed(roomId)) {
            return; // 이미 공개된 방 — 또 알리면 로비에 같은 카드가 두 번 튄다
        }
        repository.indexRoom(roomId, room.createdAt());
        // 로비에 앉아 있는 사람들에게 새 방을 알린다(-148).
        lobbyBroadcaster.roomCreated(LiveRoomSummaryResponse.from(room));
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
        processLeave(roomId, principal.userId(), principal.displayName(), key);
    }

    /**
     * 유령 멤버 강제 퇴장(-164 후속) — 스위퍼가 "프레즌스가 완전히 끊긴 회원"을 내보낼 때 쓴다.
     * 본인 요청(leave)과 동일한 후처리(브로드캐스트·방장 이양·빈방 삭제)를 태우므로,
     * 남은 참가자·로비 화면 어디에서도 일반 퇴장과 구별되지 않는다.
     */
    public void evictGhostMember(String roomId, LiveRoomMemberValue member) {
        String key = playerKey(member.userId(), member.guest());
        cancelPendingUnloadLeave(roomId, key);
        processLeave(roomId, member.userId(), member.displayName(), key);
    }

    /**
     * 한 계정은 한 방에만 — 다른 방에 있었으면 거기서 먼저 나온다.
     *
     * <h4>왜 필요한가</h4>
     * 방 멤버십은 <b>방마다</b> 관리돼서, 같은 방에 두 번 들어가는 것은 막히지만 서로 다른 방
     * 여러 개에 동시에 들어가는 것은 아무도 막지 않았다. 계정 하나로 방 100개를 점유할 수 있다는
     * 뜻이고, 방마다 SFU 퍼블리셔가 하나씩 붙으므로 비용이 방 수에 비례해 늘어난다. 부하보다 먼저
     * 나타나는 피해는 <b>방 스쿼팅</b>이다 — 공개방을 점유해 두면 빠른시작·매칭이 실제 사용자에게
     * 돌아가지 않는다. {@code RoomPresenceTracker}는 이미 "한 연결은 한 방"을 전제하고 있었는데,
     * 계정 단위로는 그 전제가 없었다.
     *
     * <h4>왜 거절이 아니라 자동 퇴장인가</h4>
     * 제품상 한 번에 한 방만 플레이하므로, 새 방을 고른 것은 곧 옛 방을 뜨겠다는 뜻이다. 거절하면
     * 눈에 보이지도 않는 옛 멤버십(유령·다른 탭) 때문에 입장이 막혀 빠져나올 방법이 없어진다.
     * 자동 퇴장은 {@link #leave}와 같은 경로를 타므로 방장 이양·빈방 삭제·퇴장 방송이 그대로 돈다 —
     * 남은 참가자에게는 그냥 평범한 퇴장으로 보인다.
     *
     * <p>이미 사라진 방을 가리키는 색인(방이 TTL로 죽었는데 기록만 남은 경우)은 조용히 넘긴다 —
     * 여기서 던지면 멀쩡한 입장이 옛 흔적 때문에 실패한다.</p>
     */
    private void leaveOtherRoom(AuthPrincipal principal, String key, String targetRoomId) {
        String previousRoomId = repository.findRoomIdOfPlayer(key).orElse(null);
        if (previousRoomId == null || previousRoomId.equals(targetRoomId)) {
            return; // 아무 방에도 없거나, 지금 들어가려는 그 방이다(새로고침 복귀)
        }
        cancelPendingUnloadLeave(previousRoomId, key); // 옛 방의 언로드 유예 예약도 함께 접는다(-164)
        try {
            processLeave(previousRoomId, principal.userId(), principal.displayName(), key);
        } catch (BusinessException e) {
            log.info("이전 방 자동 퇴장 생략: room={} player={} — {}", previousRoomId, key, e.getMessage());
        }
    }

    /** 퇴장 공통 처리 — 멤버 제거·MEMBER_LEFT 방송·빈방 삭제·방장 이양. */
    private void processLeave(String roomId, String userId, String displayName, String key) {
        LiveRoom room = loadRoom(roomId); // 방 존재 검증(없으면 ROOM_NOT_FOUND)
        if (!repository.hasMember(roomId, key)) {
            return; // 이미 나간 상태 — 멱등 처리, 유령 브로드캐스트 방지
        }
        repository.removeMember(roomId, key);
        List<LiveRoomMemberValue> remaining = repository.findMembers(roomId);
        messagingTemplate.convertAndSend(
                String.format(MEMBERS_TOPIC, roomId),
                new LiveRoomMemberLeftEvent(userId, displayName, remaining.size()));

        if (remaining.isEmpty()) {
            // 게스트 1인방(-109)은 비워져도 방까지 지우지는 않는다. 이 방은 점유가 아니라 게스트 토큰의
            // 수명에 묶여 있다 — 로그인 때 한 번 받고 다시 받을 길이 없어서, 지우면 그 게스트는 남은
            // 세션 동안 어떤 게임도 시작할 수 없다(한 판 하고 나오면 두 번째 게임이 ROOM_NOT_FOUND).
            // 초대코드가 없다는 게 게스트 1인방의 표식이다(open 참고). 방 해시는 TTL 24h라 새지 않고,
            // 애초에 게스트가 들어오지 않은 1인방도 같은 TTL로 남으므로 늘어나는 몫은 없다.
            if (room.inviteCode() == null) {
                // 방은 남기되 게임은 접는다 — 세션이 살아 있으면 다음 시작이
                // GAME_SESSION_ALREADY_ACTIVE로 막히고, 게임 중에 나갔어도 빈 방은 다시 대기 상태다.
                eventPublisher.publishEvent(new LiveRoomClosedEvent(roomId));
                repository.updateStatus(roomId, "WAITING");
                return;
            }
            boolean wasListed = repository.isIndexed(roomId);
            repository.deleteRoom(roomId);
            eventPublisher.publishEvent(new LiveRoomClosedEvent(roomId));
            // rooms:index에 없는 방은 로비에 뜬 적이 없다 — 폐쇄 알림도 보낼 이유가 없다.
            // (방장이 기기 점검 화면에서 되돌아 나가 공개되지 않은 채 사라지는 방, open 참고)
            if (wasListed) {
                lobbyBroadcaster.roomClosed(roomId);
            }
            return;
        }
        lobbyBroadcaster.roomUpdated(LiveRoomSummaryResponse.from(loadRoom(roomId)));
        if (room.hostUserId().equals(userId)) {
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
        // 여기까지 왔으면 입장이 확정됐다 — 그때서야 있던 방을 뜬다. 거절(강퇴·게임중·정원초과)보다
        // 뒤에 두는 것이 핵심이다: 못 들어가는 방 때문에 멀쩡히 있던 방에서 쫓겨나면 안 된다.
        leaveOtherRoom(principal, key, room.roomId());
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
