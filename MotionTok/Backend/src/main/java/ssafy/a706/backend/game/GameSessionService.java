package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameProgressRequest;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.dto.PoseSubmitRequest;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.nio.charset.StandardCharsets;
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
 * 게임 세션 서버 (S15P11A706-116) — 타이머 권위·판정 수리·점수판.
 *
 * <p>타이머 권위: 라운드 시작/종료 시각(epoch millis)은 서버가 확정해 GAME_START로 배포하고,
 * 종료 시각에 스케줄러가 정산(GAME_END)을 브로드캐스트한다. 클라이언트 타이머는 표시용.</p>
 *
 * <p>판정: 랜드마크 분석·점수 계산은 각 클라이언트가 수행하고(브라우저 로컬 MediaPipe),
 * 서버는 범위 클램프 + 참가자당 최초 1회 제출만 수리한다. 전 참가자 제출 시 조기 정산.</p>
 *
 * <p>세션 상태는 Redis(game:session:*)에 두지만 종료 스케줄은 인메모리(단일 인스턴스 전제,
 * simple broker와 동일 제약). 서버 재시작으로 스케줄이 유실되면 stale 세션은 새 게임
 * 시작 시 덮어써 복구된다 — start()의 활성 판정이 endAt 경과를 함께 보는 이유.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GameSessionService {

    private static final String GAME_TOPIC = "/topic/rooms/%s/game";

    /** 게임①(핑거 스타) — 과제(challenge)가 별자리 키인 게임. */
    private static final long FINGER_STAR_GAME_ID = 1L;
    /** 게임① 부가 지표 stats 키 (-137 일반화 후 레거시 표기 유지용). */
    private static final String STAT_STARS_HIT = "starsHit";

    /** 게임④(몸 끼워 맞추기, S15P11A706-86) — 출제 페이즈가 있는 게임. */
    private static final long BODY_FIT_GAME_ID = 4L;
    /** 게임④ 출제 페이즈 길이 — FE config·기획 §3과 동기화. */
    private static final long BODY_FIT_SETTING_MILLIS = 5_000;
    /** 게임④ 난이도 → 벽 접근 시간(ms) — FE config.difficulty와 동기화. */
    private static final Map<String, Long> BODY_FIT_APPROACH_MILLIS =
            Map.of("easy", 6_000L, "normal", 5_000L, "hard", 4_000L);
    /** 포즈 payload 상한 — 랜드마크 33점 JSON은 ~2KB, 여유 4배 (§9-2). */
    private static final int MAX_POSE_PAYLOAD_BYTES = 8_192;

    /**
     * 별자리 과제 후보(핑거 스타 콘텐츠) — 게임① 전용 챌린지 풀.
     * FE constellations.ts와 동기화 필수 — 별자리 추가·삭제 시 양쪽을 함께 갱신한다.
     */
    private static final Set<String> CONSTELLATION_KEYS = Set.of(
            "cassiopeia", "orion", "gemini",
            "big-dipper", "corona-borealis", "cepheus", "auriga", "lyra",
            "leo", "bootes", "scorpius", "taurus");

    /** endAt 경과 후 정산까지의 유예 — 마지막 순간 finish 프레임의 전송 지연 흡수. */
    private static final long END_GRACE_MILLIS = 1_500;

    private static final int MAX_STARS = 10;
    private static final int MAX_SCORE = 100;

    private final RoomMembershipReader membershipReader;
    private final LiveRoomRepository liveRoomRepository;
    private final GameSessionRepository sessionRepository;
    private final GameRepository gameRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final TaskScheduler gameTaskScheduler;
    private final ApplicationEventPublisher eventPublisher;

    /** 조기 종료 시 취소할 라운드 종료 예약 (roomId → future). 인메모리 — 단일 인스턴스 전제. */
    private final Map<String, ScheduledFuture<?>> endTasks = new ConcurrentHashMap<>();

    /** 방장 게임 시작 → 세션 생성·방 잠금·GAME_START 브로드캐스트·정산 예약. */
    public void start(String roomId, GameStartRequest request, AuthPrincipal sender) {
        // 1) 인가 — 방 존재·참가·방장 권한을 먼저 본다(비방장에게 카탈로그를 노출하지 않는다).
        Map<Object, Object> roomFields = liveRoomRepository.findRoomFields(roomId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
        requireMembership(roomId, sender);
        if (!sender.userId().equals(roomFields.get("hostUserId"))) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        // 2) 게임 카탈로그 검증 — 하드코딩(Set.of(1L)) 대신 games 테이블. 라운드/카운트다운도 게임별 설정에서.
        Long gameId = request.gameId();
        if (gameId == null) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        Game game = gameRepository.findById(gameId)
                .filter(Game::isActive)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));
        // 3) 진행 중 세션 재시작 방지
        long now = System.currentTimeMillis();
        boolean activeExists = sessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, END_GRACE_MILLIS))
                .orElse(false);
        if (activeExists) {
            throw new BusinessException(ErrorCode.GAME_SESSION_ALREADY_ACTIVE);
        }

        String challenge = resolveChallenge(gameId, request);
        String sessionId = UUID.randomUUID().toString();
        long startAt = now + game.getCountdownSec() * 1000L;

        // 게임④(-86, -48): 라운드 = 출제 5s + 벽 접근(난이도별). 출제자는 참가 순(joinedAt)으로
        // 로테이션 — 전원이 한 번씩 출제자를 맡을 때까지 endRound가 자동으로 다음 라운드를 연다.
        String difficulty = null;
        String setterUserId = null;
        List<String> setterOrder = List.of();
        long endAt;
        if (gameId == BODY_FIT_GAME_ID) {
            difficulty = request.difficulty() != null
                    && BODY_FIT_APPROACH_MILLIS.containsKey(request.difficulty())
                    ? request.difficulty() : "easy";
            setterOrder = liveRoomRepository.findMembers(roomId).stream()
                    .sorted(Comparator.comparingLong(LiveRoomMemberValue::joinedAt))
                    .map(LiveRoomMemberValue::userId)
                    .toList();
            // 게임④(-9): 출제자는 관전하는 룰 — 1인 방이면 플레이어가 0명이라 라운드가
            // 성립하지 않는다. FE가 혼자일 땐 로컬 연습 모드로 돌리므로 여기 도달은 레이스뿐.
            if (setterOrder.size() < 2) {
                throw new BusinessException(ErrorCode.GAME_NEED_MORE_PLAYERS);
            }
            setterUserId = setterOrder.isEmpty() ? sender.userId() : setterOrder.get(0);
            endAt = startAt + BODY_FIT_SETTING_MILLIS + BODY_FIT_APPROACH_MILLIS.get(difficulty);
            sessionRepository.clearTotals(roomId);
        } else {
            endAt = startAt + game.getRoundDurationSec() * 1000L;
        }

        GameSession session = new GameSession(sessionId, gameId, challenge, setterUserId,
                startAt, endAt, GameSession.STATUS_PLAYING, setterOrder, 0, difficulty);
        sessionRepository.saveSession(roomId, session);
        liveRoomRepository.updateStatus(roomId, "PLAYING");

        // constellationKey는 게임① FE 하위호환 필드 — 게임①일 때만 challenge와 같은 값
        String legacyConstellationKey = gameId == FINGER_STAR_GAME_ID ? challenge : null;
        Integer roundNo = setterOrder.isEmpty() ? null : 1;
        Integer totalRounds = setterOrder.isEmpty() ? null : setterOrder.size();
        broadcast(roomId, GameEventResponse.gameStart(
                sessionId, gameId, challenge, legacyConstellationKey, setterUserId, difficulty,
                now, startAt, endAt, roundNo, totalRounds));
        scheduleEnd(roomId, sessionId, 0, endAt + END_GRACE_MILLIS);
        log.info("game session started: room={} session={} game={} challenge={} setter={}",
                roomId, sessionId, gameId, challenge, setterUserId);
    }

    /**
     * 게임④ 출제자 포즈 수리(-86) — challenge 저장 + POSE_SET 재방송.
     * 각 클라이언트가 받은 랜드마크를 같은 렌더 함수에 넣으므로 전원이 동일한 벽을 본다(§9-2).
     */
    public void submitPose(String roomId, PoseSubmitRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        if (session.gameId() != BODY_FIT_GAME_ID || session.setterUserId() == null) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        if (!sender.userId().equals(session.setterUserId())) {
            throw new BusinessException(ErrorCode.GAME_NOT_SETTER);
        }
        String pose = request.pose();
        if (pose == null || pose.isBlank()
                || pose.getBytes(StandardCharsets.UTF_8).length > MAX_POSE_PAYLOAD_BYTES) {
            throw new BusinessException(ErrorCode.GAME_POSE_INVALID);
        }
        sessionRepository.updateChallenge(roomId, pose);
        broadcast(roomId, GameEventResponse.poseSet(session.sessionId(), sender.userId(), pose));
        log.info("pose set: room={} session={} setter={} bytes={}",
                roomId, session.sessionId(), sender.userId(), pose.length());
    }

    /** 라운드 중 진행 상황 중계 — 저장 없음, 클램프 후 방 토픽으로 재방송. */
    public void progress(String roomId, GameProgressRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        int starsLit = clamp(request.starsLit() == null ? 0 : request.starsLit(), 0, MAX_STARS);
        double holdProgress = clampDouble(request.holdProgress() == null ? 0 : request.holdProgress());
        broadcast(roomId, GameEventResponse.progress(
                session.sessionId(), sender.userId(), sender.displayName(), starsLit, holdProgress));
    }

    /** 참가자 최종 제출 수리(최초 1회) → PLAYER_FINISHED 브로드캐스트, 전원 제출 시 조기 정산. */
    public void finish(String roomId, GameFinishRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        // 게임④(-9): 출제자는 이번 라운드에 플레이하지 않는다 — 제출해도 조용히 무시.
        if (session.gameId() == BODY_FIT_GAME_ID && sender.userId().equals(session.setterUserId())) {
            return;
        }
        int score = clamp(request.score() == null ? 0 : request.score(), 0, MAX_SCORE);
        int starsHit = clamp(request.starsHit() == null ? 0 : request.starsHit(), 0, MAX_STARS);
        GamePlayerScore playerScore = new GamePlayerScore(
                sender.userId(), sender.displayName(), score,
                Map.of(STAT_STARS_HIT, starsHit), System.currentTimeMillis());
        // 최초 제출만 수리 — 재제출·중복 프레임은 조용히 무시(브로드캐스트도 없음).
        if (!sessionRepository.saveScoreIfAbsent(roomId, playerScore)) {
            return;
        }
        broadcast(roomId, GameEventResponse.playerFinished(
                session.sessionId(), sender.userId(), sender.displayName(), score, starsHit));

        long memberCount = liveRoomRepository.findMembers(roomId).size();
        // 게임④는 출제자를 뺀 인원만큼만 제출하면 조기 정산.
        long requiredCount = session.gameId() == BODY_FIT_GAME_ID && session.setterUserId() != null
                ? Math.max(0, memberCount - 1) : memberCount;
        if (requiredCount > 0 && sessionRepository.countScores(roomId) >= requiredCount) {
            endRound(roomId, session.sessionId(), session.roundIndex());
        }
    }

    /**
     * 라운드 정산 — 스케줄러(시간 종료)와 finish(전원 완주)가 모두 호출할 수 있어
     * Redis SETNX 가드로 1회만 실행된다. 미제출 참가자는 0점 미완주로 포함.
     *
     * <p>게임④ 로테이션(-48): 이번 라운드 점수를 누적(totals)에 더한 뒤, 아직 출제 안 한
     * 참가자가 남아있으면 GAME_END 대신 다음 라운드 GAME_START를 연다. 전원이 한 번씩
     * 출제자를 마치면 그때 누적 점수로 최종 GAME_END를 배포한다.</p>
     */
    private void endRound(String roomId, String sessionId, int roundIndex) {
        if (!sessionRepository.tryAcquireEndGuard(roomId, sessionId, roundIndex)) {
            return;
        }
        cancelScheduledEnd(roomId);
        GameSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.sessionId().equals(sessionId) || session.roundIndex() != roundIndex) {
            return; // 이미 다음 라운드/새 세션으로 대체된 stale 예약
        }

        boolean rotates = session.gameId() == BODY_FIT_GAME_ID && !session.setterOrder().isEmpty();
        if (rotates) {
            sessionRepository.findScores(roomId)
                    .forEach((userId, s) -> sessionRepository.addToTotal(roomId, userId, s.score()));
            int nextRoundIndex = nextSetterIndex(roomId, session);
            if (nextRoundIndex < session.setterOrder().size()) {
                startNextRound(roomId, session, nextRoundIndex);
                return;
            }
        }

        sessionRepository.markEnded(roomId);
        liveRoomRepository.updateStatus(roomId, "WAITING");

        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<GameResultEntry> results = rotates
                ? rankByTotal(members, sessionRepository.findTotals(roomId), session.setterOrder())
                : rank(members, sessionRepository.findScores(roomId));
        broadcast(roomId, GameEventResponse.gameEnd(sessionId, results));
        // write-behind 정산(-117) — 회원 결과 leaderboards 적재 + rank ZSET 갱신은 비동기 리스너에 위임.
        // endRound가 SETNX 가드로 1회만 실행되므로 정산도 1회 발행된다.
        eventPublisher.publishEvent(new GameSettledEvent(session.gameId(), results));
        log.info("game session ended: room={} session={} players={}", roomId, sessionId, members.size());
    }

    /** setterOrder에서 다음 출제자 인덱스 — 그새 방을 나간 참가자는 건너뛴다. */
    private int nextSetterIndex(String roomId, GameSession session) {
        int idx = session.roundIndex() + 1;
        while (idx < session.setterOrder().size()
                && !membershipReader.isMember(roomId, session.setterOrder().get(idx))) {
            idx++;
        }
        return idx;
    }

    /** 로테이션(-48) 다음 라운드 시작 — 클라 요청 없이 서버가 자동으로 다음 출제자를 지정한다. */
    private void startNextRound(String roomId, GameSession prev, int roundIndex) {
        String setterUserId = prev.setterOrder().get(roundIndex);
        long now = System.currentTimeMillis();
        long startAt = now;
        long endAt = startAt + BODY_FIT_SETTING_MILLIS + BODY_FIT_APPROACH_MILLIS.get(prev.difficulty());
        GameSession next = new GameSession(prev.sessionId(), prev.gameId(), null, setterUserId,
                startAt, endAt, GameSession.STATUS_PLAYING, prev.setterOrder(), roundIndex, prev.difficulty());
        sessionRepository.saveSession(roomId, next);
        broadcast(roomId, GameEventResponse.gameStart(
                prev.sessionId(), prev.gameId(), null, null, setterUserId, prev.difficulty(),
                now, startAt, endAt, roundIndex + 1, prev.setterOrder().size()));
        scheduleEnd(roomId, prev.sessionId(), roundIndex, endAt + END_GRACE_MILLIS);
        log.info("game round advanced: room={} session={} round={} setter={}",
                roomId, prev.sessionId(), roundIndex, setterUserId);
    }

    /** 점수 내림차순(동점은 먼저 제출한 쪽 우선) 순위. 방에 남은 전원 포함 — 미제출자는 0점. */
    private List<GameResultEntry> rank(List<LiveRoomMemberValue> members, Map<String, GamePlayerScore> scores) {
        record Row(String userId, String nickname, int score, int starsHit, boolean finished, long finishedAt) {}
        List<Row> rows = new ArrayList<>();
        for (LiveRoomMemberValue m : members) {
            GamePlayerScore s = scores.get(m.userId());
            if (s != null) {
                rows.add(new Row(m.userId(), s.nickname(), s.score(), s.starsHit(), true, s.finishedAt()));
            } else {
                rows.add(new Row(m.userId(), m.displayName(), 0, 0, false, Long.MAX_VALUE));
            }
        }
        rows.sort(Comparator.comparingInt(Row::score).reversed()
                .thenComparingLong(Row::finishedAt));
        int playerCount = rows.size();
        List<GameResultEntry> results = new ArrayList<>(playerCount);
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            int rankNo = i + 1;
            int pointsEarned = PointCalculator.calc(rankNo, r.score(), playerCount);
            results.add(new GameResultEntry(
                    rankNo, r.userId(), r.nickname(), r.score(), r.starsHit(), r.finished(), pointsEarned));
        }
        return results;
    }

    /**
     * 게임④ 로테이션(-48) 최종 순위 — 라운드별 GamePlayerScore가 아니라 누적 총점(totals)으로 매긴다.
     * 동점자는 출제 순서(setterOrder)가 빠른 쪽을 우선한다.
     */
    private List<GameResultEntry> rankByTotal(
            List<LiveRoomMemberValue> members, Map<String, Integer> totals, List<String> setterOrder) {
        record Row(String userId, String nickname, int score, int orderIdx) {}
        List<Row> rows = new ArrayList<>();
        for (LiveRoomMemberValue m : members) {
            int score = totals.getOrDefault(m.userId(), 0);
            int orderIdx = setterOrder.indexOf(m.userId());
            rows.add(new Row(m.userId(), m.displayName(), score, orderIdx < 0 ? Integer.MAX_VALUE : orderIdx));
        }
        rows.sort(Comparator.comparingInt(Row::score).reversed()
                .thenComparingInt(Row::orderIdx));
        int playerCount = rows.size();
        List<GameResultEntry> results = new ArrayList<>(playerCount);
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            int rankNo = i + 1;
            int pointsEarned = PointCalculator.calc(rankNo, r.score(), playerCount);
            // 전원이 로테이션에 참가했으므로 finished=true, starsHit은 게임④와 무관해 0.
            results.add(new GameResultEntry(rankNo, r.userId(), r.nickname(), r.score(), 0, true, pointsEarned));
        }
        return results;
    }

    private void scheduleEnd(String roomId, String sessionId, int roundIndex, long atMillis) {
        cancelScheduledEnd(roomId);
        ScheduledFuture<?> future = gameTaskScheduler.schedule(
                () -> {
                    try {
                        endRound(roomId, sessionId, roundIndex);
                    } catch (Exception e) {
                        log.error("game round settlement failed: room={} session={}", roomId, sessionId, e);
                    }
                },
                Instant.ofEpochMilli(atMillis));
        endTasks.put(roomId, future);
    }

    private void cancelScheduledEnd(String roomId) {
        ScheduledFuture<?> prev = endTasks.remove(roomId);
        if (prev != null) {
            prev.cancel(false);
        }
    }

    private GameSession requireActiveSession(String roomId) {
        return sessionRepository.findSession(roomId)
                .filter(s -> s.isPlaying(System.currentTimeMillis(), END_GRACE_MILLIS))
                .orElseThrow(() -> new BusinessException(ErrorCode.SESSION_NOT_FOUND));
    }

    private void requireMembership(String roomId, AuthPrincipal sender) {
        if (!membershipReader.existsRoom(roomId)) {
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!membershipReader.isMember(roomId, sender.userId())) {
            throw new BusinessException(ErrorCode.GAME_NOT_IN_ROOM);
        }
    }

    /**
     * 게임별 과제(challenge) 결정 (-137).
     * 게임①: 별자리 키(요청값 검증, 없으면 무작위). 그 외(게임④ 등 출제 페이즈가 있는
     * 게임): 시작 시점에는 과제가 없다 — 세션 도중 updateChallenge로 채워진다(§9-2).
     */
    private String resolveChallenge(long gameId, GameStartRequest request) {
        if (gameId == FINGER_STAR_GAME_ID) {
            return resolveConstellation(request.constellationKey());
        }
        return null;
    }

    private String resolveConstellation(String requested) {
        if (requested != null && CONSTELLATION_KEYS.contains(requested)) {
            return requested;
        }
        List<String> keys = List.copyOf(CONSTELLATION_KEYS);
        return keys.get(ThreadLocalRandom.current().nextInt(keys.size()));
    }

    private void broadcast(String roomId, GameEventResponse event) {
        messagingTemplate.convertAndSend(String.format(GAME_TOPIC, roomId), event);
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private double clampDouble(double value) {
        return Math.max(0.0, Math.min(1.0, value));
    }
}
