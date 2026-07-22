package ssafy.a706.backend.sfu;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ssafy.a706.backend.auth.principal.AuthPrincipal;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.sfu.dto.SfuTokenResponse;
import ssafy.a706.backend.signal.RoomMembershipReader;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

/**
 * LiveKit(SFU) 접속 토큰 발급 — 방 멤버 검증 후 서명만 하고 끝(무상태, 저장소·LiveKit 호출 없음).
 *
 * <h4>개념: SFU에서 우리 서버의 역할</h4>
 * mesh와 달리 SFU에서는 클라이언트가 미디어서버(LiveKit)와 직접 시그널링·연결한다.
 * 우리 서버는 "누가 어느 방에 들어갈 자격이 있나"만 판정해 입장권(토큰)을 발급하는 창구다.
 * LiveKit는 같은 apiSecret으로 토큰 서명을 검증하므로 서버 간 통신이 없다 —
 * coturn의 HMAC 자격 증명(-31)과 동일한 공유 비밀 사상.
 *
 * <h4>토큰 규격 (LiveKit Access Token)</h4>
 * 표준 HS256 JWT라 별도 SDK 없이 jjwt로 만든다:
 * iss=apiKey, sub=identity(participantId), name=표시명,
 * video={room, roomJoin, canPublish, canSubscribe} — 방·권한이 토큰 안에 박힌다.
 * (강퇴·음소거 등 서버 API가 필요해지면 그때 공식 SDK 도입 검토)
 */
@Service
@RequiredArgsConstructor
public class SfuTokenService {

    private final RoomMembershipReader membershipReader;
    private final LivekitProperties properties;

    /** 검증 순서: 방 존재 → 요청자 참가. LiveKit room 이름 = roomId, identity = participantId. */
    public SfuTokenResponse issue(String roomId, AuthPrincipal principal) {
        if (!membershipReader.existsRoom(roomId)) {
            throw new BusinessException(ErrorCode.ROOM_NOT_FOUND);
        }
        if (!membershipReader.isMember(roomId, principal.userId())) {
            throw new BusinessException(ErrorCode.SFU_NOT_IN_ROOM);
        }

        Instant now = Instant.now();
        String token = Jwts.builder()
                .issuer(properties.apiKey())
                .subject(principal.userId())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(properties.tokenTtl())))
                .claim("name", principal.displayName())
                .claim("video", Map.of(
                        "room", roomId,
                        "roomJoin", true,
                        "canPublish", true,
                        "canSubscribe", true))
                .signWith(Keys.hmacShaKeyFor(properties.apiSecret().getBytes(StandardCharsets.UTF_8)),
                        Jwts.SIG.HS256)
                .compact();

        return new SfuTokenResponse(properties.url(), token, properties.tokenTtl().toSeconds());
    }
}
