/**
 * 관리자 게임 관리 화면의 순수 로직 — 싱글/멀티 분류.
 *
 * 서버가 이 분류를 계약에 담지 않는다. games 테이블에는 `mode`(SOLO|VERSUS|COOP)와
 * `min_players`가 있을 뿐이고, "싱글 탭에 뜰 게임"은 화면의 관심사다. 여기서 정하고
 * 테스트로 고정한다 — 아래 카탈로그 화면들이 쓰는 기준과 어긋나면 관리자가 닫은 게임이
 * 엉뚱한 탭에서만 보인다.
 */
import type { AdminGame } from '@/api'

/** 어느 목록에서 이 게임을 고를 수 있나. `all`은 필터를 걸지 않은 상태다. */
export type GameScope = 'all' | 'solo' | 'multi'

export const GAME_SCOPE_LABEL: Record<GameScope, string> = {
  all: '전체',
  solo: '싱글 플레이',
  multi: '멀티 플레이',
}

export const GAME_MODE_LABEL: Record<string, string> = {
  SOLO: '솔로',
  VERSUS: '대결',
  COOP: '협동',
}

/**
 * 싱글/멀티는 <b>배타적이지 않다.</b> 핑거스타처럼 min 1 / max 8인 게임은 혼자서도,
 * 여럿으로도 플레이되므로 두 탭에 모두 나타난다 — 한쪽으로 몰아 두면 그 게임을 닫으려는
 * 관리자가 다른 탭에서 찾지 못한다.
 *
 * 기준은 `mode`가 아니라 인원이다. mode는 게임의 성격(대결/협동)일 뿐이고, 혼자 시작할 수
 * 있는지를 정하는 건 games.min_players다(서버도 같은 값으로 거부한다).
 */
export function inScope(game: AdminGame, scope: GameScope): boolean {
  if (scope === 'all') return true
  if (scope === 'solo') return game.soloCapable
  return game.maxPlayers > 1
}

export function filterByScope(games: AdminGame[], scope: GameScope): AdminGame[] {
  return games.filter((game) => inScope(game, scope))
}

/** 이 게임이 어느 목록에 뜨는지 — 행마다 찍어 주면 탭을 옮기지 않고도 범위를 알 수 있다. */
export function scopeBadges(game: AdminGame): string[] {
  const badges: string[] = []
  if (inScope(game, 'solo')) badges.push(GAME_SCOPE_LABEL.solo)
  if (inScope(game, 'multi')) badges.push(GAME_SCOPE_LABEL.multi)
  return badges
}
