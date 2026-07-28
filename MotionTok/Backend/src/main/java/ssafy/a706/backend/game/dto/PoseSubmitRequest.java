package ssafy.a706.backend.game.dto;

/**
 * SEND /app/rooms/{roomId}/game/pose-submit (게임④ 출제자 전용, S15P11A706-86).
 * pose는 정규화 랜드마크 33점 JSON(약 2KB) — 서버는 크기만 검증하고 그대로
 * challenge에 저장·POSE_SET으로 재방송한다(각 클라이언트가 같은 렌더 함수로 벽 생성).
 */
public record PoseSubmitRequest(String pose) {
}
