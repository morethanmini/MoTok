package ssafy.a706.backend.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.auth.store.RefreshTokenStore;
import ssafy.a706.backend.auth.store.AccountBlock;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.auth.controller.dto.*;
import ssafy.a706.backend.auth.email.EmailVerificationService;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.oauth.OauthLinkService;
import ssafy.a706.backend.auth.oauth.OauthProvider;
import ssafy.a706.backend.auth.oauth.OauthUserInfo;
import ssafy.a706.backend.auth.oauth.client.OauthClientResolver;
import ssafy.a706.backend.auth.principal.GuestPrincipal;
import ssafy.a706.backend.auth.ratelimit.LoginAttemptLimiter;
import ssafy.a706.backend.auth.session.SingleSessionPolicy;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.text.ProfanityFilter;
import ssafy.a706.backend.liveroom.service.LiveRoomService;
import ssafy.a706.backend.global.config.StompSessionRegistry;
import ssafy.a706.backend.presence.service.PresenceService;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.repository.UserRepository;
import ssafy.a706.backend.user.controller.dto.UserProfileResponse;
import ssafy.a706.backend.user.withdrawal.RejoinPolicy;
import ssafy.a706.backend.user.withdrawal.WithdrawnIdentifierType;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider tokenProvider;
    private final RefreshTokenStore refreshTokenStore;
    private final AccountBlockStore accountBlockStore;
    private final EmailVerificationService emailVerificationService;
    private final OauthClientResolver oauthClientResolver;
    private final OauthLinkService oauthLinkService;
    private final LiveRoomService liveRoomService;
    private final PresenceService presenceService;
    private final StompSessionRegistry stompSessionRegistry;
    private final SingleSessionPolicy singleSessionPolicy;
    private final LoginAttemptLimiter loginAttemptLimiter;
    private final RejoinPolicy rejoinPolicy;
    private final ProfanityFilter profanityFilter;

    public AvailabilityResponse checkEmail(String email) {
        return new AvailabilityResponse(!userRepository.existsByEmail(email.trim().toLowerCase()));
    }

    public AvailabilityResponse checkNickname(String nickname) {
        // 가입(@NoProfanity)에서만 걸리면 "중복확인은 통과했는데 가입은 실패"가 되므로 같은 검사를 태운다(-152).
        if (profanityFilter.contains(nickname)) {
            throw new BusinessException(ErrorCode.PROFANITY_DETECTED);
        }
        return new AvailabilityResponse(!userRepository.existsByNickname(nickname.trim()));
    }

    /** 아이디(이메일) 찾기 — 닉네임으로 가입 계정을 찾아 일부 마스킹된 이메일을 돌려준다. 없으면 404. */
    public FindIdResponse findId(String nickname) {
        User user = userRepository.findByNickname(nickname.trim())
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));
        if (user.getEmail() == null) {
            throw new BusinessException(ErrorCode.USER_NOT_FOUND); // 소셜 전용 계정은 이메일이 없다
        }
        return new FindIdResponse(maskEmail(user.getEmail()));
    }

    /** 이메일 로컬 파트 일부를 가린다. 예: abcde@x.com → ab***@x.com */
    private String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        String local = email.substring(0, at);
        String head = local.length() <= 2 ? local.substring(0, 1) : local.substring(0, 2);
        return head + "***" + email.substring(at);
    }

    /**
     * 회원가입. 이메일 인증 토큰을 먼저 소비하므로 인증을 거치지 않은 요청은 여기서 막힌다.
     * 중복 검사와 INSERT 사이의 경합은 UNIQUE 제약 위반을 잡아 409로 변환해 처리한다.
     */
    @Transactional
    public UserProfileResponse signup(SignupRequest req) {
        String email = req.email().trim().toLowerCase();
        String nickname = req.nickname().trim();

        emailVerificationService.consumeToken(req.verificationToken(), email);

        // 탈퇴 후 1주일이 지나지 않은 이메일은 재가입을 막는다(-111).
        rejoinPolicy.ensureRejoinable(email, WithdrawnIdentifierType.EMAIL);

        if (userRepository.existsByEmail(email)) {
            throw new BusinessException(ErrorCode.EMAIL_ALREADY_REGISTERED);
        }
        if (userRepository.existsByNickname(nickname)) {
            throw new BusinessException(ErrorCode.NICKNAME_ALREADY_USED);
        }

        User user = User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(req.password()))
                .nickname(nickname)
                .build();
        try {
            return UserProfileResponse.from(userRepository.saveAndFlush(user));
        } catch (DataIntegrityViolationException e) {
            // 동시 가입으로 UNIQUE 제약에 걸린 경우
            throw new BusinessException(
                    userRepository.existsByEmail(email)
                            ? ErrorCode.EMAIL_ALREADY_REGISTERED
                            : ErrorCode.NICKNAME_ALREADY_USED);
        }
    }

    @Transactional
    public IssuedTokens login(LoginRequest req) {
        String email = req.email().trim().toLowerCase();
        // 비밀번호를 검사하기 전에 막는다 — 차단 중이라면 대조 자체를 하지 않는다.
        loginAttemptLimiter.ensureNotBlocked(email);

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_CREDENTIALS));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            // 가입되지 않은 이메일은 세지 않는다 — 존재하는 계정에 대한 대입만 늦추면 된다.
            loginAttemptLimiter.recordFailure(email);
            throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
        }
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        loginAttemptLimiter.reset(email);
        // 제재 확인은 실패 카운터를 <b>리셋한 뒤</b>다. 비밀번호가 맞았으니 대입 공격이 아니고,
        // 여기서 세면 제재된 사용자가 정상 시도만으로 자기 이메일을 레이트리밋에 걸리게 만든다.
        ensureNotBlocked(user.getId());
        // rememberMe는 Refresh 쿠키의 수명이 된다 — true면 14일 영구 쿠키, 아니면 세션 쿠키.
        return issueTokens(user, Boolean.TRUE.equals(req.rememberMe()));
    }

    /**
     * 소셜 로그인 (명세서 POST /auth/social/{provider}).
     * provider 인가 코드로 사용자 정보를 받고(외부 HTTP는 트랜잭션 밖), 이미 연동된 계정이면 그대로,
     * 아니면 계정을 생성·연동한 뒤 토큰을 발급한다. 계정 생성·조회는 OauthLinkService가 각각 별도 트랜잭션으로 처리한다.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED) // 클래스 기본 readOnly 트랜잭션을 벗어나, 아래 OauthLinkService가 각자 새 트랜잭션(생성은 read-write)을 열게 한다.
    public IssuedTokens socialLogin(String providerPath, SocialLoginRequest req) {
        OauthProvider provider = OauthProvider.from(providerPath);
        OauthUserInfo info = oauthClientResolver.resolve(provider)
                .fetch(req.authorizationCode(), req.redirectUri());

        Long userId = oauthLinkService.findLinkedUserId(provider, info.providerUid())
                .orElseGet(() -> createLinkedUserId(provider, info));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.SOCIAL_LOGIN_FAILED));
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        ensureNotBlocked(user.getId());
        // 소셜은 rememberMe를 물어볼 화면이 없다 — provider를 거쳐 돌아온 사용자를 매번 다시 로그인시키지 않도록 영구 쿠키로 둔다.
        return issueTokens(user, true);
    }

    /**
     * 최초 소셜 로그인 — 새 계정을 만들어 연동한다.
     * 동시 최초 로그인으로 복합 UNIQUE(provider, provider_uid)에 걸리면 createAndLink 트랜잭션이 통째로 롤백되므로,
     * 새 트랜잭션인 findLinkedUserId로 먼저 커밋된 연동을 조회해 복구한다(재시도 없이 정상 발급).
     */
    private Long createLinkedUserId(OauthProvider provider, OauthUserInfo info) {
        try {
            return oauthLinkService.createAndLink(provider, info);
        } catch (DataIntegrityViolationException race) {
            return oauthLinkService.findLinkedUserId(provider, info.providerUid())
                    .orElseThrow(() -> new BusinessException(ErrorCode.SOCIAL_LOGIN_FAILED));
        }
    }

    /**
     * Refresh 쿠키로 Access 재발급. 저장된 토큰과 일치할 때만 허용하고, 발급 시 회전시킨다.
     *
     * <p>회전 직후 겹쳐 들어온 요청(grace)은 <b>회전 없이</b> 액세스 토큰만 새로 준다 —
     * 브라우저가 이미 받아 둔 새 쿠키를 옛 값으로 덮어쓰지 않기 위해서다.
     * grace마저 지난 옛 토큰은 유출로 보고 세션을 지운다(RefreshTokenStore.rotate).</p>
     */
    @Transactional
    public IssuedTokens refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        Claims claims;
        try {
            claims = tokenProvider.parse(refreshToken);
        } catch (JwtException | IllegalArgumentException e) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        if (!tokenProvider.isRefresh(claims)) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }

        Long userId = Long.valueOf(claims.getSubject());
        Duration refreshTtl = Duration.ofMillis(tokenProvider.getRefreshExpirationMs());
        // 회전은 검사와 한 덩어리로 돌아야 해서, 쓰이지 않을 수도 있는 새 토큰을 미리 만들어 넘긴다.
        String rotated = tokenProvider.createRefreshToken(userId);
        RefreshTokenStore.Verdict verdict = refreshTokenStore.rotate(userId, refreshToken, rotated, refreshTtl);

        if (verdict == RefreshTokenStore.Verdict.REUSED) {
            // 이미 회전된 토큰이 grace를 한참 넘겨 돌아왔다 — 세션은 store가 지웠고, 여기서는 흔적만 남긴다.
            log.warn("Refresh 토큰 재사용 감지 — userId={} 의 refresh 세션을 무효화했다", userId);
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }
        if (verdict == RefreshTokenStore.Verdict.NONE) {
            throw new BusinessException(ErrorCode.INVALID_TOKEN);
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_TOKEN));
        if (!user.isActive()) {
            throw new BusinessException(ErrorCode.ACCOUNT_NOT_ACTIVE);
        }
        // 제재는 users.status를 안 쓰는 경우(기간 정지)가 있어 위 isActive() 검사에 걸리지 않는다.
        // 갱신 경로도 막아야 하는 이유 — 제재 시 Refresh를 지우지만 그 사이 회전된 토큰이 남아 있으면
        // 갱신만으로 세션이 이어진다.
        ensureNotBlocked(user.getId());

        TokenResponse body = TokenResponse.of(
                tokenProvider.createAccessToken(user.getId(), user.getNickname(), user.getRole().name()),
                tokenProvider.accessExpiresInSeconds(), UserProfileResponse.from(user));

        if (verdict == RefreshTokenStore.Verdict.GRACE) {
            return IssuedTokens.accessOnly(body);
        }
        return new IssuedTokens(body, rotated, refreshTtl, refreshTokenStore.isPersistent(userId));
    }

    /**
     * 계정 차단 확인. 제재 시 Refresh를 지우지만 그것만으로는 부족하다 —
     * 제재된 사용자가 비밀번호로 다시 로그인하면 새 토큰이 발급되기 때문이다.
     *
     * <p>기간 정지는 users를 건드리지 않으므로 위쪽 {@code isActive()} 검사에 걸리지 않는다.
     * 영구 정지는 {@code status=BANNED}라 이미 걸리지만, 여기서도 함께 보는 이유는 안내 문구가
     * 달라야 하기 때문이다 — ACCOUNT_NOT_ACTIVE는 탈퇴·영구제재를 뭉뚱그린 코드다.</p>
     */
    private void ensureNotBlocked(Long userId) {
        AccountBlock block = accountBlockStore.blockOf(userId);
        if (block == AccountBlock.BANNED) {
            throw new BusinessException(ErrorCode.ACCOUNT_BANNED);
        }
        if (block == AccountBlock.SUSPENDED) {
            throw new BusinessException(ErrorCode.ACCOUNT_SUSPENDED);
        }
    }

    /**
     * 로그아웃 — Redis에서 Refresh 토큰을 지우는 것이 곧 서버측 무효화다.
     * 접속 상태도 함께 지운다: TTL(60s)을 기다리면 이미 나간 사용자가 친구 목록에 온라인으로 남는다.
     *
     * <p>쓰기 트랜잭션을 명시하는 이유 — 클래스 기본값이 readOnly라 그대로 두면 이 안에서 도는
     * 접속시간 정산(ConnectTimeService.flush)이 그 트랜잭션에 <b>참여</b>해 FlushMode가 MANUAL로 남는다.
     * 그러면 save가 커밋 시 플러시되지 않아 사라지는데, Redis 버퍼는 GETDEL로 이미 비운 뒤라
     * 복원 경로도 타지 않는다 — 로그아웃할 때마다 미정산 접속시간(-141)이 조용히 유실된다.</p>
 *
 * <p>웹소켓까지 끊는 이유(-142) — STOMP 인증은 CONNECT 때 한 번뿐이라, 전역 연결로 바뀐 뒤로는
     * 로그아웃해도 소켓이 살아 있으면 다음 하트비트가 방금 지운 프레즌스를 <b>되살린다</b>.
     * 클라이언트가 연결을 닫아 주기를 믿지 않고 서버가 먼저 끊는다. 순서도 중요하다 —
     * 소켓을 먼저 닫아야 그 사이에 들어오는 비트가 없다.</p>
     */
    @Transactional
    public void logout(Long userId) {
        refreshTokenStore.delete(userId);
        stompSessionRegistry.closeAllOf(userId);
        presenceService.clear(userId);
    }

    /** 게스트 시작 (명세 POST /auth/guest) — 임시 닉네임 부여 + 게스트 1인방 자동 생성(공개 목록 미노출). */
    public GuestResponse guestLogin() {
        String guestId = "guest-" + UUID.randomUUID().toString().substring(0, 8);
        String nickname = "게스트" + ThreadLocalRandom.current().nextInt(1000, 10000);
        String accessToken = tokenProvider.createGuestToken(guestId, nickname);
        String roomId = liveRoomService.createGuestSoloRoom(new GuestPrincipal(guestId, nickname));
        return new GuestResponse(accessToken, nickname, roomId);
    }

    private IssuedTokens issueTokens(User user, boolean persistent) {
        // 새 로그인이 기존 세션을 밀어낸다(단일 세션) — Refresh 토큰은 아래 save()가 덮어써 이미 무효화되지만,
        // 옛 기기의 액세스 토큰·웹소켓은 그대로 살아 있어 따로 알리고 끊어야 한다.
        singleSessionPolicy.displacePrevious(user.getId());

        String accessToken = tokenProvider.createAccessToken(
                user.getId(), user.getNickname(), user.getRole().name());
        String refreshToken = tokenProvider.createRefreshToken(user.getId());
        Duration refreshTtl = Duration.ofMillis(tokenProvider.getRefreshExpirationMs());
        refreshTokenStore.save(user.getId(), refreshToken, refreshTtl, persistent);
        return new IssuedTokens(
                TokenResponse.of(accessToken, tokenProvider.accessExpiresInSeconds(), UserProfileResponse.from(user)),
                refreshToken, refreshTtl, persistent);
    }
}
