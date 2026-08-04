package ssafy.a706.backend.rhythm;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.GameSessionService;
import ssafy.a706.backend.game.GameSettledEvent;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.liveroom.event.LiveRoomClosedEvent;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.rhythm.dto.RhythmEventResponse;
import ssafy.a706.backend.rhythm.dto.RhythmRequests;
import ssafy.a706.backend.rhythm.dto.RhythmResultEntry;
import ssafy.a706.backend.rhythm.model.RhythmPlayerScore;
import ssafy.a706.backend.rhythm.model.RhythmSession;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 캐치캐치리듬 세션 서버 — 시드 배포·타이머 권위·정산.
 *
 * <p><b>전용 채널이다.</b> 기존 {@code GameSessionService}와 로직이 비슷해 보여도 공유하지 않는다.
 * 게임마다 세션 필드·이벤트 페이로드·점수 스케일이 달라서, 하나를 여섯 게임이 나눠 쓰면
 * 필드가 계속 늘고 MR이 충돌한다. 중복을 감수하고 격리하는 쪽이 이 팀에선 싸다.</p>
 *
 * <p><b>시드</b>: 서버가 난수 하나를 뽑아 방 전원에게 배포하고, 각 클라이언트가 같은
 * 결정적 생성기로 같은 채보를 만든다. 채보 자체를 서버가 만들어 보내지 않는 이유는
 * 페이로드가 크고(노트 수백 개) 생성기가 이미 클라이언트에 있기 때문이다.</p>
 *
 * <p><b>신뢰 모델</b>: 판정·점수 계산은 클라이언트가 하고 서버는 범위 클램프 + 참가자당
 * 최초 1회 제출만 수리한다(핑거 스타와 동일).</p>
 *
 * <p>정산은 {@link GameSettledEvent}로 기존 리스너에 위임한다 — 리더보드 적재·랭킹 ZSET·
 * 솔로/멀티 판정이 그대로 재사용된다. 호출만 하고 그쪽 코드는 고치지 않는다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RhythmSessionService {

    private static final String TOPIC = "/topic/rooms/%s/rhythm";

    /** endAt 경과 후 정산까지의 유예 — 마지막 순간 finish 프레임의 전송 지연 흡수. */
    private static final long END_GRACE_MILLIS = 1_500;

    /**
     * 점수 상한(치팅 방어) — 모든 슬롯이 동시 노트인 극단 가정.
     * 60초 라운드: (60000-3000)/250 슬롯 × 2 × 100점 × 2.0배 = 91,200.
     * 난이도별로 나누지 않는다 — difficulty를 위조하면 우회할 수 있기 때문.
     */
    private static final int MAX_SCORE = 91_200;
    private static final int MAX_COMBO = 5_000;
    private static final int MAX_NOTES = 5_000;

    /**
     * 곡 지정 라운드(-168)의 <b>채보별</b> 이론 최대 점수 — 전 노트 Perfect일 때의 값이다.
     *
     * <p>{@link #MAX_SCORE}는 60초 랜덤 채보 기준으로 잡힌 값이라 곡 지정 라운드에는 맞지 않는다.
     * 어려움(풀)은 127초를 돌지만 노트가 233개뿐이라 만점이 41,200이고, 상한 91,200은 만점의
     * 2.2배다 — 그 틈만큼 위조 여지가 열린다. 상품이 걸린 이벤트 보드(S15P11A706-186)에서는
     * 불가능한 점수가 1위로 박히는 사고가 되므로 채보별로 조인다.</p>
     *
     * <p>값은 프론트 채보(`public/assets/charts/&lt;id&gt;/bundle.json`)에서 계산한 것이다 —
     * 노트 수 N, Perfect 100점, 콤보 10마다 배율 +0.1(최대 2.0). <b>채보를 고치면 이 값도 같이
     * 고쳐야 한다.</b> 목록에 없는 곡은 MAX_SCORE로 폴백한다(막지 않고 넘어간다 — 새 채보가
     * 올라왔을 때 정상 점수를 0으로 잘라 버리는 쪽이 더 나쁘다).</p>
     */
    private static final Map<String, Integer> SONG_MAX_SCORE = Map.of(
            "ssafy-fighting-manual", 41_200,        // 233노트 · 127.2s
            "ssafy-fighting-manual-verse1", 25_000, // 152노트 · 79.9s
            "ssafy-fighting-extreme", 63_400        // 344노트 · 80.4s
    );

    /** 이 라운드에 허용할 점수 상한. 곡 지정 라운드면 그 채보의 만점, 아니면 랜덤 채보 상한. */
    private static int maxScoreOf(String songId) {
        return songId == null ? MAX_SCORE : SONG_MAX_SCORE.getOrDefault(songId, MAX_SCORE);
    }

    private static final Set<String> DIFFICULTIES = Set.of("EASY", "NORMAL", "HARD");
    private static final String DEFAULT_DIFFICULTY = "NORMAL";
    /** 캐치 = 기본 모드, 링 = 마이마이 */
    private static final Set<String> MODES = Set.of("catch", "ring", "ringTap");
    private static final String DEFAULT_MODE = "catch";

    private final RoomMembershipReader membershipReader;
    private final LiveRoomRepository liveRoomRepository;
    /** 방 상태 전환은 서비스 경유 — 로비 실시간 갱신(-148) 알림이 그 안에 붙어 있다. */
    private final LiveRoomService liveRoomService;
    private final RhythmSessionRepository sessionRepository;
    /** 공용 게임 세션 상태 조회 — 교차 중복 시작 차단(-164) 전용. 도메인 지식은 넘기지 않는다. */
    private final GameSessionService gameSessionService;
    /** 카탈로그 노출 제어(-106) 확인용 — 관리자가 닫은 게임은 리듬 채널로도 시작되지 않아야 한다. */
    private final GameRepository gameRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final TaskScheduler rhythmTaskScheduler;
    private final ApplicationEventPublisher eventPublisher;

    /** 조기 종료 시 취소할 라운드 종료 예약 (roomId → future). 단일 인스턴스 전제. */
    private final Map<String, ScheduledFuture<?>> endTasks = new ConcurrentHashMap<>();

    /** 방장이 라운드 시작 → 시드 발급 → RHYTHM_START 배포 → 정산 예약. */
    public void start(String roomId, RhythmRequests.Start request, AuthPrincipal sender) {
        Map<Object, Object> roomFields = liveRoomRepository.findRoomFields(roomId)
                .orElseThrow(RhythmException::roomNotFound);
        requireMembership(roomId, sender);
        if (!sender.userId().equals(roomFields.get("hostUserId"))) {
            throw RhythmException.notHost();
        }

        long now = System.currentTimeMillis();
        boolean activeExists = sessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, END_GRACE_MILLIS))
                .orElse(false);
        if (activeExists) {
            throw RhythmException.alreadyActive();
        }
        // 공용 게임 세션(핑거스타 등)이 진행/준비 중이면 리듬을 겹쳐 시작할 수 없다(-164).
        // 저장소가 따로라 여기서 교차 확인하지 않으면 게임 위에 게임을 얹을 수 있었다
        // (반대 방향은 GameSessionService.start가 확인한다).
        if (gameSessionService.isSessionActiveOrPreparing(roomId)) {
            throw RhythmException.alreadyActive();
        }
        // 카탈로그 노출 제어(-106) — 전용 채널이라 games 테이블을 안 보고 있었다. 이걸 빼면
        // 관리자가 캐치캐치리듬을 닫아도 리듬만 계속 시작된다(공용 게임은 GameSessionService가 막는다).
        Game game = gameRepository.findById(RhythmGameSeeder.GAME_ID)
                .orElseThrow(RhythmException::gameNotFound);
        if (!game.isActive()) {
            throw RhythmException.gameClosed();
        }

        // 곡 지정 라운드(-168): 채보 랩에서 만든 번들 채보를 전원이 로드한다.
        // 서버는 songId를 검증·중계하고 라운드 길이만 곡 길이로 잡는다 — 채보 자체는
        // 정적 자산이라 시드 없이도 전원이 동일하다.
        String song = sanitizeSong(request == null ? null : request.song());
        String difficulty = song != null
                ? resolveSongDifficulty(request.difficulty())
                : resolveDifficulty(request == null ? null : request.difficulty());
        String mode = resolveMode(request == null ? null : request.mode());
        long seed = ThreadLocalRandom.current().nextLong();
        String sessionId = UUID.randomUUID().toString();
        long startAt = now + RhythmGameSeeder.COUNTDOWN_SEC * 1000L;
        long durationMillis = song != null
                ? clampDurationSec(request.durationSec()) * 1000L
                : RhythmGameSeeder.ROUND_DURATION_SEC * 1000L;
        long endAt = startAt + durationMillis;

        sessionRepository.saveSession(roomId, new RhythmSession(
                sessionId, seed, difficulty, mode, song, startAt, endAt, RhythmSession.STATUS_PLAYING));
        liveRoomService.changeStatus(roomId, "PLAYING");

        broadcast(roomId, RhythmEventResponse.start(sessionId, seed, difficulty, mode, song, now, startAt, endAt));
        scheduleEnd(roomId, sessionId, endAt + END_GRACE_MILLIS);
        log.info("rhythm session started: room={} session={} mode={} difficulty={} song={} seed={}",
                roomId, sessionId, mode, difficulty, song, seed);
    }

    /** 라운드 중 실시간 점수 중계 — 저장 없이 클램프 후 재방송. */
    public void progress(String roomId, RhythmRequests.Progress request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        RhythmSession session = requireActiveSession(roomId);
        int score = clamp(request == null ? null : request.score(), maxScoreOf(session.songId()));
        int combo = clamp(request == null ? null : request.combo(), MAX_COMBO);
        broadcast(roomId, RhythmEventResponse.progress(
                session.sessionId(), sender.userId(), sender.displayName(), score, combo));
    }

    /** 최종 제출(최초 1회) → PLAYER_FINISHED, 전원 제출 시 조기 정산. */
    public void finish(String roomId, RhythmRequests.Finish request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        RhythmSession session = requireActiveSession(roomId);

        RhythmPlayerScore playerScore = new RhythmPlayerScore(
                sender.userId(),
                sender.displayName(),
                clamp(request == null ? null : request.score(), maxScoreOf(session.songId())),
                clamp(request == null ? null : request.maxCombo(), MAX_COMBO),
                clamp(request == null ? null : request.perfect(), MAX_NOTES),
                clamp(request == null ? null : request.good(), MAX_NOTES),
                clamp(request == null ? null : request.miss(), MAX_NOTES),
                System.currentTimeMillis());

        // 최초 제출만 수리 — 재제출·중복 프레임은 조용히 무시한다.
        if (!sessionRepository.saveScoreIfAbsent(roomId, playerScore)) {
            return;
        }
        broadcast(roomId, RhythmEventResponse.playerFinished(session.sessionId(),
                sender.userId(), sender.displayName(), playerScore.score(), playerScore.maxCombo()));

        long memberCount = liveRoomRepository.findMembers(roomId).size();
        if (memberCount > 0 && sessionRepository.countScores(roomId) >= memberCount) {
            endRound(roomId, session.sessionId());
        }
    }

    /**
     * 방장 강제종료(-164) — 정산 없이 라운드를 접는다. 공용 게임의 {@code /game/abort}와 대칭이다.
     *
     * <p>이 수단이 없던 동안, 방장이 리듬 도중 화면을 닫아도 세션은 endAt까지 살아 있었다.
     * 그 사이 방은 PLAYING에 묶이고 다음 게임 시작은 GAME_SESSION_ALREADY_ACTIVE로 거절됐다
     * (GameSessionService.start가 rhythmActive를 함께 보기 때문).</p>
     */
    public void abort(String roomId, AuthPrincipal sender) {
        Map<Object, Object> roomFields = liveRoomRepository.findRoomFields(roomId)
                .orElseThrow(RhythmException::roomNotFound);
        requireMembership(roomId, sender);
        if (!sender.userId().equals(roomFields.get("hostUserId"))) {
            throw RhythmException.notHost();
        }
        RhythmSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.isPlaying(System.currentTimeMillis(), END_GRACE_MILLIS)) {
            return; // 이미 정산됐거나 세션 없음 — 멱등(시작 화면에서 눌러도 안전)
        }
        // 정산 타이머·전원 완주 조기 정산과 경합해도 가드를 선점한 한쪽만 실행된다.
        if (!sessionRepository.tryAcquireEndGuard(roomId, session.sessionId())) {
            return;
        }
        cancelScheduledEnd(roomId);
        sessionRepository.markEnded(roomId);
        liveRoomService.changeStatus(roomId, "WAITING");
        broadcast(roomId, RhythmEventResponse.aborted(session.sessionId()));
        log.info("rhythm session aborted by host: room={} session={}", roomId, session.sessionId());
    }

    /**
     * 라운드 정산 — 타이머와 "전원 완주"가 모두 호출할 수 있어 Redis SETNX 가드로 1회만 실행된다.
     * 미제출 참가자는 0점 미완주로 포함한다.
     */
    void endRound(String roomId, String sessionId) {
        if (!sessionRepository.tryAcquireEndGuard(roomId, sessionId)) {
            return;
        }
        cancelScheduledEnd(roomId);
        RhythmSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.sessionId().equals(sessionId)) {
            return; // 이미 새 세션으로 대체된 stale 예약
        }
        sessionRepository.markEnded(roomId);
        liveRoomService.changeStatus(roomId, "WAITING");

        Map<String, RhythmPlayerScore> scores = sessionRepository.findScores(roomId);
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<RhythmResultEntry> results = rank(members, scores);
        broadcast(roomId, RhythmEventResponse.end(sessionId, results));

        // 리더보드 적재·랭킹 ZSET·솔로/멀티 판정은 기존 정산 리스너에 위임한다(호출만, 수정 없음).
        // 리스너는 pointsEarned를 재계산하지 않고 그대로 싣는다 → 리듬 전용 포인트가 유지된다.
        // 곡 지정 라운드면 songId를 실어 보낸다 — 곡별 이벤트 보드(-186)가 이걸로 갈린다.
        eventPublisher.publishEvent(new GameSettledEvent(
                sessionId, RhythmGameSeeder.GAME_ID, session.songId(), toSettlement(results)));
        log.info("rhythm session ended: room={} session={} players={} submitted={}",
                roomId, sessionId, members.size(), scores.size());
    }

    /** 점수 내림차순(동점은 먼저 제출한 쪽 우선). 방에 남은 전원 포함 — 미제출자는 0점. */
    private List<RhythmResultEntry> rank(List<LiveRoomMemberValue> members,
                                         Map<String, RhythmPlayerScore> scores) {
        record Row(String userId, String nickname, RhythmPlayerScore score, long finishedAt) {}
        List<Row> rows = new ArrayList<>();
        for (LiveRoomMemberValue m : members) {
            RhythmPlayerScore s = scores.get(m.userId());
            rows.add(s != null
                    ? new Row(m.userId(), s.nickname(), s, s.finishedAt())
                    : new Row(m.userId(), m.displayName(), null, Long.MAX_VALUE));
        }
        rows.sort(Comparator.comparingInt((Row r) -> r.score() == null ? 0 : r.score().score())
                .reversed()
                .thenComparingLong(Row::finishedAt));

        int playerCount = rows.size();
        List<RhythmResultEntry> results = new ArrayList<>(playerCount);
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            RhythmPlayerScore s = r.score();
            int rankNo = i + 1;
            int score = s == null ? 0 : s.score();
            results.add(new RhythmResultEntry(
                    rankNo, r.userId(), r.nickname(), score,
                    s == null ? 0 : s.maxCombo(),
                    s == null ? 0 : s.perfect(),
                    s == null ? 0 : s.good(),
                    s == null ? 0 : s.miss(),
                    s != null,
                    RhythmPointCalculator.calc(rankNo, score, playerCount)));
        }
        return results;
    }

    /** 정산 리스너가 먹는 형태로 변환 — starsHit 자리에 최대 콤보를 싣는다. */
    private List<GameResultEntry> toSettlement(List<RhythmResultEntry> results) {
        List<GameResultEntry> out = new ArrayList<>(results.size());
        for (RhythmResultEntry r : results) {
            out.add(new GameResultEntry(r.rank(), r.userId(), r.nickname(),
                    r.score(), r.maxCombo(), r.finished(), r.pointsEarned(), null));
        }
        return out;
    }

    private void scheduleEnd(String roomId, String sessionId, long atMillis) {
        cancelScheduledEnd(roomId);
        ScheduledFuture<?> future = rhythmTaskScheduler.schedule(() -> {
            try {
                endRound(roomId, sessionId);
            } catch (Exception e) {
                log.error("rhythm settlement failed: room={} session={}", roomId, sessionId, e);
            }
        }, Instant.ofEpochMilli(atMillis));
        endTasks.put(roomId, future);
    }

    private void cancelScheduledEnd(String roomId) {
        ScheduledFuture<?> prev = endTasks.remove(roomId);
        if (prev != null) {
            prev.cancel(false);
        }
    }

    /** 방 폐쇄(-164) — 사라진 방의 정산 예약을 정리한다(게임 세션과 동일한 이유). */
    @EventListener
    public void onRoomClosed(LiveRoomClosedEvent event) {
        cancelScheduledEnd(event.roomId());
    }

    private RhythmSession requireActiveSession(String roomId) {
        return sessionRepository.findSession(roomId)
                .filter(s -> s.isPlaying(System.currentTimeMillis(), END_GRACE_MILLIS))
                .orElseThrow(RhythmException::sessionNotFound);
    }

    private void requireMembership(String roomId, AuthPrincipal sender) {
        if (!membershipReader.existsRoom(roomId)) {
            throw RhythmException.roomNotFound();
        }
        if (!membershipReader.isMember(roomId, sender.userId())) {
            throw RhythmException.notInRoom();
        }
    }

    /** 알 수 없는 난이도는 거부하지 않고 NORMAL로 폴백한다(형제 필드 constellationKey와 같은 관례). */
    private String resolveDifficulty(String requested) {
        return requested != null && DIFFICULTIES.contains(requested) ? requested : DEFAULT_DIFFICULTY;
    }

    /** 곡 지정 라운드는 수제 난이도(MANUAL/EXTREME)까지 허용한다(-168). */
    private String resolveSongDifficulty(String requested) {
        boolean tapped = "MANUAL".equals(requested) || "EXTREME".equals(requested);
        return tapped || (requested != null && DIFFICULTIES.contains(requested))
                ? requested
                : DEFAULT_DIFFICULTY;
    }

    /** 곡 지정 라운드의 songId — 클라이언트 자산 경로 조각이 되므로 소문자·숫자·하이픈만. */
    private static String sanitizeSong(String requested) {
        return requested != null && requested.matches("[a-z0-9-]{1,64}") ? requested : null;
    }

    /** 곡 지정 라운드 길이(초) — 위조 방지 클램프(30초~7분). 없으면 기본 라운드 길이. */
    private static long clampDurationSec(Integer requested) {
        if (requested == null) {
            return RhythmGameSeeder.ROUND_DURATION_SEC;
        }
        return Math.max(30, Math.min(420, requested));
    }

    private String resolveMode(String requested) {
        return requested != null && MODES.contains(requested) ? requested : DEFAULT_MODE;
    }

    private void broadcast(String roomId, RhythmEventResponse event) {
        messagingTemplate.convertAndSend(String.format(TOPIC, roomId), event);
    }

    private static int clamp(Integer value, int max) {
        if (value == null) {
            return 0;
        }
        return Math.max(0, Math.min(max, value));
    }
}
