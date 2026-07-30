package ssafy.a706.backend.game.dto;

import jakarta.validation.constraints.NotNull;

/**
 * PATCH /v1/admin/games/{gameId} — 노출·플레이 허용 토글 (-106).
 *
 * <p>{@code Boolean} 래퍼인 이유 — primitive {@code boolean}이면 필드가 빠진 요청이 조용히
 * {@code false}로 바인딩돼 <b>"켜 달라"는 요청이 게임을 닫는다.</b> 래퍼 + {@code @NotNull}이면
 * 400으로 끊긴다.</p>
 *
 * @param isActive true면 카탈로그에서 플레이 가능, false면 목록에 잠긴 카드로 남고 시작이 거부된다
 */
public record AdminGameActiveRequest(@NotNull Boolean isActive) {
}
