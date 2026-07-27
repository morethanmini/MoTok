package ssafy.a706.backend.game.dto;

import java.util.List;

/**
 * SEND /app/rooms/{roomId}/game/draw-result — AI 블라인드 채점 결과(명세 v0.2.20).
 * 마지막 화가가 발신하되 장애 대비 전 멤버 발신을 허용하고, SETNX 가드로 최초 1회만 수리된다.
 */
public record GameDrawResultRequest(List<String> guesses, Integer answerRank, Integer score) {
}
