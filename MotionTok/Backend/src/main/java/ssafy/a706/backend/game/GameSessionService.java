package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.DrawOp;
import ssafy.a706.backend.game.dto.GameDrawRequest;
import ssafy.a706.backend.game.dto.GameDrawResultRequest;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameProgressRequest;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
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

    /**
     * 별자리 과제 후보(핑거 스타 콘텐츠) — 게임1 전용. 공통 서버 밖(게임 모듈)으로 분리 대상.
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

    // ── 그림으로 말해요(게임 10) — 이어그리기 릴레이 (명세 v0.2.20) ──
    private static final long DRAW_GAME_ID = 10L;
    /** 차례 교대(핸드오버) 초 — FE DrawingRelayGame HANDOVER_SECONDS와 동기화 필수 */
    private static final int DRAW_HANDOVER_SEC = 3;
    /** endAt 이후 채점 결과(draw-result)를 기다리는 유예 — 초과 시 0점 협동 정산 */
    private static final long DRAW_JUDGE_WINDOW_MILLIS = 60_000;
    private static final int DRAW_MAX_OPS = 256;
    private static final int DRAW_MAX_GUESSES = 5;
    private static final int DRAW_MAX_GUESS_LEN = 40;
    /** 주제어 후보 — FE drawing-relay/words.ts와 동기화 필수(솔로 모드가 같은 목록을 쓴다). */
    private static final List<String> DRAW_TOPICS = List.of(
            "사과", "바나나", "수박", "포도", "딸기",
            "자동차", "버스", "비행기", "기차", "자전거", "로켓",
            "집", "나무", "꽃", "해바라기", "선인장",
            "고양이", "강아지", "토끼", "코끼리", "기린", "물고기", "나비", "새", "거북이", "공룡",
            "우산", "안경", "시계", "모자", "신발", "컵", "의자", "열쇠", "가위",
            "눈사람", "산", "해", "달", "별", "구름", "무지개",
            "피자", "케이크", "아이스크림", "축구공", "로봇");

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

        if (gameId == DRAW_GAME_ID) {
            startDrawSession(roomId, game, now);
            return;
        }

        String constellationKey = resolveConstellation(request.constellationKey());
        String sessionId = UUID.randomUUID().toString();
        long startAt = now + game.getCountdownSec() * 1000L;
        long endAt = startAt + game.getRoundDurationSec() * 1000L;
        GameSession session = new GameSession(sessionId, gameId, constellationKey,
                startAt, endAt, GameSession.STATUS_PLAYING);
        sessionRepository.saveSession(roomId, session);
        liveRoomRepository.updateStatus(roomId, "PLAYING");

        broadcast(roomId, GameEventResponse.gameStart(sessionId, gameId, constellationKey, now, startAt, endAt));
        scheduleEnd(roomId, sessionId, endAt + END_GRACE_MILLIS);
        log.info("game session started: room={} session={} game={} constellation={}",
                roomId, sessionId, gameId, constellationKey);
    }

    /**
     * 그림으로 말해요 시작 — 총 시간(games.roundDurationSec=240)을 인원수로 올림 분배한 턴 스케줄과
     * 주제어·화가 순서(셔플)를 확정해 GAME_START로 배포한다. 이후 턴 전환은 별도 이벤트 없이
     * 전 클라이언트가 서버 권위 시각으로 같은 스케줄을 계산한다. 정산은 draw-result 수리(협동 점수)
     * 또는 endAt+채점 유예 타임아웃(0점) 중 먼저 온 쪽이 1회 실행한다.
     */
    private void startDrawSession(String roomId, Game game, long now) {
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        if (members.isEmpty()) {
            throw new BusinessException(ErrorCode.GAME_NOT_IN_ROOM);
        }
        List<String> turnOrder = new ArrayList<>(members.stream().map(LiveRoomMemberValue::userId).toList());
        Collections.shuffle(turnOrder);
        int playerCount = turnOrder.size();
        int turnSec = (game.getRoundDurationSec() + playerCount - 1) / playerCount; // 나눠떨어지지 않으면 올림
        String topicWord = DRAW_TOPICS.get(ThreadLocalRandom.current().nextInt(DRAW_TOPICS.size()));

        String sessionId = UUID.randomUUID().toString();
        long startAt = now + game.getCountdownSec() * 1000L;
        long endAt = startAt + (long) playerCount * (DRAW_HANDOVER_SEC + turnSec) * 1000L;
        sessionRepository.saveSession(roomId, new GameSession(sessionId, DRAW_GAME_ID, null,
                startAt, endAt, GameSession.STATUS_PLAYING));
        liveRoomRepository.updateStatus(roomId, "PLAYING");

        broadcast(roomId, GameEventResponse.gameStartDraw(sessionId, DRAW_GAME_ID, now, startAt, endAt,
                topicWord, turnOrder, turnSec, DRAW_HANDOVER_SEC));
        scheduleEnd(roomId, sessionId, endAt + DRAW_JUDGE_WINDOW_MILLIS);
        log.info("draw session started: room={} session={} players={} turnSec={}",
                roomId, sessionId, playerCount, turnSec);
    }

    /** 그리기 릴레이(게임 10) — 저장 없음, 검증·클램프 후 방 토픽으로 재방송. 차례 강제는 클라이언트 몫. */
    public void draw(String roomId, GameDrawRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        if (session.gameId() != DRAW_GAME_ID) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        List<DrawOp> ops = request.ops();
        if (ops == null || ops.isEmpty()) {
            return;
        }
        if (ops.size() > DRAW_MAX_OPS) {
            ops = ops.subList(0, DRAW_MAX_OPS);
        }
        broadcast(roomId, GameEventResponse.draw(session.sessionId(), sender.userId(), request.seq(), ops));
    }

    /**
     * AI 채점 결과 수리(게임 10, 최초 1회) → DRAW_RESULT 방송 + 협동 정산.
     * 채점은 그리기 종료(endAt) 이후에 이뤄지므로 일반 유예 대신 채점 유예 안에서 수리한다.
     */
    public void drawResult(String roomId, GameDrawResultRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        long now = System.currentTimeMillis();
        GameSession session = sessionRepository.findSession(roomId)
                .filter(s -> s.isPlaying(now, DRAW_JUDGE_WINDOW_MILLIS + END_GRACE_MILLIS))
                .orElseThrow(() -> new BusinessException(ErrorCode.SESSION_NOT_FOUND));
        if (session.gameId() != DRAW_GAME_ID) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        List<String> guesses = request.guesses() == null ? List.of() : request.guesses().stream()
                .filter(g -> g != null && !g.isBlank())
                .map(g -> g.length() > DRAW_MAX_GUESS_LEN ? g.substring(0, DRAW_MAX_GUESS_LEN) : g)
                .limit(DRAW_MAX_GUESSES)
                .toList();
        int answerRank = clamp(request.answerRank() == null ? 0 : request.answerRank(), 0, DRAW_MAX_GUESSES);
        int score = clamp(request.score() == null ? 0 : request.score(), 0, MAX_SCORE);
        endDrawRound(roomId, session.sessionId(), sender, guesses, answerRank, score);
    }

    /**
     * 그림으로 말해요 정산 — 협동 게임이라 전원 rank 1·동일 점수. draw-result 수리와
     * 타임아웃 스케줄러가 경합해도 endRound와 같은 SETNX 가드로 1회만 실행된다.
     */
    private void endDrawRound(String roomId, String sessionId, AuthPrincipal judge,
                              List<String> guesses, int answerRank, int score) {
        if (!sessionRepository.tryAcquireEndGuard(roomId, sessionId)) {
            return; // 이미 다른 멤버의 결과로 정산됨 — 늦은 재시도는 조용히 무시
        }
        cancelScheduledEnd(roomId);
        GameSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.sessionId().equals(sessionId)) {
            return;
        }
        sessionRepository.markEnded(roomId);
        liveRoomRepository.updateStatus(roomId, "WAITING");

        broadcast(roomId, GameEventResponse.drawResult(sessionId, judge.userId(), guesses, answerRank, score));
        List<GameResultEntry> results = coopResults(roomId, score, true);
        broadcast(roomId, GameEventResponse.gameEnd(sessionId, results));
        eventPublisher.publishEvent(new GameSettledEvent(session.gameId(), results));
        log.info("draw session judged: room={} session={} answerRank={} score={}",
                roomId, sessionId, answerRank, score);
    }

    /** 협동 결과 — 방에 남은 전원 rank 1·동일 점수(finished=채점 성공 여부). */
    private List<GameResultEntry> coopResults(String roomId, int score, boolean finished) {
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<GameResultEntry> results = new ArrayList<>(members.size());
        for (LiveRoomMemberValue m : members) {
            results.add(new GameResultEntry(1, m.userId(), m.displayName(), score, 0, finished,
                    PointCalculator.calc(1, score, members.size())));
        }
        return results;
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
        int score = clamp(request.score() == null ? 0 : request.score(), 0, MAX_SCORE);
        int starsHit = clamp(request.starsHit() == null ? 0 : request.starsHit(), 0, MAX_STARS);
        GamePlayerScore playerScore = new GamePlayerScore(
                sender.userId(), sender.displayName(), score, starsHit, System.currentTimeMillis());
        // 최초 제출만 수리 — 재제출·중복 프레임은 조용히 무시(브로드캐스트도 없음).
        if (!sessionRepository.saveScoreIfAbsent(roomId, playerScore)) {
            return;
        }
        broadcast(roomId, GameEventResponse.playerFinished(
                session.sessionId(), sender.userId(), sender.displayName(), score, starsHit));

        long memberCount = liveRoomRepository.findMembers(roomId).size();
        if (memberCount > 0 && sessionRepository.countScores(roomId) >= memberCount) {
            endRound(roomId, session.sessionId());
        }
    }

    /**
     * 라운드 정산 — 스케줄러(시간 종료)와 finish(전원 완주)가 모두 호출할 수 있어
     * Redis SETNX 가드로 1회만 실행된다. 미제출 참가자는 0점 미완주로 포함.
     */
    private void endRound(String roomId, String sessionId) {
        if (!sessionRepository.tryAcquireEndGuard(roomId, sessionId)) {
            return;
        }
        cancelScheduledEnd(roomId);
        GameSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.sessionId().equals(sessionId)) {
            return; // 이미 새 세션으로 대체된 stale 예약
        }
        sessionRepository.markEnded(roomId);
        liveRoomRepository.updateStatus(roomId, "WAITING");

        // 그림으로 말해요 — 채점 유예까지 draw-result가 안 온 타임아웃 경로. 0점 협동 정산.
        if (session.gameId() == DRAW_GAME_ID) {
            List<GameResultEntry> coop = coopResults(roomId, 0, false);
            broadcast(roomId, GameEventResponse.gameEnd(sessionId, coop));
            eventPublisher.publishEvent(new GameSettledEvent(session.gameId(), coop));
            log.info("draw session timed out without result: room={} session={}", roomId, sessionId);
            return;
        }

        Map<String, GamePlayerScore> scores = sessionRepository.findScores(roomId);
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<GameResultEntry> results = rank(members, scores);
        broadcast(roomId, GameEventResponse.gameEnd(sessionId, results));
        // write-behind 정산(-117) — 회원 결과 leaderboards 적재 + rank ZSET 갱신은 비동기 리스너에 위임.
        // endRound가 SETNX 가드로 1회만 실행되므로 정산도 1회 발행된다.
        eventPublisher.publishEvent(new GameSettledEvent(session.gameId(), results));
        log.info("game session ended: room={} session={} players={} submitted={}",
                roomId, sessionId, members.size(), scores.size());
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

    private void scheduleEnd(String roomId, String sessionId, long atMillis) {
        cancelScheduledEnd(roomId);
        ScheduledFuture<?> future = gameTaskScheduler.schedule(
                () -> {
                    try {
                        endRound(roomId, sessionId);
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
