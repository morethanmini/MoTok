package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/finish — 참가자 라운드 완료(시간 종료 시 1회).
 * 참가자당 최초 1회만 유효. 점수 판정은 클라이언트가 하되 서버가 범위를 클램프해 기록한다.
 * 게임①(별따라 손따라) 60초 매치: score=총점(0~완성 개수×100), completedCount=완성 개수.
 */
public record GameFinishRequest(Integer score, Integer starsHit, Integer completedCount) {
}
