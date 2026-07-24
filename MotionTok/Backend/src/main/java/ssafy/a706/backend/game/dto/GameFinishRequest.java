package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/finish — 참가자 라운드 완료(성공 홀드 완성 또는 시간 종료).
 * 참가자당 최초 1회만 유효. 점수 판정은 클라이언트가 하되 서버가 범위를 클램프해 기록한다.
 */
public record GameFinishRequest(Integer score, Integer starsHit) {
}
