package ssafy.a706.backend.chat.dto;

/**
 * 게임 제안 발신 페이로드 (AsyncAPI SendGameSuggest).
 * gameName은 프론트 게임 카탈로그 기준 표시명 — 게임 도메인 미구현이라 서버는
 * 형식 검증만 하고 그대로 에코한다(도메인 구현 후 gameId 실존 검증으로 강화 예정).
 */
public record ChatGameSuggestRequest(Long gameId, String gameName) {
}
