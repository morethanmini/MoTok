package ssafy.a706.backend.game.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ssafy.a706.backend.game.entity.Game;

/** 게임 카탈로그 조회 — 세션 시작 시 gameId 유효성(존재·is_active)·라운드 설정을 읽는다. */
public interface GameRepository extends JpaRepository<Game, Long> {
}
