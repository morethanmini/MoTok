package ssafy.a706.backend.game.dto;

import java.util.List;

/**
 * SEND /app/rooms/{roomId}/game/draw — 현재 화가의 획 연산 배치(비영속 중계, 명세 v0.2.20).
 * 100~150ms 배치 발신. 차례(화가) 강제는 클라이언트 몫이고 서버는 멤버십·세션만 검증한다.
 */
public record GameDrawRequest(Long seq, List<DrawOp> ops) {
}
