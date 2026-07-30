package ssafy.a706.backend.game;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.game.dto.DrawOp;
import ssafy.a706.backend.game.dto.GameDrawRequest;
import ssafy.a706.backend.game.draw.DrawJudge;
import ssafy.a706.backend.game.draw.DrawJudgeClient;
import ssafy.a706.backend.game.dto.GameEventResponse;
import ssafy.a706.backend.game.dto.GameFinishRequest;
import ssafy.a706.backend.game.dto.GameProgressRequest;
import ssafy.a706.backend.game.dto.GameReadyRequest;
import ssafy.a706.backend.game.dto.GameResultEntry;
import ssafy.a706.backend.game.dto.GameStartRequest;
import ssafy.a706.backend.game.dto.GameTurnSkipRequest;
import ssafy.a706.backend.game.dto.PoseSubmitRequest;
import ssafy.a706.backend.game.entity.Game;
import ssafy.a706.backend.game.model.GamePlayerScore;
import ssafy.a706.backend.game.model.GameSession;
import ssafy.a706.backend.game.repository.GameRepository;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.liveroom.event.LiveRoomClosedEvent;
import ssafy.a706.backend.liveroom.model.LiveRoomMemberValue;
import ssafy.a706.backend.liveroom.repository.LiveRoomRepository;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.rhythm.RhythmSessionRepository;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.nio.charset.StandardCharsets;
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

    /** 게임①(핑거 스타) — 과제(challenge)가 90초 매치 공유 시드인 게임. */
    private static final long FINGER_STAR_GAME_ID = 1L;
    /** 게임① 부가 지표 stats 키 (-137 일반화 후 레거시 표기 유지용). */
    private static final String STAT_STARS_HIT = "starsHit";
    /** 게임① 90초 매치 완성 개수 stats 키 — 1순위 순위 기준. */
    private static final String STAT_COMPLETED = "completedCount";
    /** 게임① 매치 완성 개수 상한 — 90초를 홀드 3초로 나눈 이론상 최대치. */
    private static final int MAX_COMPLETED = 30;

    /** 게임④(몸 끼워 맞추기, S15P11A706-86) — 출제 페이즈가 있는 게임. */
    private static final long BODY_FIT_GAME_ID = 4L;
    /** 게임④ 출제 페이즈 길이 — FE config·기획 §3과 동기화. */
    private static final long BODY_FIT_SETTING_MILLIS = 5_000;
    /**
     * 게임④ 라운드 간 휴식(ms) — 벽 도착 후 다음 출제 포즈까지의 텀.
     * 이전에는 다음 라운드 startAt이 곧 now였고, 벽 통과 직후 바로 카운트다운이 다시 시작돼
     * 쉴 틈이 없었다(실기 피드백). FE는 startAt 전 구간을 'wait' 페이즈로 그린다.
     */
    private static final long BODY_FIT_ROUND_BREAK_MILLIS = 6_000;
    /** 게임④ 난이도 → 벽 접근 시간(ms) — FE config.difficulty와 동기화. */
    private static final Map<String, Long> BODY_FIT_APPROACH_MILLIS =
            Map.of("easy", 6_000L, "normal", 5_000L, "hard", 4_000L);

    // ── 게임④ 연속 서바이벌(-9) — FE chainSchedule.ts와 동기화 필수 ──
    // 벽이 끊기지 않고 날아오고 전원이 동시에 뛴다. 출제자·로테이션이 없어 setterOrder가 빈 세션이 되고,
    // 그 결과 endRound의 rotates 분기가 자동으로 꺼져 단판 점수 순위(rank)를 그대로 탄다.
    /** 첫 벽의 접근 시간 = 난이도 기본값 × 이 비율 (chainSchedule.CHAIN_START_RATIO) */
    private static final double CHAIN_START_RATIO = 0.8;
    /** 벽마다 접근 시간에 누적으로 곱하는 비율 (chainSchedule.CHAIN_SPEEDUP) */
    private static final double CHAIN_SPEEDUP = 0.95;
    /** 접근 시간 하한 (chainSchedule.CHAIN_MIN_MS) */
    private static final double CHAIN_MIN_MILLIS = 2_200;
    /**
     * 스폰 간격을 접근 시간의 몇 배로 볼지 — 거리 기준(z 1.8 / 전체 5)을 접근 곡선 easeIn(t^2.5)의
     * 역함수로 환산한 값. FE chainSchedule.chainGapRatio(5)와 같은 수여야 한다.
     */
    private static final double CHAIN_GAP_RATIO = Math.pow(1.8 / 5.0, 1 / 2.5);
    /** 연속 서바이벌 벽 수 선택지 — 무한(0)은 종료 시각이 없어 방에서는 허용하지 않는다(솔로 전용). */
    private static final Set<Integer> CHAIN_WALL_CHOICES = Set.of(10, 20, 30);
    private static final int CHAIN_WALLS_DEFAULT = 10;
    /** 마지막 벽 도착 후 판정·제출이 서버에 닿을 여유 — 라운드 간 휴식이 없는 모드라 별도로 둔다. */
    private static final long CHAIN_TAIL_MILLIS = 1_500;
    /** 포즈 payload 상한 — 랜드마크 33점 JSON은 ~2KB, 여유 4배 (§9-2). */
    private static final int MAX_POSE_PAYLOAD_BYTES = 8_192;

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
    /**
     * 도화지 data URL 상한(문자 수).
     *
     * <p>GMS 릴레이가 요청 본문 65KB 근처부터 <b>모델을 부르지도 않고</b> 400을 던진다
     * (실측: 65.6KB 성공 / 100KB 실패, 실패는 0.4초 만에 반환). 예전 상한 4MB는 이 경계보다
     * 60배 커서 아무 역할도 못 하고, 거절이 확실한 페이로드를 GMS까지 보내 쿼터를 태우고
     * 원인을 오해하게 만드는 502를 만들었다. FE도 같은 값으로 인코딩 크기를 맞춘다
     * (DrawingRelayGame MAX_IMAGE_CHARS) — 여기는 그보다 살짝 여유를 둔 방어선이다.</p>
     */
    private static final int DRAW_MAX_IMAGE_CHARS = 64_000;
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
    /** 방 상태 전환은 서비스 경유 — 로비 실시간 갱신(-148) 알림이 그 안에 붙어 있다. */
    private final LiveRoomService liveRoomService;
    private final GameSessionRepository sessionRepository;
    /** 리듬(전용 채널) 세션 — 교차 중복 시작 차단(-164)에만 읽는다. 도메인 지식은 넘기지 않는다. */
    private final RhythmSessionRepository rhythmSessionRepository;
    private final GameRepository gameRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final TaskScheduler gameTaskScheduler;
    private final ApplicationEventPublisher eventPublisher;
    private final DrawJudgeClient judgeClient;

    /** 조기 종료 시 취소할 라운드 종료 예약 (roomId → future). 인메모리 — 단일 인스턴스 전제. */
    private final Map<String, ScheduledFuture<?>> endTasks = new ConcurrentHashMap<>();

    /**
     * 시작 준비 확인 대기 시간(-162). 정상 경로에서는 모델이 캐시에 있어 1초 안에 전원이
     * ready를 회신한다 — 이 값은 "준비 신호를 영영 못 보내는 참가자(크래시·이탈)"가
     * 방 전체의 시작을 붙잡지 못하게 하는 상한이다. 초과 시 준비된 인원만으로 시작한다.
     */
    private static final long PREPARE_TIMEOUT_MILLIS = 15_000;

    /** 시작 준비 확인 상태(-162). roomId당 하나. 인메모리 — endTasks와 동일한 단일 인스턴스 전제. */
    private record PendingStart(String prepareId, GameStartRequest request,
                                Set<String> ready, ScheduledFuture<?> timeout) {
    }

    private final Map<String, PendingStart> pendingStarts = new ConcurrentHashMap<>();

    /**
     * 방장 게임 시작 — 세션을 바로 만들지 않고 <b>시작 준비 확인(-162)</b>부터 연다.
     *
     * <p>예전에는 즉시 GAME_START를 배포하고 3초 뒤 라운드가 시작됐다 — 모델이 없는(또는
     * 새로고침 중인) 참가자는 그 3초 안에 준비될 수 없어 라운드에 늦게 합류하거나 통째로
     * 놓쳤다. 이제 GAME_PREPARE를 배포해 각 참가자가 모델 로드를 마치고 ready를 회신하게
     * 하고, 전원 완료(또는 {@link #PREPARE_TIMEOUT_MILLIS}) 시 {@link #beginSession}이
     * 실제 세션을 만든다.</p>
     */
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
        // 3) 진행 중 세션·준비 확인 중복 방지 — 리듬(전용 채널) 세션과도 교차 확인한다(-164).
        //    저장소가 따로라 여기서 안 보면 리듬 진행 중에 공용 게임을 겹쳐 시작할 수 있었다.
        long now = System.currentTimeMillis();
        boolean activeExists = sessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, END_GRACE_MILLIS))
                .orElse(false);
        boolean rhythmActive = rhythmSessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, END_GRACE_MILLIS))
                .orElse(false);
        if (activeExists || rhythmActive || pendingStarts.containsKey(roomId)) {
            throw new BusinessException(ErrorCode.GAME_SESSION_ALREADY_ACTIVE);
        }
        // 4) 인원 선검증 — beginSession도 다시 확인하지만, 방장에게는 준비 확인을 열기 전에
        //    바로 거절을 돌려줘야 한다(타임아웃 뒤 조용히 실패하면 원인을 알 수 없다).
        int memberCount = liveRoomRepository.findMembers(roomId).size();
        if (gameId == DRAW_GAME_ID && memberCount < game.getMinPlayers()) {
            throw new BusinessException(ErrorCode.GAME_NEED_MORE_PLAYERS,
                    String.format("%d명부터 시작할 수 있는 게임입니다. (현재 %d명)",
                            game.getMinPlayers(), memberCount));
        }
        if (gameId == BODY_FIT_GAME_ID && memberCount < 2) {
            throw new BusinessException(ErrorCode.GAME_NEED_MORE_PLAYERS);
        }

        // 5) 준비 확인 개시 — 전원 ready 또는 타임아웃에 beginSession이 실행된다.
        String prepareId = UUID.randomUUID().toString();
        ScheduledFuture<?> timeout = gameTaskScheduler.schedule(
                () -> {
                    PendingStart pending = pendingStarts.remove(roomId);
                    if (pending == null || !pending.prepareId().equals(prepareId)) {
                        return; // 이미 전원 ready로 시작됐거나 취소됨
                    }
                    try {
                        beginSession(roomId, pending.request());
                    } catch (Exception e) {
                        log.error("game start failed after prepare timeout: room={}", roomId, e);
                    }
                },
                Instant.ofEpochMilli(now + PREPARE_TIMEOUT_MILLIS));
        pendingStarts.put(roomId, new PendingStart(prepareId, request, ConcurrentHashMap.newKeySet(), timeout));
        broadcast(roomId, GameEventResponse.gamePrepare(prepareId, gameId, memberCount));
        log.info("game prepare opened: room={} prepare={} game={} members={}",
                roomId, prepareId, gameId, memberCount);
    }

    /**
     * 참가자 준비 완료 회신(-162). 현재 멤버 전원이 모이면 즉시 세션을 시작한다.
     * 지난 준비 라운드의 늦은 신호(prepareId 불일치)는 조용히 무시한다.
     */
    public void ready(String roomId, GameReadyRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        PendingStart pending = pendingStarts.get(roomId);
        if (pending == null || !pending.prepareId().equals(request.prepareId())) {
            return;
        }
        pending.ready().add(sender.userId());
        // 준비 확인 중 멤버가 바뀔 수 있으므로 "전원"은 매번 현재 명단으로 판정한다.
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        long readyCount = members.stream().filter(m -> pending.ready().contains(m.userId())).count();
        broadcast(roomId, GameEventResponse.gameReadyProgress(
                pending.prepareId(), (int) readyCount, members.size()));
        if (members.isEmpty() || readyCount < members.size()) {
            return;
        }
        // 타임아웃 스레드와 경합해도 remove는 한쪽만 성공한다 — 세션은 정확히 1회 시작된다.
        PendingStart claimed = pendingStarts.remove(roomId);
        if (claimed == null || !claimed.prepareId().equals(pending.prepareId())) {
            return;
        }
        claimed.timeout().cancel(false);
        beginSession(roomId, claimed.request());
    }

    /**
     * 방장 게임 강제종료(-164 후속). 정산(GameSettledEvent) 없이 세션을 접는다 —
     * 중도 종료된 판으로 랭킹·포인트가 적재되면 안 된다. 준비 확인 단계였다면 그것만 취소한다.
     * FE는 GAME_ABORTED를 받으면 게임 화면을 닫는다.
     */
    public void abort(String roomId, AuthPrincipal sender) {
        Map<Object, Object> roomFields = liveRoomRepository.findRoomFields(roomId)
                .orElseThrow(() -> new BusinessException(ErrorCode.ROOM_NOT_FOUND));
        requireMembership(roomId, sender);
        if (!sender.userId().equals(roomFields.get("hostUserId"))) {
            throw new BusinessException(ErrorCode.NOT_ROOM_HOST);
        }
        PendingStart pending = takePendingStart(roomId);
        if (pending != null) {
            broadcast(roomId, GameEventResponse.gameAborted(null));
            log.info("game prepare aborted by host: room={} prepare={}", roomId, pending.prepareId());
            return;
        }
        GameSession session = sessionRepository.findSession(roomId).orElse(null);
        long now = System.currentTimeMillis();
        if (session == null || !session.isPlaying(now, END_GRACE_MILLIS)) {
            return; // 이미 정산됐거나 세션 없음 — 멱등
        }
        // 정산 타이머·전원 완주 조기 정산과 경합해도 SETNX 가드를 선점한 한쪽만 실행된다.
        if (!sessionRepository.tryAcquireEndGuard(roomId, session.sessionId(), session.roundIndex())) {
            return;
        }
        cancelScheduledEnd(roomId);
        sessionRepository.markEnded(roomId);
        liveRoomService.changeStatus(roomId, "WAITING");
        broadcast(roomId, GameEventResponse.gameAborted(session.sessionId()));
        log.info("game session aborted by host: room={} session={}", roomId, session.sessionId());
    }

    /** 공용 게임 세션이 진행/준비 중인가 — 리듬(전용 채널)이 교차 중복 시작을 막을 때 묻는다(-164). */
    public boolean isSessionActiveOrPreparing(String roomId) {
        long now = System.currentTimeMillis();
        return pendingStarts.containsKey(roomId) || sessionRepository.findSession(roomId)
                .map(s -> s.isPlaying(now, END_GRACE_MILLIS))
                .orElse(false);
    }

    private PendingStart takePendingStart(String roomId) {
        PendingStart pending = pendingStarts.remove(roomId);
        if (pending != null) {
            pending.timeout().cancel(false);
        }
        return pending;
    }

    /** 준비 확인이 끝난 뒤의 실제 세션 시작 — 세션 생성·방 잠금·GAME_START 브로드캐스트·정산 예약. */
    private void beginSession(String roomId, GameStartRequest request) {
        long now = System.currentTimeMillis();
        Long gameId = request.gameId();
        Game game = gameRepository.findById(gameId)
                .filter(Game::isActive)
                .orElseThrow(() -> new BusinessException(ErrorCode.GAME_NOT_FOUND));

        // 그림으로 말해요(게임 10)는 출제자·난이도가 없는 별도 타임라인이라 전용 경로로 빠진다
        if (gameId == DRAW_GAME_ID) {
            startDrawSession(roomId, game, now);
            return;
        }

        // -137 일반화: 게임별 과제 payload. 게임①이면 내부에서 별자리를 고른다
        String challenge = resolveChallenge(gameId, request);
        String sessionId = UUID.randomUUID().toString();
        long startAt = now + game.getCountdownSec() * 1000L;

        // 게임④(-86, -48): 라운드 = 출제 5s + 벽 접근(난이도별). 출제자는 참가 순(joinedAt)으로
        // 로테이션 — 전원이 한 번씩 출제자를 맡을 때까지 endRound가 자동으로 다음 라운드를 연다.
        String difficulty = null;
        String mode = null;
        int wallCount = 0;
        String setterUserId = null;
        List<String> setterOrder = List.of();
        long endAt;
        if (gameId == BODY_FIT_GAME_ID) {
            difficulty = request.difficulty() != null
                    && BODY_FIT_APPROACH_MILLIS.containsKey(request.difficulty())
                    ? request.difficulty() : "easy";
            mode = GameSession.MODE_CHAIN.equals(request.mode())
                    ? GameSession.MODE_CHAIN : GameSession.MODE_POSE;
            long approachMillis = BODY_FIT_APPROACH_MILLIS.get(difficulty);
            // 인원 검증은 모드와 무관하게 2명 이상 — 연속 서바이벌은 출제자가 없어 기술적으로는
            // 혼자서도 성립하지만, 1인 방 세션을 허용하면 순위가 항상 1등이라 랭킹 적재
            // (GameSettledEvent → leaderboards·rank ZSET)를 혼자서 쌓을 수 있다.
            // FE는 혼자일 때 로컬 연습 모드로 돌리므로 여기 도달은 레이스뿐이다.
            if (liveRoomRepository.findMembers(roomId).size() < 2) {
                throw new BusinessException(ErrorCode.GAME_NEED_MORE_PLAYERS);
            }
            if (GameSession.MODE_CHAIN.equals(mode)) {
                // 출제자·로테이션 없음 → setterOrder를 비워 둔다(endRound의 rotates가 꺼진다).
                // challenge에는 포즈 시드를 싣는다 — 전원이 같은 시드로 같은 벽을 만든다(§9-2와 같은 원리).
                wallCount = request.wallCount() != null && CHAIN_WALL_CHOICES.contains(request.wallCount())
                        ? request.wallCount() : CHAIN_WALLS_DEFAULT;
                challenge = Long.toString(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE));
                endAt = startAt + chainDurationMillis(approachMillis, wallCount) + CHAIN_TAIL_MILLIS;
            } else {
                // 출제 순서는 무작위(게임⑩ turnOrder와 같은 방식). 이전에는 참가 순(joinedAt)이라
                // 방을 만든 사람이 매 판 1번 출제자로 고정됐다.
                List<String> shuffled = new ArrayList<>(liveRoomRepository.findMembers(roomId).stream()
                        .map(LiveRoomMemberValue::userId)
                        .toList());
                Collections.shuffle(shuffled);
                setterOrder = List.copyOf(shuffled);
                setterUserId = setterOrder.get(0);
                endAt = startAt + BODY_FIT_SETTING_MILLIS + approachMillis;
            }
            sessionRepository.clearTotals(roomId);
        } else {
            endAt = startAt + game.getRoundDurationSec() * 1000L;
        }

        GameSession session = new GameSession(sessionId, gameId, challenge, setterUserId,
                startAt, endAt, GameSession.STATUS_PLAYING, setterOrder, 0, difficulty, mode, wallCount);
        sessionRepository.saveSession(roomId, session);
        liveRoomService.changeStatus(roomId, "PLAYING");

        // constellationKey는 게임① FE 하위호환 필드 — 게임①일 때만 challenge와 같은 값
        String legacyConstellationKey = gameId == FINGER_STAR_GAME_ID ? challenge : null;
        Integer roundNo = setterOrder.isEmpty() ? null : 1;
        Integer totalRounds = setterOrder.isEmpty() ? null : setterOrder.size();
        broadcast(roomId, GameEventResponse.gameStart(
                sessionId, gameId, challenge, legacyConstellationKey, setterUserId, difficulty,
                now, startAt, endAt, roundNo, totalRounds, mode, wallCount > 0 ? wallCount : null));
        scheduleEnd(roomId, sessionId, 0, endAt + END_GRACE_MILLIS);
        log.info("game session started: room={} session={} game={} mode={} challenge={} setter={} walls={}",
                roomId, sessionId, gameId, mode, challenge, setterUserId, wallCount);
    }

    /**
     * 연속 서바이벌: 첫 벽 출발부터 마지막 벽 도착까지의 시간 — chain 세션 endAt의 근거.
     * <b>FE chainSchedule.chainDurationMs와 같은 식이어야 한다</b> — 어긋나면 마지막 벽이
     * 도착하기 전에 서버가 정산하거나(점수 유실), 다 끝난 뒤 빈 화면으로 기다리게 된다.
     */
    private long chainDurationMillis(long baseApproachMillis, int walls) {
        double elapsed = 0;
        for (int i = 0; i < walls - 1; i++) {
            elapsed += chainApproachMillis(baseApproachMillis, i) * CHAIN_GAP_RATIO;
        }
        return Math.round(elapsed + chainApproachMillis(baseApproachMillis, walls - 1));
    }

    /** 벽 i의 접근 시간 — 갈수록 빨라지고 하한에서 멈춘다(FE chainSchedule.chainApproachMs). */
    private double chainApproachMillis(long baseApproachMillis, int index) {
        return Math.max(CHAIN_MIN_MILLIS,
                baseApproachMillis * CHAIN_START_RATIO * Math.pow(CHAIN_SPEEDUP, index));
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

    /**
     * 그림으로 말해요 시작 — 총 시간(games.roundDurationSec, 현재 90초)을 인원수로 올림 분배한 턴 스케줄과
     * 주제어·화가 순서(셔플)를 확정해 GAME_START로 배포한다. 이후 턴 전환은 별도 이벤트 없이
     * 전 클라이언트가 서버 권위 시각으로 같은 스케줄을 계산한다. 정산은 draw-result 수리(협동 점수)
     * 또는 endAt+채점 유예 타임아웃(0점) 중 먼저 온 쪽이 1회 실행한다.
     */
    private void startDrawSession(String roomId, Game game, long now) {
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        if (members.isEmpty()) {
            throw new BusinessException(ErrorCode.GAME_NOT_IN_ROOM);
        }
        // 이어그리기라 혼자서는 성립하지 않는다 — 카탈로그 최소 인원(games.min_players)을 강제한다.
        if (members.size() < game.getMinPlayers()) {
            throw new BusinessException(ErrorCode.GAME_NEED_MORE_PLAYERS,
                    String.format("%d명부터 시작할 수 있는 게임입니다. (현재 %d명)",
                            game.getMinPlayers(), members.size()));
        }
        List<String> turnOrder = new ArrayList<>(members.stream().map(LiveRoomMemberValue::userId).toList());
        Collections.shuffle(turnOrder);
        int playerCount = turnOrder.size();
        int turnSec = (game.getRoundDurationSec() + playerCount - 1) / playerCount; // 나눠떨어지지 않으면 올림
        String topicWord = DRAW_TOPICS.get(ThreadLocalRandom.current().nextInt(DRAW_TOPICS.size()));

        String sessionId = UUID.randomUUID().toString();
        long startAt = now + game.getCountdownSec() * 1000L;
        long endAt = startAt + (long) playerCount * (DRAW_HANDOVER_SEC + turnSec) * 1000L;
        // 주제어는 세션의 과제(challenge)로 저장한다 — 서버가 채점할 때 정답을 알아야 하고,
        // 게임①의 별자리 키와 같은 자리라 별도 필드가 필요 없다.
        // 출제자·난이도·로테이션은 게임⑩에 없어 비운다(-86/-48에서 추가된 필드).
        sessionRepository.saveSession(roomId, new GameSession(sessionId, DRAW_GAME_ID, topicWord, null,
                startAt, endAt, GameSession.STATUS_PLAYING, List.of(), 0, null, null, 0));
        liveRoomService.changeStatus(roomId, "PLAYING");

        broadcast(roomId, GameEventResponse.gameStartDraw(sessionId, DRAW_GAME_ID, now, startAt, endAt,
                topicWord, turnOrder, turnSec, DRAW_HANDOVER_SEC));
        scheduleEnd(roomId, sessionId, 0, endAt + DRAW_JUDGE_WINDOW_MILLIS);
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
     * 조기 차례 넘기기(게임 10) — 남은 그리기 시간을 클램프해 TURN_SKIPPED로 재방송하고,
     * 전체 스케줄이 그만큼 당겨지므로 세션 endAt과 타임아웃 예약도 함께 앞당긴다.
     * 차례(발신자가 현재 화가인지) 강제는 클라이언트 몫 — draw 릴레이와 같은 신뢰 모델.
     */
    public void turnSkip(String roomId, GameTurnSkipRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        if (session.gameId() != DRAW_GAME_ID) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }
        long now = System.currentTimeMillis();
        long requested = request.remainingMs() == null ? 0 : request.remainingMs();
        long remaining = Math.max(0, Math.min(requested, session.endAt() - now));
        int turnIndex = Math.max(0, request.turnIndex() == null ? 0 : request.turnIndex());

        long newEndAt = session.endAt() - remaining;
        sessionRepository.updateEndAt(roomId, newEndAt);
        // 그림으로 말해요는 라운드 로테이션(게임④)이 없어 roundIndex는 항상 0
        scheduleEnd(roomId, session.sessionId(), 0, newEndAt + DRAW_JUDGE_WINDOW_MILLIS);
        broadcast(roomId, GameEventResponse.turnSkipped(
                session.sessionId(), sender.userId(), turnIndex, remaining));
        log.info("draw turn skipped: room={} session={} turn={} remainingMs={}",
                roomId, session.sessionId(), turnIndex, remaining);
    }

    /**
     * 완성 그림 AI 채점(게임 10, 최초 1회) → DRAW_RESULT 방송 + 협동 정산.
     *
     * <p>배포 환경에서는 GMS 키를 프론트에 둘 수 없어 <b>채점 호출과 점수 계산을 서버가 한다</b>.
     * 클라이언트는 도화지 이미지만 올리고, 정답(주제어)은 세션의 challenge에 있으므로
     * 클라이언트가 점수를 조작할 수 있는 경로가 없다.</p>
     *
     * <p>채점은 그리기 종료(endAt) 이후에 이뤄지므로 일반 유예 대신 채점 유예 안에서 수리한다.
     * 마지막 화가가 실패·이탈해도 다른 참가자가 같은 이미지를 올려 대신 채점할 수 있고,
     * 이미 정산됐다면 SETNX 가드에서 조용히 무시된다.</p>
     */
    public void judgeDrawing(String roomId, String imageDataUrl, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        if (imageDataUrl == null || imageDataUrl.isBlank()) {
            throw new BusinessException(ErrorCode.GAME_IMAGE_INVALID);
        }
        if (imageDataUrl.length() > DRAW_MAX_IMAGE_CHARS) {
            // GMS가 어차피 거절할 크기다 — 여기서 끊어 쿼터를 아끼고 원인을 분명히 남긴다.
            log.warn("draw judge rejected oversized image: room={} chars={}", roomId, imageDataUrl.length());
            throw new BusinessException(ErrorCode.GAME_IMAGE_INVALID,
                    String.format("그림 데이터가 너무 큽니다. (%dKB / 최대 %dKB)",
                            imageDataUrl.length() / 1024, DRAW_MAX_IMAGE_CHARS / 1024));
        }
        long now = System.currentTimeMillis();
        GameSession session = sessionRepository.findSession(roomId)
                .filter(s -> s.isPlaying(now, DRAW_JUDGE_WINDOW_MILLIS + END_GRACE_MILLIS))
                .orElseThrow(() -> new BusinessException(ErrorCode.SESSION_NOT_FOUND));
        if (session.gameId() != DRAW_GAME_ID) {
            throw new BusinessException(ErrorCode.GAME_NOT_FOUND);
        }

        List<String> guesses = judgeClient.guess(imageDataUrl).stream()
                .map(g -> g.length() > DRAW_MAX_GUESS_LEN ? g.substring(0, DRAW_MAX_GUESS_LEN) : g)
                .limit(DRAW_MAX_GUESSES)
                .toList();
        int answerRank = DrawJudge.findAnswerRank(session.challenge(), guesses);
        int score = DrawJudge.scoreForRank(answerRank);
        endDrawRound(roomId, session.sessionId(), sender, guesses, answerRank, score);
    }

    /**
     * 그림으로 말해요 정산 — 협동 게임이라 전원 rank 1·동일 점수. draw-result 수리와
     * 타임아웃 스케줄러가 경합해도 endRound와 같은 SETNX 가드로 1회만 실행된다.
     */
    private void endDrawRound(String roomId, String sessionId, AuthPrincipal judge,
                              List<String> guesses, int answerRank, int score) {
        // 게임⑩은 로테이션이 없어 roundIndex 0 — 가드 키가 라운드별로 갈리는 게임④와 달리 세션당 1개
        if (!sessionRepository.tryAcquireEndGuard(roomId, sessionId, 0)) {
            return; // 이미 다른 멤버의 결과로 정산됨 — 늦은 재시도는 조용히 무시
        }
        cancelScheduledEnd(roomId);
        GameSession session = sessionRepository.findSession(roomId).orElse(null);
        if (session == null || !session.sessionId().equals(sessionId)) {
            return;
        }
        sessionRepository.markEnded(roomId);
        liveRoomService.changeStatus(roomId, "WAITING");

        broadcast(roomId, GameEventResponse.drawResult(sessionId, judge.userId(), guesses, answerRank, score));
        List<GameResultEntry> results = coopResults(roomId, score, true);
        broadcast(roomId, GameEventResponse.gameEnd(sessionId, results));
        eventPublisher.publishEvent(new GameSettledEvent(sessionId, session.gameId(), results));
        log.info("draw session judged: room={} session={} answerRank={} score={}",
                roomId, sessionId, answerRank, score);
    }

    /** 협동 결과 — 방에 남은 전원 rank 1·동일 점수(finished=채점 성공 여부). */
    private List<GameResultEntry> coopResults(String roomId, int score, boolean finished) {
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<GameResultEntry> results = new ArrayList<>(members.size());
        for (LiveRoomMemberValue m : members) {
            results.add(new GameResultEntry(1, m.userId(), m.displayName(), score, 0, finished,
                    PointCalculator.calc(1, score, members.size()), null));
        }
        return results;
    }

    /** 라운드 중 진행 상황 중계 — 저장 없음, 클램프 후 방 토픽으로 재방송. */
    public void progress(String roomId, GameProgressRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        int starsLit = clamp(request.starsLit() == null ? 0 : request.starsLit(), 0, MAX_STARS);
        double holdProgress = clampDouble(request.holdProgress() == null ? 0 : request.holdProgress());
        int completedCount = clamp(
                request.completedCount() == null ? 0 : request.completedCount(), 0, MAX_COMPLETED);
        broadcast(roomId, GameEventResponse.progress(
                session.sessionId(), sender.userId(), sender.displayName(),
                starsLit, holdProgress, completedCount));
    }

    /** 참가자 최종 제출 수리(최초 1회) → PLAYER_FINISHED 브로드캐스트, 전원 제출 시 조기 정산. */
    public void finish(String roomId, GameFinishRequest request, AuthPrincipal sender) {
        requireMembership(roomId, sender);
        GameSession session = requireActiveSession(roomId);
        // 게임④(-9): 출제자는 이번 라운드에 플레이하지 않는다 — 제출해도 조용히 무시.
        if (session.gameId() == BODY_FIT_GAME_ID && sender.userId().equals(session.setterUserId())) {
            return;
        }
        // 게임① 90초 매치: score=총점(완성 개수×100 상한), 그 외 게임: 단판 점수(0~100)
        int score;
        int starsHit;
        Integer completedCount = null;
        Map<String, Integer> stats;
        if (session.gameId() == FINGER_STAR_GAME_ID) {
            int completed = clamp(
                    request.completedCount() == null ? 0 : request.completedCount(), 0, MAX_COMPLETED);
            score = clamp(request.score() == null ? 0 : request.score(), 0, completed * MAX_SCORE);
            starsHit = 0;
            completedCount = completed;
            stats = Map.of(STAT_COMPLETED, completed);
        } else {
            // 게임④ 연속 서바이벌(-9)도 이 분기다 — 클라이언트가 누적 총점이 아니라 벽 1장당
            // 평균(0~100)을 보내기 때문이다. 총점을 받으면 그 값이 leaderboards.best_score
            // (GREATEST)로 영속되고 PointCalculator(scoreBonus = score/10, 0~100 만점 전제)를
            // 지나면서 같은 게임 안에서 모드에 따라 랭킹·포인트가 30배까지 벌어진다.
            // 벽 수는 전원 같으므로 평균 순위 = 총점 순위다(승부 결과는 그대로).
            score = clamp(request.score() == null ? 0 : request.score(), 0, MAX_SCORE);
            starsHit = clamp(request.starsHit() == null ? 0 : request.starsHit(), 0, MAX_STARS);
            stats = Map.of(STAT_STARS_HIT, starsHit);
        }
        GamePlayerScore playerScore = new GamePlayerScore(
                sender.userId(), sender.displayName(), score, stats, System.currentTimeMillis());
        // 최초 제출만 수리 — 재제출·중복 프레임은 조용히 무시(브로드캐스트도 없음).
        if (!sessionRepository.saveScoreIfAbsent(roomId, playerScore)) {
            return;
        }
        broadcast(roomId, GameEventResponse.playerFinished(
                session.sessionId(), sender.userId(), sender.displayName(), score, starsHit, completedCount));

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
        liveRoomService.changeStatus(roomId, "WAITING");

        // 그림으로 말해요 — 채점 유예까지 draw-result가 안 온 타임아웃 경로. 0점 협동 정산.
        if (session.gameId() == DRAW_GAME_ID) {
            List<GameResultEntry> coop = coopResults(roomId, 0, false);
            broadcast(roomId, GameEventResponse.gameEnd(sessionId, coop));
            eventPublisher.publishEvent(new GameSettledEvent(sessionId, session.gameId(), coop));
            log.info("draw session timed out without result: room={} session={}", roomId, sessionId);
            return;
        }

        // 이번 라운드 제출 점수 — 단판 순위의 입력이자 양쪽 경로의 로그 지표(제출 인원)다.
        // 로테이션 경로는 위에서 누적(totals)에 이미 반영했고, 여기서는 집계용으로만 다시 읽는다.
        Map<String, GamePlayerScore> scores = sessionRepository.findScores(roomId);
        List<LiveRoomMemberValue> members = liveRoomRepository.findMembers(roomId);
        List<GameResultEntry> results = rotates
                ? rankByTotal(members, sessionRepository.findTotals(roomId), session.setterOrder())
                : rank(members, scores);
        broadcast(roomId, GameEventResponse.gameEnd(sessionId, results));
        // write-behind 정산(-117) — 회원 결과 leaderboards 적재 + rank ZSET 갱신은 비동기 리스너에 위임.
        // endRound가 SETNX 가드로 1회만 실행되므로 정산도 1회 발행된다.
        eventPublisher.publishEvent(new GameSettledEvent(sessionId, session.gameId(), results));
        log.info("game session ended: room={} session={} players={} submitted={}",
                roomId, sessionId, members.size(), scores.size());
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
        long startAt = now + BODY_FIT_ROUND_BREAK_MILLIS;
        long endAt = startAt + BODY_FIT_SETTING_MILLIS + BODY_FIT_APPROACH_MILLIS.get(prev.difficulty());
        GameSession next = new GameSession(prev.sessionId(), prev.gameId(), null, setterUserId,
                startAt, endAt, GameSession.STATUS_PLAYING, prev.setterOrder(), roundIndex,
                prev.difficulty(), prev.mode(), prev.wallCount());
        sessionRepository.saveSession(roomId, next);
        broadcast(roomId, GameEventResponse.gameStart(
                prev.sessionId(), prev.gameId(), null, null, setterUserId, prev.difficulty(),
                now, startAt, endAt, roundIndex + 1, prev.setterOrder().size(), prev.mode(), null));
        scheduleEnd(roomId, prev.sessionId(), roundIndex, endAt + END_GRACE_MILLIS);
        log.info("game round advanced: room={} session={} round={} setter={}",
                roomId, prev.sessionId(), roundIndex, setterUserId);
    }

    /**
     * 순위 — 게임① 90초 매치는 완성 개수 내림차순(1순위) → 총점 내림차순(2순위 — 개수가 같으면
     * 평균 비교와 동치) → 먼저 제출한 쪽 우선. 완성 개수 개념이 없는 게임은 전원 0이라
     * 기존 점수 내림차순과 동일하게 동작한다. 방에 남은 전원 포함 — 미제출자는 0점.
     */
    private List<GameResultEntry> rank(List<LiveRoomMemberValue> members, Map<String, GamePlayerScore> scores) {
        record Row(String userId, String nickname, int score, int starsHit, int completed,
                   boolean finished, long finishedAt) {}
        List<Row> rows = new ArrayList<>();
        for (LiveRoomMemberValue m : members) {
            GamePlayerScore s = scores.get(m.userId());
            if (s != null) {
                rows.add(new Row(m.userId(), s.nickname(), s.score(), s.starsHit(),
                        s.completedCount(), true, s.finishedAt()));
            } else {
                rows.add(new Row(m.userId(), m.displayName(), 0, 0, 0, false, Long.MAX_VALUE));
            }
        }
        rows.sort(Comparator.comparingInt(Row::completed).reversed()
                .thenComparing(Comparator.comparingInt(Row::score).reversed())
                .thenComparingLong(Row::finishedAt));
        int playerCount = rows.size();
        List<GameResultEntry> results = new ArrayList<>(playerCount);
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            int rankNo = i + 1;
            int pointsEarned = PointCalculator.calc(rankNo, r.score(), playerCount);
            results.add(new GameResultEntry(rankNo, r.userId(), r.nickname(), r.score(), r.starsHit(),
                    r.finished(), pointsEarned, r.completed()));
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
            // 전원이 로테이션에 참가했으므로 finished=true, starsHit·completedCount는 게임④와 무관.
            results.add(new GameResultEntry(rankNo, r.userId(), r.nickname(), r.score(), 0, true, pointsEarned, null));
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

    /**
     * 방 폐쇄(-164) — 정산 예약과 세션 잔재를 함께 정리한다. 방이 사라졌는데 예약만 남으면
     * 발화 시 삭제된 방을 조회·부활시키려다 실패하고, 세션 키는 30분간 유령으로 남는다.
     */
    @EventListener
    public void onRoomClosed(LiveRoomClosedEvent event) {
        takePendingStart(event.roomId());
        cancelScheduledEnd(event.roomId());
        sessionRepository.deleteAllForRoom(event.roomId());
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
     * 게임①: 90초 매치 공유 시드(숫자 문자열) — 전 클라이언트가 같은 시드로 같은 별자리
     * 순서를 뽑아 과제 공정성을 유지한다(별자리 데이터·출제 규칙은 FE constellations/challenge.ts).
     * 그 외(게임④ 등 출제 페이즈가 있는 게임): 시작 시점에는 과제가 없다 —
     * 세션 도중 updateChallenge로 채워진다(§9-2).
     */
    private String resolveChallenge(long gameId, GameStartRequest request) {
        if (gameId == FINGER_STAR_GAME_ID) {
            return String.valueOf(ThreadLocalRandom.current().nextLong(1L << 48));
        }
        return null;
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
